#!/usr/bin/env python3
"""One-time read-only reconciliation before adopting a completed legacy SQL attempt.

Proves exact previous runtime/config and complete target SQL ledger on a fresh
connection. Archives the old intent; never applies SQL or resets spent markers.
"""
import argparse,fcntl,importlib.util,json,os,sys,uuid
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('host',HERE/'unified-release-host.py');host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
consumer=host.consumer;engine=host.engine;core=host.core

def reconcile(environment,migration_env,migration_user):
 old=json.loads(consumer.trusted('/etc/workspacex-image-release/'+environment+'.json',private=True).read_bytes());host.need(old['environment']==environment,'WRONG_ENVIRONMENT')
 root=Path(old['stateDirectory']);pending_file=root/'pending.json';current_file=root/'current.json'
 with open(consumer.trusted(old['lockFile'],private=True),'r') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  before={str(p):engine.sha_file(consumer.trusted(p,private=True)) for p in (pending_file,current_file)}
  pending=json.loads(pending_file.read_bytes());current=json.loads(current_file.read_bytes());host.need(pending.get('previous')==current,'PREVIOUS_RUNTIME_POINTER_CHANGED')
  attempt=consumer.trusted(pending['attempt'],directory=True,private=True);host.need(attempt.is_relative_to(root),'ATTEMPT_OUTSIDE_STATE')
  request_file=consumer.trusted(attempt/'schema-request.json',private=True);host.need(engine.sha_file(request_file)==pending['requestSha256'],'REQUEST_CHANGED')
  request=json.loads(request_file.read_bytes());host.need(request['environment']==environment and request['tag']==pending['tag'],'REQUEST_IDENTITY')
  manifest_file=consumer.trusted(request['manifest']['path']);engine.trusted_file(str(manifest_file),request['manifest']['sha256']);manifest=json.loads(manifest_file.read_bytes())
  host.need(manifest['tag']==request['tag'] and manifest['sourceRevision']==request['sourceRevision'],'MANIFEST_IDENTITY')
  target=manifest['images']['api']['imageId']
  work=attempt/('unified-reconciliation-'+uuid.uuid4().hex);work.mkdir(mode=0o700)
  adapter=host.Host(old,root,old.get('dockerConfig','/unused'));adapter.attempt=work
  engine.image(adapter.d,target,manifest['sourceRevision'])
  command=[old['docker'],'compose','--project-name',old['project'],'--env-file',old['envFile']['path']]
  for ref in old['composeFiles']:command+=['--file',str(consumer.trusted(ref['path']))]
  command+=['--file',engine.trusted_file(str(consumer.trusted(current['path'])),current['sha256'])]
  rendered=json.loads(adapter.run(command+['config','--format','json'],output=True));snapshot=work/'previous-compose.json';core.atomic(snapshot,rendered)
  images={};api=None
  for service,role in old['services'].items():
   ids=adapter.d.run(command[1:]+['ps','--quiet',service]).decode().split();host.need(len(ids)==1,'PREVIOUS_CONTAINER_REQUIRED')
   row=adapter.d.json(['container','inspect',ids[0]])[0];images[service]=row['Image']
   if role=='api':api=row
  env=dict(v.split('=',1) for v in api['Config']['Env'] if '=' in v);networks=list(api['NetworkSettings']['Networks']);host.need(len(networks)==1,'DATABASE_NETWORK_REQUIRED')
  cfg={**old,'database':{'host':env['PGHOST'],'port':int(env.get('PGPORT','5432')),'name':env['PGDATABASE'],'migrationUser':migration_user},
   'network':networks[0],'migrationEnvFile':str(consumer.trusted(migration_env,private=True)),
   'databaseCertificateMounts':[{'source':m['Source'],'target':m['Destination']} for m in api['Mounts'] if m['Destination']=='/run/certs']}
  adapter.c=cfg
  previous={'tag':current['tag'],'images':images,'compose':str(snapshot),'composeSha256':engine.sha_file(snapshot)}
  adapter.verify(previous);adapter.verify_config(previous)
  ledger=adapter.plan({'apiImage':target},work);host.need(ledger.get('status') in ('COMPLETE','PENDING'),'TARGET_DATABASE_UNCERTAIN')
  adapter.verify(previous);adapter.verify_config(previous)
  for path,pin in before.items():host.need(engine.sha_file(consumer.trusted(path,private=True))==pin,'LEGACY_STATE_CHANGED')
  proof={'status':'LEGACY_LEDGER_RECONCILED','environment':environment,'tag':request['tag'],'sourceRevision':request['sourceRevision'],
   'stateHashes':before,'runtimeImages':images,'databaseStatus':ledger['status'],'pendingMigrations':ledger.get('pending',[]),
   'historicalDrift':ledger.get('historicalDrift',[]),'databaseWrites':False,'runtimeChanged':False}
  core.atomic(work/'result.json',proof)
  archive=root/('pending-reconciled-unified-'+uuid.uuid4().hex+'.json');os.rename(pending_file,archive)
  fd=os.open(root,os.O_RDONLY)
  try:os.fsync(fd)
  finally:os.close(fd)
  host.need(engine.sha_file(archive)==before[str(pending_file)],'ARCHIVE_CHANGED')
  return {**proof,'proof':str(work/'result.json'),'pendingArchive':str(archive)}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('environment',choices=['devapp','cn','us']);p.add_argument('--migration-env',required=True);p.add_argument('--migration-user',required=True);args=p.parse_args();os.umask(0o077)
 try:host.need(os.geteuid()==0,'ROOT_REQUIRED');print(json.dumps(reconcile(args.environment,args.migration_env,args.migration_user)))
 except Exception as error:
  code=str(error);print(json.dumps({'status':'RECONCILIATION_REQUIRED','code':code if host.re.fullmatch(r'[A-Z][A-Z0-9_]{1,100}',code) else 'LEGACY_RECONCILIATION_FAILED'}));sys.exit(1)
