#!/usr/bin/env python3
"""One-time, non-destructive import of the current Compose release into shared layout.

Does not switch containers, run SQL, delete legacy files or change the installed entry.
Invoke only from the reviewed installed tool bundle, holding the canonical release lock.
"""
import argparse,fcntl,importlib.util,json,os,shutil,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('host',HERE/'unified-release-host.py');host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
consumer=host.consumer;core=host.core;engine=host.engine

def adopt(environment,migration_env,migration_user,backup_image,root=Path('/srv/workspacex')):
 old=json.loads(consumer.trusted('/etc/workspacex-image-release/'+environment+'.json',private=True).read_bytes())
 host.need(old['environment']==environment,'WRONG_HOST_ENVIRONMENT')
 migration_env=consumer.trusted(migration_env,private=True)
 core.layout(root);host.need(not (root/'config/release.json').exists(),'ALREADY_ADOPTED')
 with open(consumer.trusted(old['lockFile'],private=True),'r') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  legacy_pending=Path(old['stateDirectory'])/'pending.json'
  host.need(not legacy_pending.exists() and not legacy_pending.is_symlink(),'LEGACY_RELEASE_RECONCILIATION_REQUIRED')
  compose=[old['docker'],'compose','--project-name',old['project'],'--env-file',old['envFile']['path']]
  for ref in old['composeFiles']:compose+=['--file',str(consumer.trusted(ref['path']))]
  state=Path(old['stateDirectory'])/'current.json';previous=json.loads(consumer.trusted(state,private=True).read_bytes())
  compose+=['--file',str(consumer.trusted(previous['path']))]
  adapter=host.Host(old,root,old.get('dockerConfig','/unused'));adapter.attempt=root/'log'
  rendered=json.loads(adapter.run(compose+['config','--format','json'],output=True))
  baseline_dir=root/'config/adoption';baseline_dir.mkdir(mode=0o700,exist_ok=True)
  baseline_compose=baseline_dir/'compose.json';core.atomic(baseline_compose,rendered)
  images={};api_row=None;configuration_mounts=set()
  for service,role in old['services'].items():
   ids=adapter.d.run(compose[1:]+['ps','--quiet',service]).decode().split();host.need(len(ids)==1,'ACTIVE_CONTAINER_REQUIRED')
   row=adapter.d.json(['container','inspect',ids[0]])[0];images[service]=row['Image']
   configuration_mounts.update(m['Source'] for m in row['Mounts'] if m['Destination'] in ('/run/certs','/run/agent-certs'))
   if role=='api':api_row=row
  env=dict(v.split('=',1) for v in api_row['Config']['Env'] if '=' in v)
  db={'host':env['PGHOST'],'port':int(env.get('PGPORT','5432')),'name':env['PGDATABASE'],'migrationUser':migration_user}
  networks=list(api_row['NetworkSettings']['Networks']);host.need(len(networks)==1,'EXPLICIT_DATABASE_NETWORK_REQUIRED')
  baseline={'tag':previous['tag'],'images':images,'compose':str(baseline_compose),'composeSha256':engine.sha_file(baseline_compose),
   'sourceRevision':engine.image(adapter.d,api_row['Image']),'apiImage':api_row['Image']}
  baseline_file=root/'config/adoption/release.json';core.atomic(baseline_file,baseline)
  cfg={key:old[key] for key in ('environment','registryPrefix','docker','lockFile','project','services','health')}
  cfg.update(database=db,network=networks[0],baselineFile=str(baseline_file),composeFiles=[str(root/'config/compose.json')],
   envFile=str(root/'config/compose.env'),migrationEnvFile=str(root/'config/migration.env'),backupImage=backup_image,
   databaseCertificateMounts=[{'source':m['Source'],'target':m['Destination']} for m in api_row['Mounts'] if m['Destination']=='/run/certs'],
   configurationMounts=sorted(configuration_mounts),readinessTimeoutSeconds=old.get('readinessTimeoutSeconds',120))
  for key in ('ecsAuth','dockerConfig'):
   if key in old:cfg[key]=old[key]
  adapter.c=cfg;adapter.verify(baseline);adapter.verify_config(baseline)
  _,refs=host.configuration.freeze(rendered,configuration_mounts,baseline_dir/'files')
  baseline.update(externalConfiguration=refs,restoreExternalConfiguration=True)
  core.atomic(baseline_file,baseline)
  core.atomic(root/'config/compose.json',rendered)
  for source,target in [(migration_env,root/'config/migration.env'),(consumer.trusted(old['envFile']['path'],private=True),root/'config/compose.env')]:
   fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
   with os.fdopen(fd,'wb') as out:out.write(source.read_bytes());out.flush();os.fsync(out.fileno())
  # Keep legacy incident evidence, including pending migration attempts. Nothing is
  # declared resolved by adoption; the shared driver will query the live SQL ledger.
  core.atomic(root/'log/adoption.json',{'legacyStateDirectory':old['stateDirectory'],'legacyPendingRetained':(Path(old['stateDirectory'])/'pending.json').exists(),'runtimeChanged':False,'databaseWrites':False})
  core.atomic(root/'current/release.json',baseline)
  core.atomic(root/'config/release.json',cfg)
 return {'status':'ADOPTED','environment':environment,'tag':baseline['tag'],'runtimeChanged':False,'databaseWrites':False}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('environment',choices=['devapp','cn','us']);p.add_argument('--migration-env',required=True);p.add_argument('--migration-user',required=True);p.add_argument('--backup-image',required=True);args=p.parse_args()
 os.umask(0o077)
 try:
  host.need(os.geteuid()==0,'ROOT_REQUIRED');print(json.dumps(adopt(args.environment,args.migration_env,args.migration_user,args.backup_image)))
 except Exception:print(json.dumps({'status':'FAILED','stage':'adoption','code':'ADOPTION_FAILED'}));sys.exit(1)
