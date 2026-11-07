#!/usr/bin/env python3
"""Fixed US post-COMMIT read-only capture. Library only; never replay migrations.

Historical proofs remain untouched. CAPTURED is not restore or API acceptance.
Caller retains the canonical release flock throughout capture and qualification.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import time
HERE=Path(__file__).resolve().parent
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
CONFIG='/etc/workspacex-image-release/us.json'
OLD='/var/lib/workspacex-image-release/us/tag-maintenance-9ac8c1d2b679466ca8035b68c41bc3b3'
INPUT='/var/lib/workspacex-image-release/us/maintenance-inputs-043cd95adc7149f5b579f602255ccf73/policy.json'
LOCK='/run/workspacex-selfhost-deploy.lock'
TOOLS=('schema-complete-restore.py','schema-restore-rehearsal.py','schema-acl-rehearsal.py','minimal-docker-release.py')
CLOSURE=(*TOOLS,'schema-tag-prepare.py','us-tag-migration-adapter.py','tag-bootstrap-probe.py','schema-acl-source-prepare.py','us-complete-source-capture.py')
def need(v,c):
 if not v:raise ValueError(c)
def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for part in iter(lambda:f.read(1048576),b''):h.update(part)
 return h.hexdigest()
def trusted(path,private=False,directory=False):
 p=Path(path);need(p.is_absolute(),'ROOT_PATH')
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_PATH')
 s=p.stat();need(stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode) and s.st_nlink==1,'REGULAR_INPUT')
 if private:need(not s.st_mode&0o077,'PRIVATE_INPUT')
 return p
def read(path,refs=None):
 p=trusted(path,True);need(p.stat().st_size<=8*1024*1024,'METADATA_BOUND')
 raw=p.read_bytes();value=json.loads(raw)
 if refs is not None:refs[str(p)]=hashlib.sha256(raw).hexdigest()
 return value
def pinned(ref,refs=None):
 need(type(ref) is dict and {'path','sha256'}<=set(ref) and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'PIN_FORMAT')
 p=trusted(ref['path'],ref.get('private',False));need(sha(p)==ref['sha256'],'PIN_DRIFT')
 if refs is not None:refs[str(p)]=ref['sha256']
 return p
def load(name,pins):
 p=trusted(HERE/(name+'.py'));need(sha(p)==pins[p.name],'CODE_DRIFT')
 s=importlib.util.spec_from_file_location('complete_capture_'+name.replace('-','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def complete_ledger(base,current,core):
 core.check_ledger(base)
 need(len(base)==435 and type(current) is dict and len(current)==438 and current=={**base,**core.MIGRATIONS},'EXACT_COMPLETE_LEDGER')
def validate_source(value,collector):
 collector.validate_capture(value,'us');need(value['roleSettings']==[],'SOURCE_ROLE_SETTINGS_UNQUALIFIED');return value
def dump_args(docker,cid):
 need(docker=='/usr/bin/docker' and re.fullmatch('[a-f0-9]{64}',cid),'FIXED_DUMP_SOURCE')
 return [docker,'exec','--user','postgres',cid,'/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000','pg_dump','--host=/var/run/postgresql','--port=5432','--no-password','--username=postgres','--dbname=workspacex','--format=custom']
def history(cfg,old,original_input,core,us,boot,*,archived_recovery=None):
 refs={};p=read(original_input,refs);canonical=read(old/'policy.json',refs)
 if archived_recovery is None:pending_path=Path(cfg['stateDirectory'])/'pending.json'
 else:
  prior_path=pinned({**archived_recovery,'private':True},refs);prior=read(prior_path,refs)
  need(prior.get('kind')=='complete-schema-recovery-v1' and prior.get('status')=='COMPLETE_SCHEMA_RECOVERY_VERIFIED' and prior.get('environment')=='us' and prior.get('sourceRevision')==SOURCE and prior.get('tag')==TAG and prior.get('originalAttempt')==str(old),'ARCHIVED_RECOVERY_IDENTITY')
  need(prior['originalPolicy']=={'path':str(old/'policy.json'),'sha256':refs[str(old/'policy.json')]} and prior['originalInputPolicy']=={'path':str(Path(original_input)),'sha256':refs[str(Path(original_input))]},'ARCHIVED_RECOVERY_POLICY')
  need(all_history_files(old)=={str(old/name):checksum for name,checksum in prior['originalHistory']['files'].items()},'ARCHIVED_RECOVERY_HISTORY_DRIFT')
  pending_path=pinned({**prior['pendingArchive'],'private':True},refs)
  need(pending_path.parent==Path(cfg['stateDirectory']) and pending_path.name.startswith('pending-') and pending_path.name!='pending.json','ARCHIVED_PENDING_PATH')
 pending=read(pending_path,refs)
 need(canonical==p and p['environment']=='us' and p['source']==SOURCE and p['tag']==TAG and p['attempt']==old.name and p['lockFile']==LOCK and p['stateDirectory']==cfg['stateDirectory'] and p['project']==cfg['project'],'HISTORICAL_POLICY_BINDING')
 need(pending=={'kind':'reviewed-schema-maintenance','attempt':str(old),'policySha256':refs[str(Path(original_input))],'source':SOURCE,'tag':TAG},'HISTORICAL_PENDING_BINDING')
 ackpath=old/'databaseCommand-apply.json';ack=read(ackpath,refs);acktime=ackpath.stat().st_mtime
 need(all(ack.get(k)==v for k,v in {'status':'COMMITTED','commitAcknowledged':True,'ledgerCount':438,'environment':'us','source':SOURCE,'tag':TAG}.items()) and type(ack.get('commitAcknowledged')) is bool,'COMMIT_ACK_REQUIRED')
 need(type(p.get('preparedAt')) in (int,float) and 0<=acktime-p['preparedAt']<3600,'ORIGINAL_PREPARATION_EXPIRED')
 intentpath=old/'database-transaction-intent.json';intent=read(intentpath,refs)
 need(intent=={'source':SOURCE,'tag':TAG,'environment':'us','status':'TRANSACTION_INTENT'} and intentpath.stat().st_mtime<=acktime,'TRANSACTION_INTENT_BINDING')
 prepared_path=pinned(p['preparationReceipt'],refs);prepared=read(prepared_path,refs)
 need(all(prepared.get(k)==v for k,v in {'status':'PREPARED_FOR_MAINTENANCE','environment':'us','source':SOURCE,'tag':TAG}.items()) and prepared_path.stat().st_mtime<=acktime,'PREPARATION_RECEIPT_BINDING')
 db=p['usDatabase'];base=db['baselineLedger'];core.check_ledger(base);need(len(base)==435,'BASELINE_COUNT')
 expected={'environment':'us','source':SOURCE,'tag':TAG,'database':'workspacex','role':'postgres','attempt':str(old),'postgresContainerId':db['containerId'],'postgresImageId':db['imageId'],'targetApiImageId':db['targetApiImageId'],'ledgerSha256':core.sha(json.dumps(base,sort_keys=True).encode())}
 proof=us.validate_backup(old,expected,core,trusted,now=acktime)
 for name in ('qualification.json',*proof['files']):
  path=trusted(old/'stopped-backup'/name,True);need(path.stat().st_mtime<=acktime,'BACKUP_AFTER_COMMIT');refs[str(path)]=sha(path)
 reconcile=read(old/'databaseCommand-reconcile.json',refs)
 need(all(reconcile.get(k)==v for k,v in {'status':'COMPLETE','readOnly':True,'environment':'us','source':SOURCE,'tag':TAG}.items()),'ORIGINAL_RECONCILE_REQUIRED')
 receipt=read(old/'bootstrapProbe-preactivate.json',refs);image=p['bootstrapProbe']['binding']['image'];digest=image['image'].split('@')[-1]
 need(all(receipt.get(k)==v for k,v in {'status':'CANDIDATE_BOOTSTRAP_COMPATIBLE','environment':'us','source':SOURCE,'tag':TAG,'attempt':str(old),'imageId':db['targetApiImageId'],'imageDigest':digest,'readOnlyTransaction':True,'productionWriteStatements':0}.items()),'BOOTSTRAP_HISTORY_BINDING')
 rawpath=pinned({**receipt['rawOutput'],'private':True},refs);need(rawpath.parent==old and rawpath.stat().st_size<=65536,'BOOTSTRAP_RAW_BOUND')
 boot.validate_output(rawpath.read_bytes(),SOURCE,digest)
 for spec in ('databaseCommand','backupCommand','oldApplicationProbe','bootstrapProbe'):
  pinned(p[spec]['executable'],refs)
  for ref in p[spec]['inputs']:pinned(ref,refs)
 for ref in p['configurationPins']:pinned(ref,refs)
 return p,refs,sha(pending_path)
def all_history_files(old):
 """Pin every existing original regular file, including encrypted archives."""
 files={};total=0;directories=1;stack=[trusted(old,True,True)]
 while stack:
  directory=stack.pop()
  for path in directory.iterdir():
   s=path.lstat();need(not stat.S_ISLNK(s.st_mode),'HISTORY_SYMLINK')
   if stat.S_ISDIR(s.st_mode):
    directories+=1;need(directories<=128,'HISTORY_DIRECTORY_BOUND');stack.append(trusted(path,True,True));continue
   path=trusted(path,True);total+=s.st_size
   need(len(files)<512 and total<=512*1024*1024,'HISTORY_TOTAL_BOUND');files[str(path)]=sha(path)
 return files
def capture_complete(config_path,original_attempt,original_input,lock_fd,*,closure_pins=None,archived_recovery=None):
 need((str(config_path),str(original_attempt),str(original_input))==(CONFIG,OLD,INPUT),'FIXED_INPUTS')
 need(os.geteuid()==0,'ROOT_REQUIRED')
 cfg=read(config_path);need(cfg['environment']=='us' and cfg['lockFile']==LOCK and cfg['docker']=='/usr/bin/docker','CONFIG_BINDING')
 # The pinned root caller supplies the ENTIRE closure; historical config is immutable.
 pins=closure_pins;need(type(pins) is dict and set(pins)==set(CLOSURE),'CAPTURE_CLOSURE_PINS_REQUIRED')
 for name in CLOSURE:
  code=trusted(HERE/name);need(code.stat().st_size<=2*1024*1024 and re.fullmatch('[a-f0-9]{64}',pins[name]) and sha(code)==pins[name],'CAPTURE_CLOSURE_DRIFT')
 core=load('schema-restore-rehearsal',pins);us=load('us-tag-migration-adapter',pins);prep=load('schema-tag-prepare',pins);engine=load('minimal-docker-release',pins);acl=load('schema-acl-rehearsal',pins);collector=load('schema-acl-source-prepare',pins);boot=load('tag-bootstrap-probe',pins)
 us.inherited_lock(lock_fd,LOCK);old=trusted(original_attempt,True,True);trusted(cfg['stateDirectory'],True,True)
 p,refs,pendinghash=history(cfg,old,original_input,core,us,boot,archived_recovery=archived_recovery);refs.update(all_history_files(old));refs[str(Path(config_path))]=sha(config_path)
 for ref in (*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[])):pinned(ref,refs)
 d=engine.Docker(str(trusted(cfg['docker'])));services=('api','web','agent','sandbox','sandbox-sessions')
 def runtime():
  rows={s:prep.live_service(d,cfg['project'],s) for s in services}
  for s,r in rows.items():need(r['Image']==p['baseline'][s]['imageId'],'BASELINE_RUNTIME_IMAGE_DRIFT')
  return {s:{'containerId':r['Id'],'imageId':r['Image'],'configSha256':core.sha(json.dumps(r['Config'],sort_keys=True).encode()),'networkSha256':core.sha(json.dumps(r.get('NetworkSettings',{}),sort_keys=True).encode())} for s,r in rows.items()},rows
 before_runtime,rows=runtime();pg=prep.live_service(d,cfg['project'],'postgres');prep.source_binding(rows['api'],pg);db=p['usDatabase']
 need(pg['Id']==db['containerId'] and pg['Image']==db['imageId'],'POSTGRES_BINDING')
 target=d.json(['image','inspect',db['targetApiImageId']])[0];targetref=p['bootstrapProbe']['binding']['image']['image']
 need(target['Id']==db['targetApiImageId'] and targetref in target.get('RepoDigests',[]) and target['Config']['Labels'].get('org.opencontainers.image.revision')==SOURCE and target.get('Os')=='linux' and target.get('Architecture')=='amd64','CANDIDATE_IMAGE_BINDING')
 sql=collector.query_sql(acl.CATALOG_SQL,'postgres');prefix=dump_args(cfg['docker'],pg['Id'])[:9]
 def source():
  raw=d.run(prefix[1:]+['psql','--host=/var/run/postgresql','--port=5432','-X','-w','-qAt','--username=postgres','--dbname=workspacex','-v','ON_ERROR_STOP=1','-c',sql],timeout=45)
  need(len(raw.encode() if isinstance(raw,str) else raw)<=8*1024*1024,'SOURCE_OUTPUT_BOUND');value=validate_source(json.loads(raw),collector);complete_ledger(db['baselineLedger'],value['ledger'],core);return value
 before=source();out=Path(tempfile.mkdtemp(prefix='complete-source-',dir=cfg['stateDirectory']));out.chmod(0o700)
 core.save(out/'intent.json',{'status':'CAPTURE_INTENT','source':SOURCE,'tag':TAG,'environment':'us','originalAttempt':str(old),'sourceDatabaseWriteAttempted':False})
 archive,key=core.encrypt_dump(dump_args(cfg['docker'],pg['Id']),out);core.private_backup_files(archive,key)
 after=source();after_runtime,_=runtime();livepg=prep.live_service(d,cfg['project'],'postgres')
 need(all(before[k]==after[k] for k in ('ledger','roles','memberships','roleSettings','catalog')) and before_runtime==after_runtime and all(pg[k]==livepg[k] for k in ('Id','Image','Config','NetworkSettings')),'CAPTURE_SOURCE_DRIFT')
 us.inherited_lock(lock_fd,LOCK)
 need(all_history_files(old)=={path:checksum for path,checksum in refs.items() if Path(path).is_relative_to(old)},'HISTORY_FILESET_DRIFT')
 for path,checksum in refs.items():need(sha(trusted(path))==checksum,'CAPTURE_INPUT_DRIFT')
 for name,checksum in pins.items():need(sha(trusted(HERE/name))==checksum,'CAPTURE_CODE_DRIFT')
 st=os.fstat(lock_fd)
 binding={'environment':'us','sourceRevision':SOURCE,'tag':TAG,'database':'workspacex','role':'postgres','postgresImageId':pg['Image'],'sourceContainerId':pg['Id'],'targetApiImageId':target['Id'],'targetApiRepoDigest':targetref,'toolPins':{n:pins[n] for n in TOOLS},'captureClosurePins':pins,'capturedAt':time.time(),'originalAttempt':str(old),'originalPolicySha256':refs[str(old/'policy.json')],'originalInputPolicySha256':refs[str(Path(original_input))],'originalEvidenceHashes':refs,'pendingSha256':pendinghash,'canonicalLock':{'path':LOCK,'device':st.st_dev,'inode':st.st_ino},'liveBaselineRuntime':before_runtime,'scope':'readonly-complete-source-capture-only','activationAllowed':False}
 snapshot={k:before[k] for k in ('roles','memberships','catalog')};snapshot['migrationRole']='postgres'
 paths={'archive':archive,'key':key}
 for name,value in {'snapshot':snapshot,'baselineLedger':db['baselineLedger'],'completeLedger':before['ledger'],'binding':binding}.items():
  paths[name]=out/(name+'.json');core.save(paths[name],value)
 return {name:{'path':str(path),'sha256':sha(path)} for name,path in paths.items()}
