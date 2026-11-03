#!/usr/bin/env python3
"""Environment-configured Docker adapter for unified-release.py. Install, then dispatch.

No per-tag approvals; fixed host config contains commands, paths and environment identity.
The only user inputs are environment and immutable tag. Never invoke via a checkout sudo.
"""
import argparse,contextlib,fcntl,importlib.util,json,os,re,signal,subprocess,sys,time,uuid
from pathlib import Path
HERE=Path(__file__).resolve().parent

def module(name):
 spec=importlib.util.spec_from_file_location(name.replace('-','_'),HERE/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
configuration=module('unified-release-config');process=module('unified-release-process');core=module('unified-release');consumer=module('deploy-registry-images');engine=consumer.engine;registry=consumer.registry

def need(ok,code):
 if not ok:raise ValueError(code)

class Host:
 def __init__(self,config,root,docker_config):
  self.c=config;self.root=Path(root);self.auth=Path(docker_config);self.docker=config.get('docker','/usr/bin/docker');self.d=engine.Docker(self.docker);self.attempt=None
 def run(self,args,timeout=120,output=False,allow_failure=False):
  # Command output is private: SQL errors and Compose diagnostics may contain secrets.
  if output:
   r=process.run(args,timeout=timeout,env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8'})
   need(allow_failure or r.returncode==0,'HOST_COMMAND_FAILED');return r.stdout
  log=(self.attempt/'commands.log') if self.attempt else (self.root/'log/recovery-commands.log')
  fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
  with os.fdopen(fd,'ab') as f:r=process.run(args,stdout=f,stderr=f,timeout=timeout,env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8'})
  need(r.returncode==0,'HOST_COMMAND_FAILED')
 def compose(self,version):return [self.docker,'compose','--project-name',self.c['project'],'--file',version['compose']]
 def prepare(self,tag,attempt):
  self.attempt=attempt
  roles=sorted(set(self.c['services'].values()))
  images={r:registry.resolve([self.docker,'--config',str(self.auth)],self.c['registryPrefix'],tag,r) for r in roles}
  sources={v['sourceRevision'] for v in images.values()};need(len(sources)==1,'IMAGE_SOURCE_MISMATCH')
  cmd=[self.docker,'compose','--project-name',self.c['project'],'--env-file',self.c['envFile']]
  for path in self.c['composeFiles']:cmd+=['--file',path]
  model=json.loads(self.run(cmd+['config','--format','json'],output=True))
  api=next(s for s,r in self.c['services'].items() if r=='api')
  self.database_binding(model['services'][api].get('environment',{}))
  required=self.c.get('requiredEnvironment',{})
  missing=[service+'.'+key for service,keys in required.items() for key in keys if not model['services'][service].get('environment',{}).get(key)]
  if missing:
   core.atomic(attempt/'missing-config.json',{'missing':missing});raise ValueError('REQUIRED_CONFIG_MISSING')
  for service,role in self.c['services'].items():
   s=model['services'][service];s['image']=images[role]['imageId'];s.pop('build',None);s['pull_policy']='never'
  # Compose config JSON has already escaped literal dollars for another Compose read.
  release_config=self.root/'config/releases'/attempt.name;release_config.mkdir(mode=0o700,parents=True)
  model,config_refs=configuration.freeze(model,self.c.get('configurationMounts',[]),release_config/'files')
  path=release_config/'compose.json';core.atomic(path,model)
  candidate={'tag':tag,'sourceRevision':next(iter(sources)),'images':{s:images[r]['imageId'] for s,r in self.c['services'].items()},'compose':str(path),'composeSha256':engine.sha_file(path),'apiImage':images['api']['imageId'],'externalConfiguration':config_refs}
  self.run(self.compose(candidate)+['config','--quiet']);return candidate
 def baseline(self,attempt):
  state=self.root/'config/versions.json'
  if state.exists():
   baseline=json.loads(consumer.trusted(state,private=True).read_bytes())['current'];self.verify(baseline);self.verify_config(baseline);return baseline
  # First adoption uses an operator-exported immutable baseline, checked against live
  # container IDs/images, never the new configuration being prepared for deployment.
  baseline=json.loads(consumer.trusted(self.c['baselineFile'],private=True).read_bytes());self.verify(baseline);self.verify_config(baseline);return baseline
 def hook(self,name,candidate,attempt,mode=None):
  worker='wsx-unified-'+uuid.uuid4().hex
  command=self.migration_command(candidate,mode,worker) if name=='migrationCommand' else [sys.executable,str(HERE/'unified-release-backup.py')]
  try:
   result=json.loads(self.run(command,timeout=self.c.get('migrationTimeoutSeconds',900),output=True,allow_failure=True))
  finally:
   if name=='migrationCommand':process.cleanup_container(self.docker,worker)
  core.atomic(attempt/(name+'-'+(mode or 'result')+'.json'),result);return result
 def migration_command(self,candidate,mode,worker):
  db=self.c['database'];consumer.trusted(self.c['migrationEnvFile'],private=True)
  command=[self.docker,'run','--rm','--name',worker,'--label','wsx.unified.worker='+self.c['environment'],
   '--network',self.c['network'],'--env-file',self.c['migrationEnvFile'],'--user','0:0','--cap-drop','ALL',
   '--security-opt','no-new-privileges','--read-only','--tmpfs','/tmp:rw,nosuid,size=64m']
  for key,value in [('DATABASE',db['name']),('DATABASE_HOST',db['host']),('DATABASE_PORT',str(db['port'])),('MIGRATION_USER',db['migrationUser'])]:command+=['--env','WSX_EXPECTED_'+key+'='+value]
  for mount in self.c.get('databaseCertificateMounts',[]):
   command+=['--mount','type=bind,source='+mount['source']+',target='+mount['target']+',readonly']
  command+=['--mount','type=bind,source='+str(HERE/'unified-migration-driver.mjs')+',target=/run/unified-migration-driver.mjs,readonly',
   '--entrypoint','node',candidate['apiImage'],'--import','tsx','/run/unified-migration-driver.mjs',mode]
  return command
 def plan(self,candidate,attempt):return self.hook('migrationCommand',candidate,attempt,'plan')
 def backup(self,attempt):
  r=self.hook('backupCommand',{},attempt)
  need(r.get('status')=='COMPLETE','BACKUP_FAILED')
  p=Path(r['path']);need(p.is_relative_to(self.root/'backup') and p.is_file() and not p.is_symlink() and p.stat().st_size>0,'BACKUP_FILE_MISSING')
 def migrate(self,candidate,attempt):return self.hook('migrationCommand',candidate,attempt,'apply')
 def stop(self,baseline):
  writers=self.c.get('writerServices',[s for s,role in self.c['services'].items() if role!='postgres'])
  need(writers and all(s in self.c['services'] and self.c['services'][s]!='postgres' for s in writers),'INVALID_WRITER_SERVICES')
  self.run(self.compose(baseline)+['stop',*writers],timeout=120)
 def start(self,version):
  configuration.verify(version.get('externalConfiguration',[]),restore=version.get('restoreExternalConfiguration',False))
  engine.trusted_file(version['compose'],version['composeSha256'])
  self.run(self.compose(version)+['up','--detach','--no-build','--pull','never','--no-deps',*self.c['services']],timeout=180)
 def verify(self,version):
  consumer.trusted(version['compose'],private=True)
  engine.trusted_file(version['compose'],version['composeSha256'])
  engine.verify_runtime(self.d,self.compose(version)[1:],self.c['services'],version['images'],{**self.c,'verificationCommand':None})
 def verify_config(self,version):
  command=self.compose(version)[1:]
  rendered=self.d.json(command+['config','--format','json'])
  for service in self.c['services']:
   ids=self.d.run(command+['ps','--quiet',service]).decode().split();need(len(ids)==1,'BASELINE_CONTAINER_MISSING')
   row=self.d.json(['container','inspect',ids[0]])[0]
   if self.c['services'][service]=='api':self.database_binding(dict(v.split('=',1) for v in row['Config'].get('Env',[]) if '=' in v))
   expected=engine.resolved_config_hash(self.d,rendered,self.c['project'],service,self.attempt or self.root/'log')
   need(len(expected)==2 and expected[0]==service and row['Config']['Labels'].get('com.docker.compose.config-hash')==expected[1],'BASELINE_CONFIG_CHANGED')
 def database_binding(self,env):
  db=self.c['database']
  need(env.get('PGHOST')==db['host'] and env.get('PGDATABASE')==db['name'] and str(env.get('PGPORT','5432'))==str(db['port']),'APPLICATION_DATABASE_MISMATCH')

def main():
 parser=argparse.ArgumentParser();parser.add_argument('environment',choices=['devapp','cn','us']);parser.add_argument('tag');parser.add_argument('--execute',action='store_true',help=argparse.SUPPRESS);args=parser.parse_args()
 need(os.geteuid()==0,'ROOT_REQUIRED');need(registry.TAG.fullmatch(args.tag),'INVALID_TAG')
 if not args.execute:
  unit='wsx-unified-'+args.environment+'-'+uuid.uuid4().hex
  command=['/usr/bin/systemd-run','--wait','--collect','--quiet','--unit='+unit,'--property=RuntimeMaxSec=1800',
   '--property=TimeoutStopSec=180','--property=KillMode=mixed','--property=RuntimeDirectory='+unit,'--property=RuntimeDirectoryMode=0700',
   '/usr/bin/python3','-I','-B',str(Path(__file__).resolve()),args.environment,args.tag,'--execute']
  completed=subprocess.run(command,env={'PATH':'/usr/bin:/bin'})
  rows=process.run(['/usr/bin/journalctl','--boot','--unit='+unit,'--output=cat','--no-pager','--lines=20'],timeout=10)
  for line in reversed(rows.stdout.decode().splitlines()):
   try:result=json.loads(line)
   except ValueError:continue
   if isinstance(result,dict) and isinstance(result.get('status'),str):
    print(json.dumps({key:result[key] for key in ('status','code','stage','database','environment','tag','evidenceDirectory') if key in result}));break
  return completed.returncode
 def cancelled(*_):raise RuntimeError('RELEASE_CANCELLED')
 for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,cancelled)
 os.umask(0o077);root=Path('/srv/workspacex');core.layout(root)
 cfg=json.loads(consumer.trusted(root/'config/release.json',private=True).read_bytes());need(cfg['environment']==args.environment,'WRONG_HOST_ENVIRONMENT')
 canonical={'devapp':'/run/workspacex-devapp-deploy.lock','cn':'/var/lib/workspacex-cn/runtime/release.lock','us':'/run/workspacex-selfhost-deploy.lock'}
 need(cfg['lockFile']==canonical[args.environment],'CANONICAL_LOCK_REQUIRED')
 with open(consumer.trusted(cfg['lockFile'],private=True),'r') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  runtime=consumer.trusted(os.environ['RUNTIME_DIRECTORY'],directory=True,private=True)
  auth=contextlib.nullcontext(Path(cfg['dockerConfig'])) if not cfg.get('ecsAuth') else consumer.ecs_docker_config(cfg['ecsAuth'],cfg.get('docker','/usr/bin/docker'),cfg['registryPrefix'].split('/')[0],str(runtime))
  with auth as directory:result=core.release(root,args.tag,Host(cfg,root,directory))
 result.update(environment=args.environment,tag=args.tag)
 if result.get('attempt'):result['evidenceDirectory']=result['attempt']
 print(json.dumps(result));return 0 if result['status']=='SUCCEEDED' else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception as error:
  code=str(error);print(json.dumps({'status':'FAILED','stage':'entry','code':code if re.fullmatch(r'[A-Z][A-Z0-9_]{1,100}',code) else 'RELEASE_ENTRY_FAILED'}));sys.exit(1)
