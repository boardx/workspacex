#!/usr/bin/env python3
"""Root-only restoration qualification of an ALREADY COMPLETE exact schema.

No CLI, source database connection, migration replay or production restore.
Caller must independently capture/pin the actual fresh source and own the release
lock. This component writes only its new network-none PostgreSQL clone/evidence.
"""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
import uuid
HERE=Path(__file__).resolve().parent
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
def need(v,c):
 if not v:raise ValueError(c)
def trusted(path):
 p=Path(path);need(p.is_absolute(),'ROOT_INPUT_PATH')
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_INPUT_PATH')
 need(p.is_file() and p.stat().st_nlink==1,'ROOT_INPUT_FILE');return p
def load(name):
 s=importlib.util.spec_from_file_location(name,trusted(HERE/(name+'.py')));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def file_sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as stream:
  for raw in iter(lambda:stream.read(1048576),b''):h.update(raw)
 return h.hexdigest()

def private_fresh(path,now):
 p=trusted(path);need(stat.S_IMODE(p.stat().st_mode)==0o600 and 0<=now-p.stat().st_mtime<1800,'FRESH_PRIVATE_INPUT_REQUIRED');return p

def preflight_tools(inputs,now=None):
 now=time.time() if now is None else now
 need(type(inputs) is dict and set(inputs)=={'archive','key','snapshot','baselineLedger','completeLedger','binding'},'COMPLETE_INPUT_SET')
 ref=inputs['binding'];need(type(ref) is dict and set(ref)=={'path','sha256'} and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'INPUT_PIN_FORMAT')
 path=private_fresh(ref['path'],now);need(path.stat().st_size<=8*1024*1024 and file_sha(path)==ref['sha256'],'COMPLETE_BINDING_PIN')
 binding=json.loads(path.read_bytes());need(type(binding.get('capturedAt')) in (int,float) and 0<=now-binding['capturedAt']<1800,'COMPLETE_SOURCE_EXPIRED')
 tools=binding.get('toolPins',{});required={'schema-complete-restore.py','schema-restore-rehearsal.py','schema-acl-rehearsal.py','minimal-docker-release.py'}
 need(type(tools) is dict and set(tools)==required,'COMPLETE_TOOL_PINS')
 for name,checksum in tools.items():
  code=trusted(HERE/name);need(type(checksum) is str and re.fullmatch('[a-f0-9]{64}',checksum) and code.stat().st_size<=2*1024*1024 and file_sha(code)==checksum,'COMPLETE_TOOL_DRIFT')
 return binding

def check_complete_ledger(baseline,complete):
 core=load('schema-restore-rehearsal');core.check_ledger(baseline)
 need(len(baseline)==435 and type(complete) is dict and len(complete)==438 and complete=={**baseline,**core.MIGRATIONS},'EXACT_COMPLETE_LEDGER_REQUIRED')

def read_inputs(inputs,image,now=None):
 now=time.time() if now is None else now;preflight_tools(inputs,now);core=load('schema-restore-rehearsal')
 need(type(inputs) is dict and set(inputs)=={'archive','key','snapshot','baselineLedger','completeLedger','binding'},'COMPLETE_INPUT_SET')
 paths={}
 for name,ref in inputs.items():
  need(set(ref)=={'path','sha256'} and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'INPUT_PIN_FORMAT')
  p=trusted(ref['path']);need(stat.S_IMODE(p.stat().st_mode)==0o600 and 0<=now-p.stat().st_mtime<1800,'FRESH_PRIVATE_INPUT_REQUIRED')
  need(core.file_sha(p)==ref['sha256'],'COMPLETE_INPUT_HASH');paths[name]=p
 read=lambda name:json.loads(paths[name].read_bytes())
 for name in ('snapshot','baselineLedger','completeLedger','binding'):need(paths[name].stat().st_size<=8*1024*1024,'INPUT_METADATA_BOUND')
 baseline=read('baselineLedger');complete=read('completeLedger');snapshot=read('snapshot');binding=read('binding');check_complete_ledger(baseline,complete)
 need(binding.get('environment')=='us' and binding.get('sourceRevision')==SOURCE and binding.get('tag')==TAG and binding.get('database')=='workspacex' and binding.get('role')=='postgres' and binding.get('postgresImageId')==image,'COMPLETE_SOURCE_BINDING')
 need(type(binding.get('capturedAt')) in (int,float) and 0<=now-binding['capturedAt']<1800,'COMPLETE_SOURCE_EXPIRED')
 need(re.fullmatch('[a-f0-9]{64}',binding.get('sourceContainerId','')) and re.fullmatch('sha256:[a-f0-9]{64}',binding.get('targetApiImageId','')) and re.fullmatch('[a-z0-9][a-z0-9.:/_-]*@sha256:[a-f0-9]{64}',binding.get('targetApiRepoDigest','')),'COMPLETE_SOURCE_IDENTITY')
 tools=binding.get('toolPins',{});required={'schema-complete-restore.py','schema-restore-rehearsal.py','schema-acl-rehearsal.py','minimal-docker-release.py'}
 need(set(tools)==required,'COMPLETE_TOOL_PINS')
 for name,checksum in tools.items():need(re.fullmatch('[a-f0-9]{64}',checksum) and core.file_sha(trusted(HERE/name))==checksum,'COMPLETE_TOOL_DRIFT')
 core.private_backup_files(paths['archive'],paths['key'])
 return paths,baseline,complete,snapshot,binding

def qualify_complete(docker,image,inputs,output):
 need(os.geteuid()==0,'ROOT_COMPLETE_QUALIFICATION_REQUIRED')
 trusted(__file__);preflight_tools(inputs);core=load('schema-restore-rehearsal');acl=load('schema-acl-rehearsal');engine=load('minimal-docker-release')
 need(re.fullmatch('sha256:[a-f0-9]{64}',image),'IMMUTABLE_CLONE_IMAGE_REQUIRED')
 paths,baseline,complete,snapshot,binding=read_inputs(inputs,image)
 # Keep the original role privilege refusal; no managed-CN capability or privileged
 # source-role cloning is introduced by this US-only complete-state component.
 roles_sql=acl.role_sql(snapshot);need('app_rw' in {r['name'] for r in snapshot['roles']},'APP_ROLE_REQUIRED')
 need(type(snapshot.get('catalog')) is dict and bool(snapshot['catalog']),'SOURCE_CATALOG_REQUIRED')
 d=engine.Docker(docker);out=Path(output);parent=out.parent
 for q in (*reversed(parent.parents),parent):
  s=q.lstat();need(s.st_uid==0 and stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_OUTPUT_PARENT')
 out.mkdir(mode=0o700,exist_ok=False)
 rows=d.json(['image','inspect',image]);need(len(rows)==1 and rows[0]['Id']==image,'CLONE_IMAGE_BINDING')
 config=rows[0].get('Config',{});env=dict(x.split('=',1) for x in config.get('Env',[]) if '=' in x)
 need(env.get('PGDATA')=='/var/lib/postgresql/data' and set(config.get('Volumes',{}) or {})<={'/var/lib/postgresql/data'},'CLONE_DATA_LAYOUT')
 token=uuid.uuid4().hex;name='wsx-complete-restore-'+token;label='wsx.complete-rehearsal='+token;cid=None;cleanup=False;failure=None;stage='CREATE'
 core.save(out/'intent.json',{'name':name,'ownerLabel':label,'imageId':image,'network':'none','schemaState':'COMPLETE','sourceBinding':binding,'inputPins':inputs,'sqlReplayAllowed':False})
 def query(sql,role='postgres'):
  need(cid is not None,'CLONE_ID_REQUIRED');args=core.clone_psql(docker,cid,sql);args=[('--username='+role) if x=='--username=postgres' else x for x in args];return d.run(args[1:],timeout=60).decode().strip()
 def ledger():return json.loads(query("SELECT COALESCE(json_object_agg(name,checksum),'{}'::json) FROM public._kernel_migrations"))
 try:
  cid=d.run(['create','--pull=never','--name',name,'--label',label,'--network','none','--read-only','--security-opt=no-new-privileges','--memory=1g','--cpus=1','--pids-limit=128','--tmpfs','/tmp:rw,nosuid,nodev,size=32m','--tmpfs','/var/run/postgresql:rw,nosuid,nodev,size=16m','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=512m','--env','POSTGRES_DB=workspacex','--env','POSTGRES_HOST_AUTH_METHOD=trust',image]).decode().strip();need(re.fullmatch('[a-f0-9]{64}',cid),'CLONE_ID')
  actual=d.json(['container','inspect',cid]);need(len(actual)==1,'CLONE_INSPECT_SET');v=actual[0]
  need(v['Id']==cid and v['Name']=='/'+name and v['Image']==image and v['Config']['Labels'].get('wsx.complete-rehearsal')==token and v['HostConfig']['NetworkMode']=='none' and not v['HostConfig'].get('PortBindings') and not v['HostConfig'].get('Binds') and not v['HostConfig'].get('Privileged') and all(m.get('Type')=='tmpfs' for m in v.get('Mounts',[])),'CLONE_ISOLATION')
  d.run(['start',cid]);stage='READINESS';deadline=time.monotonic()+60
  while True:
   try:query('SELECT 1');break
   except Exception:need(time.monotonic()<deadline,'CLONE_NOT_READY');time.sleep(.2)
  stage='ROLES';acl.compare_builtin_postgres(snapshot,json.loads(query(acl.POSTGRES_ROLE_SQL)));acl.compare_builtin_memberships(snapshot,json.loads(query(acl.BUILTIN_MEMBERSHIPS_SQL)))
  if roles_sql:query(roles_sql)
  stage='RESTORE';core.pipe(['/usr/bin/openssl','enc','-d','-aes-256-cbc','-pbkdf2','-pass','file:'+str(paths['key']),'-in',str(paths['archive'])],[docker,'exec','--user','postgres','-i',cid,'pg_restore','--exit-on-error','--username=postgres','--dbname=workspacex'])
  stage='VERIFY_COMPLETE';need(ledger()==complete,'RESTORED_COMPLETE_LEDGER_DRIFT');actual_catalog=json.loads(query(acl.CATALOG_SQL));core.save(out/'restored-catalog.json',actual_catalog);need(actual_catalog==snapshot['catalog'],'RESTORED_OWNER_ACL_DRIFT')
  core.save(out/'restored.json',{'status':'COMPLETE_SCHEMA_RESTORED','ledgerCount':438,'ledgerSha256':core.sha(json.dumps(complete,sort_keys=True).encode()),'archiveSha256':inputs['archive']['sha256'],'cloneImageId':image,'sourceOwnerAclRestored':True})
  stage='APP_ROLE';need(any(r['name']=='app_rw' and r['login'] for r in snapshot['roles']),'APP_LOGIN_REQUIRED');query(acl.app_transaction(),'app_rw');need(query("SELECT count(*) FROM billing_monthly_orders WHERE order_id='00000000-0000-4000-8000-000000000607'")=='0','APP_ROLLBACK_UNPROVEN')
  need(ledger()==complete and json.loads(query(acl.CATALOG_SQL))==snapshot['catalog'],'COMPLETE_FINAL_CATALOG_DRIFT')
  # Revalidate protected originals after restore before success publication.
  read_inputs(inputs,image)
 except Exception as error:failure=str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z0-9_]{1,100}',str(error)) else 'COMPLETE_RESTORE_FAILED'
 finally:
  try:
   ids=d.run(['ps','--all','--no-trunc','--filter','label='+label,'--format','{{.ID}}']).decode().split();need(len(ids)<=1 and (cid is None or not ids or ids==[cid]),'CLONE_CLEANUP_AMBIGUOUS')
   for owned in ids:
    values=d.json(['container','inspect',owned]);need(len(values)==1 and values[0]['Id']==owned and values[0]['Name']=='/'+name and values[0]['Image']==image and values[0]['Config']['Labels'].get('wsx.complete-rehearsal')==token,'CLONE_CLEANUP_OWNER');d.run(['rm','--force','--volumes',owned])
   need(not d.run(['ps','--all','--no-trunc','--filter','label='+label,'--format','{{.ID}}']).strip(),'CLONE_CLEANUP_UNPROVEN');cleanup=True
  except Exception:failure=failure or 'CLONE_CLEANUP_UNPROVEN'
  core.save(out/'cleanup.json',{'name':name,'ownerLabel':label,'removed':cleanup})
  if cleanup and failure is None:
   try:read_inputs(inputs,image)
   except Exception:failure='FRESH_INPUT_REVALIDATION_FAILED'
  result={'status':'COMPLETE_SCHEMA_RESTORE_QUALIFIED' if failure is None and cleanup else 'COMPLETE_RESTORE_FAILED','stage':stage,'code':failure,'scope':'complete-schema-owner-acl-restore-only','schemaState':'COMPLETE','ledgerCount':438,'sqlNotReplayed':True,'reviewedMigrationStatementsExecuted':0,'appRoleTransactionRollback':failure is None,'sourceDatabaseAccessed':False,'productionDatabaseWriteAttempted':False,'activationAllowed':False,'createdAt':time.time(),'sourceBinding':binding,'inputPins':inputs,'roleSettingsAcceptance':'NOT_PERFORMED','apiBootstrap':'NOT_PERFORMED'}
  core.save(out/'receipt.json',result)
 need(failure is None and cleanup,failure or 'COMPLETE_RESTORE_FAILED')
 files=('intent.json','restored.json','restored-catalog.json','cleanup.json','receipt.json')
 core.save(out/'qualification.json',{'kind':'complete-schema-restore-qualification-v1','createdAt':time.time(),'imageId':image,'inputPins':inputs,'sourceBinding':binding,'files':{name:file_sha(out/name) for name in files}})
 return result


def private_output(path):
 out=Path(path);need(out.is_absolute(),'ABSOLUTE_OUTPUT_REQUIRED')
 for item in (*reversed(out.parents),out):
  value=item.lstat();need(value.st_uid==0 and stat.S_ISDIR(value.st_mode) and not stat.S_ISLNK(value.st_mode) and not value.st_mode&0o022,'ROOT_OUTPUT_PARENT')
 need(stat.S_IMODE(out.stat().st_mode)==0o700,'PRIVATE_OUTPUT_DIRECTORY');return out

def validate_qualification(inputs,image,output,now=None):
 """Read-only exact original-proof consumer. Never renews TTL or alters files."""
 need(os.geteuid()==0,'ROOT_COMPLETE_QUALIFICATION_REQUIRED')
 now=time.time() if now is None else now;preflight_tools(inputs,now)
 paths,baseline,complete,snapshot,binding=read_inputs(inputs,image,now)
 out=private_output(output)
 manifest_path=private_fresh(out/'qualification.json',now);need(manifest_path.stat().st_size<=65536,'QUALIFICATION_BOUND');manifest=json.loads(manifest_path.read_bytes())
 names={'intent.json','restored.json','restored-catalog.json','cleanup.json','receipt.json'}
 need({p.name for p in out.iterdir()}==names|{'qualification.json'},'QUALIFICATION_OUTPUT_SET')
 need(manifest.get('kind')=='complete-schema-restore-qualification-v1' and manifest.get('imageId')==image and manifest.get('inputPins')==inputs and manifest.get('sourceBinding')==binding,'QUALIFICATION_BINDING')
 need(type(manifest.get('createdAt')) in (int,float) and 0<=now-manifest['createdAt']<1800 and set(manifest.get('files',{}))==names,'QUALIFICATION_EXPIRED_OR_SET')
 records={}
 for name,checksum in manifest['files'].items():
  path=private_fresh(out/name,now);need(path.stat().st_size<=8*1024*1024 and type(checksum) is str and re.fullmatch('[a-f0-9]{64}',checksum) and file_sha(path)==checksum,'QUALIFICATION_ARTIFACT_HASH');records[name]=json.loads(path.read_bytes())
 intent=records['intent.json'];restored=records['restored.json'];cleanup=records['cleanup.json'];receipt=records['receipt.json'];core=load('schema-restore-rehearsal')
 need(intent.get('sourceBinding')==binding and intent.get('inputPins')==inputs and intent.get('imageId')==image and intent.get('network')=='none' and intent.get('schemaState')=='COMPLETE' and intent.get('sqlReplayAllowed') is False,'QUALIFICATION_INTENT')
 need(restored.get('status')=='COMPLETE_SCHEMA_RESTORED' and restored.get('ledgerCount')==438 and restored.get('ledgerSha256')==core.sha(json.dumps(complete,sort_keys=True).encode()) and restored.get('archiveSha256')==inputs['archive']['sha256'] and restored.get('cloneImageId')==image and restored.get('sourceOwnerAclRestored') is True and records['restored-catalog.json']==snapshot['catalog'],'QUALIFICATION_RESTORED_IDENTITY')
 need(cleanup.get('removed') is True and cleanup.get('name')==intent.get('name') and cleanup.get('ownerLabel')==intent.get('ownerLabel'),'QUALIFICATION_CLEANUP')
 need(receipt.get('status')=='COMPLETE_SCHEMA_RESTORE_QUALIFIED' and receipt.get('sourceBinding')==binding and receipt.get('inputPins')==inputs and receipt.get('schemaState')=='COMPLETE' and receipt.get('ledgerCount')==438 and receipt.get('sqlNotReplayed') is True and type(receipt.get('reviewedMigrationStatementsExecuted')) is int and receipt['reviewedMigrationStatementsExecuted']==0 and receipt.get('appRoleTransactionRollback') is True and receipt.get('productionDatabaseWriteAttempted') is False and receipt.get('sourceDatabaseAccessed') is False and receipt.get('activationAllowed') is False,'QUALIFICATION_RECEIPT')
 need(type(receipt.get('createdAt')) in (int,float) and 0<=now-receipt['createdAt']<1800,'QUALIFICATION_RECEIPT_EXPIRED')
 return {'status':'COMPLETE_SCHEMA_RESTORE_QUALIFIED','sourceBinding':binding,'ledgerCount':438,'sqlNotReplayed':True,'qualificationSha256':file_sha(manifest_path),'createdAt':manifest['createdAt'],'readOnlyValidation':True,'scope':'complete-schema-owner-acl-restore-only','roleSettingsAcceptance':'NOT_PERFORMED','apiBootstrap':'NOT_PERFORMED','productionRecoveryAcceptance':'NOT_PERFORMED'}
