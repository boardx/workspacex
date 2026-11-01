#!/usr/bin/env python3
"""Exact target-image dynamic bootstrap DB compatibility; never bootstrap writes.

Host policy.bootstrapProbe.binding pins the source image, original runtime env
hash, protected admin input, DB network and any exact CA file mount. This is not
an API startup, browser, HTTP or complete database recovery acceptance.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid
HERE=Path(__file__).resolve().parent
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
DB_KEYS={'PGHOST','PGPORT','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT_MS','PGSTATEMENT_TIMEOUT_MS','APP_DB_USER','APP_DB_PASSWORD','WORKSPACEX_DEPLOY_PROFILE','WORKSPACEX_RDS_TLS_EXCEPTION','KERNEL_DEFAULT_AGENT_MODEL_ID'}
ADMIN=('PROVISION_ADMIN_EMAIL','PROVISION_ADMIN_PASSWORD','PROVISION_ADMIN_NAME','PROVISION_ORG_NAME')
def need(v,c):
 if not v:raise ValueError(c)
def trusted(path,private=False):
 p=Path(path);need(p.is_absolute(),'ROOT_INPUT_PATH')
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_INPUT_PATH')
 need(p.is_file() and p.stat().st_nlink==1,'ROOT_INPUT_FILE')
 if private:need(not p.stat().st_mode&0o077,'PRIVATE_INPUT_FILE')
 return p
def load(name):
 s=importlib.util.spec_from_file_location(name,trusted(HERE/(name+'.py')));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def env_map(lines):
 result={}
 for line in lines:
  need(type(line) is str and '=' in line and not any(c in line for c in '\r\n\0'),'ENV_SERIALIZATION')
  k,v=line.split('=',1);need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k) and k not in result,'ENV_AMBIGUOUS');result[k]=v
 return result

def parse_docker_env(lines):
 """Docker inspect values may contain PEM newlines; never an env-file serializer.

 Preserve complete original values for the baseline identity hash. Only inputs()
 selects DB/admin fields, and its strict env_map roundtrip gates every line that
 is subsequently written to a generated env file.
 """
 result={}
 for line in lines:
  need(type(line) is str and '=' in line and '\0' not in line,'ENV_SERIALIZATION')
  k,v=line.split('=',1);need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k) and k not in result,'ENV_AMBIGUOUS');result[k]=v
 return result

def inputs(base,admin,environment,profile):
 need(all(type(admin.get(k)) is str and admin[k] for k in ADMIN),'BOOTSTRAP_ADMIN_INPUT_MISSING')
 need(profile in ('starter','production'),'BOOTSTRAP_PROFILE')
 if environment=='us':
  need(profile=='starter' and base.get('WORKSPACEX_DEPLOY_PROFILE') in (None,'starter') and
       all(base.get(k)==v for k,v in {'PGHOST':'postgres','PGPORT':'5432','PGDATABASE':'workspacex','PGSSLMODE':'disable','APP_DB_USER':'app_rw'}.items()),'US_STARTER_TRANSPORT_BINDING')
 else:need(environment=='cn' and base.get('WORKSPACEX_DEPLOY_PROFILE')==profile and base.get('APP_DB_USER')=='app_rw','CN_ORIGINAL_PROFILE_REQUIRED')
 result={**{k:v for k,v in base.items() if k in DB_KEYS},**{k:admin[k] for k in ADMIN},'WSX_BOOTSTRAP_APPROVED_PROFILE':profile}
 # Validate every generated line through the same serializer boundary.
 env_map([k+'='+v for k,v in result.items()]);return result

JS=r'''import {appConfig} from './src/infrastructure/db/pg-config.ts';
import {assertPostMigrationBootstrap} from '../../packages/cloud-deploy/src/bootstrap-proof.ts';
const before=appConfig();
process.env.WORKSPACEX_DEPLOY_PROFILE=process.env.WSX_BOOTSTRAP_APPROVED_PROFILE;
const after=appConfig();
if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('BOOTSTRAP_CONFIG_CHANGED');
let output='';const original=process.stdout.write;
process.stdout.write=function(bytes){output+=String(bytes);if(Buffer.byteLength(output)>65536)throw new Error('BOOTSTRAP_OUTPUT_BOUND');return true;};
try{await import('./scripts/provision-admin-compatibility.ts');}finally{process.stdout.write=original;}
if(process.exitCode)throw new Error('BOOTSTRAP_NOT_READY');
assertPostMigrationBootstrap(output,process.env.CN_BOOTSTRAP_SOURCE_SHA,process.env.CN_BOOTSTRAP_IMAGE_DIGEST);
process.stdout.write(output);
'''
def command(image,name,token,network,env_file,mounts):
 need(re.fullmatch('sha256:[a-f0-9]{64}',image),'API_IMAGE_ID')
 need(re.fullmatch('[A-Za-z0-9_.-]+',network),'DATABASE_NETWORK')
 args=['/usr/bin/docker','run','--rm','--pull=never','--name',name,'--label','wsx.bootstrap-probe='+token,
       '--network',network,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=512m','--pids-limit=128',
       '--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m','--env-file',str(env_file)]
 for source,target in mounts:args+=['--mount','type=bind,src='+source+',dst='+target+',readonly']
 return args+['--workdir','/opt/workspacex/apps/api','--entrypoint','node',image,'--import','tsx','--input-type=module','-e',JS]

def validate_output(raw,source,digest):
 need(type(raw) is bytes and len(raw)<=65536 and re.fullmatch(rb'CN_BOOTSTRAP_COMPAT_JSON=[^\n]+\n',raw),'BOOTSTRAP_OUTPUT_FORMAT')
 value=json.loads(raw[len(b'CN_BOOTSTRAP_COMPAT_JSON='):])
 checks=('imageEntrypoint','inputContract','schemaContract','permissionContract','agentSeedContract','migrationLedgerContract')
 need(value.get('schemaVersion')==1 and value.get('phase')=='preactivate' and value.get('sourceSha')==source and value.get('imageDigest')==digest and
      value.get('ready') is True and value.get('readOnlyTransaction') is True and type(value.get('productionWriteStatements')) is int and value['productionWriteStatements']==0 and
      value.get('blockers')==[] and value.get('stateClass') in ('empty','matching-existing') and all(value.get('checks',{}).get(k) is True for k in checks) and
      'sourceEntrypoint' not in value['checks'] and 'baselineCompatibility' not in value and 'buildAdmissionOnly' not in value,'POST_MIGRATION_BOOTSTRAP_UNPROVEN')
 return value

def database_network(policy,base,api,docker,binding,cn=None,prep=None):
 network=binding['network'];api_network=api.get('NetworkSettings',{}).get('Networks',{}).get(network,{})
 need(api_network.get('NetworkID')==binding.get('networkId') and re.fullmatch('[a-f0-9]{64}',binding.get('networkId','')),'API_NETWORK_ID_BINDING')
 if policy['environment']=='us':
  source=policy['usDatabase'];rows=docker.json(['inspect',source['containerId']]);need(len(rows)==1,'POSTGRES_CONTAINER_SET');pg=rows[0];labels=pg.get('Config',{}).get('Labels',{})
  need(pg['Id']==source['containerId'] and pg['Image']==source['imageId'] and pg['State']['Running'] is True and labels.get('com.docker.compose.project')==policy['project'] and labels.get('com.docker.compose.service')=='postgres','ACTUAL_POSTGRES_BINDING')
  pg_network=pg.get('NetworkSettings',{}).get('Networks',{}).get(network,{})
  need(pg_network.get('NetworkID')==api_network['NetworkID'] and base.get('PGHOST') in (pg_network.get('Aliases') or []),'SOURCE_DB_NETWORK_ALIAS_BINDING')
 else:
  need(cn is not None and prep is not None,'CN_SOURCE_BINDING_REQUIRED');cn.bind_env(prep)
  need(network==cn.NETWORK and base.get('PGHOST')==cn.HOST and base.get('PGDATABASE')==cn.DB and base.get('PGPORT','5432')=='5432' and base.get('PGSSLMODE','disable')=='disable','CN_REAL_DATABASE_BINDING')
 return network

def original_ca_file(api,destination):
 target=Path(destination);need(target.is_absolute() and '..' not in target.parts,'CA_DESTINATION')
 candidates=[]
 for mount in api.get('Mounts',[]):
  if mount.get('Type')!='bind':continue
  try:relative=target.relative_to(mount['Destination'])
  except ValueError:continue
  candidates.append(str(Path(mount['Source'])/relative))
 need(len(candidates)==1,'ACTUAL_CA_MOUNT_BINDING');return candidates[0]

def policy_spec(environment,cfg,api,target,source_policy,docker,prep,core,closure,cn=None):
 need(target.get('sourceRevision')==SOURCE,'BOOTSTRAP_TARGET_SOURCE')
 need(target.get('imageId')==source_policy[environment+'Database']['targetApiImageId'],'BOOTSTRAP_PREPARED_TARGET_DRIFT')
 admin_path=Path('/etc/workspacex-selfhost/probe.env') if environment=='us' else Path(cn.ENV).parent/'bootstrap.env'
 admin_path=trusted(admin_path,True);raw=admin_path.read_text();admin=env_map([l for l in raw.splitlines() if l and not l.startswith('#')]);base=parse_docker_env(api['Config']['Env'])
 profile='starter' if environment=='us' else base.get('WORKSPACEX_DEPLOY_PROFILE')
 inputs(base,admin,environment,profile)
 network='workspacex-selfhost-runtime' if environment=='us' else cn.NETWORK
 nid=api.get('NetworkSettings',{}).get('Networks',{}).get(network,{}).get('NetworkID')
 binding={'image':{'imageId':target['imageId'],'image':target['image']},'baselineEnvSha256':core.sha(json.dumps(base,sort_keys=True).encode()),'network':network,'networkId':nid,'profile':profile,'caFiles':[]}
 database_network(source_policy,base,api,docker,binding,cn,prep)
 ref=lambda path:{'path':str(trusted(path)),'sha256':core.file_sha(path)}
 admin_ref={**ref(admin_path),'private':True};binding['adminEnv']=admin_ref
 references=[*closure,admin_ref]
 if base.get('PGSSLROOTCERT'):
  source=trusted(original_ca_file(api,base['PGSSLROOTCERT']));ca={**ref(source),'destination':base['PGSSLROOTCERT']};binding['caFiles']=[ca];references.append(ref(source))
 executable=ref(HERE/'tag-bootstrap-probe.py');need(os.access(executable['path'],os.X_OK),'BOOTSTRAP_EXECUTABLE_REQUIRED')
 references.append(executable)
 return {'executable':executable,'inputs':references,'timeoutSeconds':60,'binding':binding}

def run_job(args,timeout):
 # Bound output at the OS file boundary, not only after communicate allocated
 # arbitrary bytes. TemporaryFile is unlinked/private; no raw child stderr.
 def bounded_output():resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536))
 with tempfile.TemporaryFile() as output:
  child=subprocess.Popen(args,stdout=output,stderr=subprocess.DEVNULL,preexec_fn=bounded_output,env={'PATH':'/usr/bin:/bin','HOME':'/root','LANG':'C.UTF-8'})
  try:child.communicate(timeout=timeout)
  except BaseException:
   if child.poll() is None:
    child.terminate()
    try:child.communicate(timeout=10)
    except subprocess.TimeoutExpired:child.kill();child.communicate(timeout=5)
   raise
  need(child.returncode==0,'CANDIDATE_BOOTSTRAP_FAILED');output.seek(0);return output.read(65537)

def main():
 need(os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1]=='preactivate','ROOT_FIXED_MODE')
 trusted(__file__);prep=load('schema-tag-prepare');us=load('us-tag-migration-adapter');core=load('schema-restore-rehearsal');engine=load('minimal-docker-release')
 attempt=prep.trusted(sys.argv[2],private=True,directory=True);p=json.loads(trusted(attempt/'policy.json',True).read_bytes());env=p['environment']
 need(env in ('us','cn') and p['source']==SOURCE and p['tag']==TAG,'POLICY_IDENTITY')
 canonical={'us':'/run/workspacex-selfhost-deploy.lock','cn':'/var/lib/workspacex-cn/runtime/release.lock'}[env];us.inherited_lock(int(os.environ.get('WSX_RELEASE_LOCK_FD','-1')),canonical)
 spec=p['bootstrapProbe'];binding=spec['binding'];need(type(spec['timeoutSeconds']) is int and 5<=spec['timeoutSeconds']<=60,'BOOTSTRAP_BUDGET')
 for ref in spec['inputs']:
  path=trusted(ref['path'],ref.get('private',False));need(core.file_sha(path)==ref['sha256'],'BOOTSTRAP_INPUT_DRIFT')
 d=engine.Docker('/usr/bin/docker');baseline=p['baseline']['api'];rows=d.json(['inspect',baseline['containerId']]);need(len(rows)==1,'API_CONTAINER_SET');row=rows[0]
 need(row['Id']==baseline['containerId'] and row['Image']==baseline['imageId'] and row['Config']['Labels'].get('com.docker.compose.project')==p['project'] and row['Config']['Labels'].get('com.docker.compose.service')=='api','BASELINE_API_BINDING')
 base=parse_docker_env(row['Config']['Env']);env_sha=core.sha(json.dumps(base,sort_keys=True).encode());need(env_sha==binding['baselineEnvSha256'],'BASELINE_ENV_DRIFT')
 image=binding['image'];image_rows=d.json(['image','inspect',image['imageId']]);need(len(image_rows)==1,'TARGET_IMAGE_SET');target=image_rows[0]
 need(target['Os']=='linux' and target['Architecture']=='amd64' and target['Id']==image['imageId'] and target['Config']['Labels'].get('org.opencontainers.image.revision')==SOURCE and image['image'] in target.get('RepoDigests',[]),'TARGET_IMAGE_BINDING')
 digest=image['image'].split('@')[-1];need(re.fullmatch('sha256:[a-f0-9]{64}',digest),'TARGET_REGISTRY_DIGEST')
 expected_target=p[env+'Database']['targetApiImageId'];need(image['imageId']==expected_target,'PREPARED_TARGET_IMAGE_DRIFT')
 cn=load('schema-tag-prepare-cn') if env=='cn' else None
 network=database_network(p,base,row,d,binding,cn,prep)
 admin_ref=binding['adminEnv'];need(admin_ref in spec['inputs'],'ADMIN_ENV_PIN_REQUIRED');admin_path=trusted(admin_ref['path'],True);need(core.file_sha(admin_path)==admin_ref['sha256'],'ADMIN_ENV_DRIFT')
 admin=env_map([l for l in admin_path.read_text().splitlines() if l and not l.startswith('#')]);values=inputs(base,admin,env,binding['profile'])
 values.update(CN_BOOTSTRAP_SOURCE_SHA=SOURCE,CN_BOOTSTRAP_PHASE='preactivate',CN_BOOTSTRAP_IMAGE_DIGEST=digest)
 mounts=[]
 for ref in binding.get('caFiles',[]):
  source=trusted(ref['path']);need(core.file_sha(source)==ref['sha256'] and ref['destination']==base.get('PGSSLROOTCERT'),'CA_PIN_BINDING')
  need(original_ca_file(row,ref['destination'])==str(source),'ACTUAL_CA_MOUNT_BINDING');mounts.append((str(source),ref['destination']))
 need(not base.get('PGSSLROOTCERT') or len(mounts)==1,'ORIGINAL_CA_FILE_REQUIRED')
 token=uuid.uuid4().hex;name='wsx-bootstrap-'+token;fd,path=tempfile.mkstemp(prefix='bootstrap-env-',dir=attempt);private_env=Path(path)
 with os.fdopen(fd,'wb') as out:out.write(('\n'.join(k+'='+v for k,v in values.items())+'\n').encode());out.flush();os.fsync(out.fileno())
 success=False
 try:
  raw=run_job(command(image['imageId'],name,token,network,private_env,mounts),spec['timeoutSeconds']);proof=validate_output(raw,SOURCE,digest)
  raw_file=attempt/('bootstrap-raw-'+token+'.txt')
  raw_fd=os.open(raw_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(raw_fd,'wb') as saved:saved.write(raw);saved.flush();os.fsync(saved.fileno())
  result={'status':'CANDIDATE_BOOTSTRAP_COMPATIBLE','environment':env,'source':SOURCE,'tag':TAG,'imageDigest':digest,'imageId':image['imageId'],'attempt':str(attempt),'createdAt':time.time(),'readOnlyTransaction':True,'productionWriteStatements':0,'checks':proof['checks'],'apiStartupVerified':False,'rawOutput':{'path':str(raw_file),'sha256':core.sha(raw)},'baselineEnvSha256':env_sha,'adminEnvSha256':admin_ref['sha256'],'network':network,'canonicalLock':{'path':canonical,'device':os.fstat(int(os.environ['WSX_RELEASE_LOCK_FD'])).st_dev,'inode':os.fstat(int(os.environ['WSX_RELEASE_LOCK_FD'])).st_ino}}
  success=True
 finally:
  private_env.unlink(missing_ok=True)
  ids=d.run(['ps','--all','--no-trunc','--quiet','--filter','label=wsx.bootstrap-probe='+token]).decode().split();need(len(ids)<=1,'BOOTSTRAP_CLEANUP_AMBIGUOUS')
  for cid in ids:
   items=d.json(['inspect',cid]);need(len(items)==1 and items[0]['Name']=='/'+name and items[0]['Image']==image['imageId'] and items[0]['Config']['Labels'].get('wsx.bootstrap-probe')==token,'BOOTSTRAP_CLEANUP_OWNER');d.run(['rm','--force',cid])
  need(not d.run(['ps','--all','--quiet','--filter','label=wsx.bootstrap-probe='+token]).strip(),'BOOTSTRAP_CLEANUP_UNPROVEN')
 need(success,'BOOTSTRAP_PROOF_MISSING');core.save(attempt/('bootstrap-receipt-'+token+'.json'),result);print(json.dumps(result))
if __name__=='__main__':
 def interrupted(*_):raise RuntimeError('BOOTSTRAP_PROBE_INTERRUPTED')
 for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(sig,interrupted)
 try:main()
 except Exception:print(json.dumps({'status':'CANDIDATE_BOOTSTRAP_FAILED','source':SOURCE,'tag':TAG}));sys.exit(1)
