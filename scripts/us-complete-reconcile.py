#!/usr/bin/env python3
"""Root library: qualify existing US COMPLETE state; never migrate or activate.

No CLI, stop/start, nginx edits, role changes or migration apply. The last state
transition archives the unchanged historical pending marker under the same lock.
"""
import copy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import time
import uuid
HERE=Path(__file__).resolve().parent
CONFIG='/etc/workspacex-image-release/us.json';LOCK='/run/workspacex-selfhost-deploy.lock'
OLD='/var/lib/workspacex-image-release/us/tag-maintenance-9ac8c1d2b679466ca8035b68c41bc3b3'
INPUT='/var/lib/workspacex-image-release/us/maintenance-inputs-043cd95adc7149f5b579f602255ccf73/policy.json'
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
CLOSURE=('us-complete-reconcile.py','us-complete-source-capture.py','schema-complete-restore.py','schema-restore-rehearsal.py','schema-acl-rehearsal.py','minimal-docker-release.py','schema-tag-prepare.py','us-tag-migration-adapter.py','tag-bootstrap-probe.py','schema-acl-source-prepare.py','tag-maintenance-release.py','tag-migrated-activation.py','schema-release-handoff.py')
QUIET_SQL="BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SELECT json_build_object('activeRuns',(SELECT count(*)::int FROM public.agent_runs WHERE status IS NULL OR status NOT IN ('succeeded','failed','cancelled')),'preparedTransactions',(SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database())); ROLLBACK;"
def need(v,c):
 if not v:raise ValueError(c)
def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for part in iter(lambda:f.read(1048576),b''):h.update(part)
 return h.hexdigest()
def trusted(path,private=False):
 p=Path(path);need(p.is_absolute(),'ROOT_PATH')
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_PATH')
 s=p.stat();need(stat.S_ISREG(s.st_mode) and s.st_nlink==1,'REGULAR_INPUT')
 if private:need(not s.st_mode&0o077,'PRIVATE_INPUT')
 return p
def load(name,pins):
 p=trusted(HERE/(name+'.py'));need(sha(p)==pins[p.name],'RECONCILE_CODE_DRIFT');s=importlib.util.spec_from_file_location('us_complete_'+name.replace('-','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def check_quiet(value):
 need(type(value) is dict and set(value)=={'activeRuns','preparedTransactions'} and all(type(v) is int and v==0 for v in value.values()),'DATABASE_NOT_QUIET')
def archive_pending(path,destination,checksum):
 need(path.parent==destination.parent and destination.name.startswith('pending-') and not destination.exists() and not destination.is_symlink() and sha(path)==checksum,'PENDING_CAS')
 # Atomic rename only after every proof is durable. No truncation or reserialization.
 os.rename(path,destination)
 fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 except BaseException:
  if not path.exists() and sha(destination)==checksum:os.rename(destination,path);os.fsync(fd)
  raise
 finally:os.close(fd)
PRIOR='/var/lib/workspacex-image-release/us/tag-maintenance-da8bfd6781134c748e669f74d0b9cc26/complete-recovery.json'
FAILED_ATTEMPT='/var/lib/workspacex-image-release/us/attempt-51c94e15ec2e485e89fe10bae71a8b44'
def prebind_names(names):
 base={'images.json','manifest.json','receipt.json','schema-config.json','schema-plan.json','schema-request.json'}
 need(base<=names,'PREBIND_FILE_SET')
 extra=names-base;tokens=set()
 for name in extra:
  match=re.fullmatch('probe-([a-f0-9]{32})(-cleanup)?[.]json',name);need(match is not None,'PREBIND_UNEXPECTED_ARTIFACT');tokens.add(match[1])
 need(len(tokens)==6 and extra=={name for token in tokens for name in ('probe-'+token+'.json','probe-'+token+'-cleanup.json')},'PREBIND_PROBE_PAIRS')
def refresh_inputs(refresh,cfg,capture,activation,maint,restore,us,fd,now=None):
 now=time.time() if now is None else now
 need(type(refresh) is dict and set(refresh)=={'priorRecovery','preBindFailureAudit'},'EXPLICIT_REFRESH_REQUIRED')
 priorref=refresh['priorRecovery'];need(type(priorref) is dict and priorref.get('path')==PRIOR,'FIXED_PRIOR_RECOVERY')
 priorpath=capture.pinned({**priorref,'private':True});prior=capture.read(priorpath)
 need(type(prior.get('createdAt')) in (int,float) and prior['createdAt']<=now,'PRIOR_RECOVERY_TIME')
 auditpath=capture.pinned({**refresh['preBindFailureAudit'],'private':True});audit=capture.read(auditpath)
 need(audit.get('kind')=='reviewed-pre-bind-failure-v1' and audit.get('attempt')==FAILED_ATTEMPT and audit.get('priorRecovery')==priorref and audit.get('reason')=='MANIFEST_PRIVATE_FILE_REQUIRED_BEFORE_WRITER_BIND' and audit.get('writerNeverStarted') is True and audit.get('automaticRetryAllowed') is False,'PREBIND_OPERATOR_AUDIT')
 need(type(audit.get('createdAt')) in (int,float) and 0<=now-audit['createdAt']<1800,'PREBIND_AUDIT_EXPIRED')
 attempt=Path(FAILED_ATTEMPT);need(attempt.parent==Path(cfg['stateDirectory']),'PREBIND_STATE')
 names={p.name for p in attempt.iterdir()};prebind_names(names);need(set(audit['files'])==names,'PREBIND_AUDIT_FILE_SET')
 for name,checksum in audit['files'].items():capture.pinned({'path':str(attempt/name),'sha256':checksum,'private':name not in ('manifest.json','images.json') and not name.startswith('probe-')})
 pendingref=audit['pending'];need(pendingref['path']==str(Path(cfg['stateDirectory'])/'pending.json'),'PREBIND_PENDING_PATH');pendingpath=capture.pinned({**pendingref,'private':True});pending=capture.read(pendingpath)
 requestpath=attempt/'schema-request.json';request=capture.read(requestpath)
 need(pending.get('attempt')==str(attempt) and pending.get('requestSha256')==sha(requestpath) and pending.get('tag')==TAG and pending.get('route')=='schema-preparation','PREBIND_PENDING_BINDING')
 failure=capture.read(attempt/'receipt.json');need(failure.get('status')=='FAILED_OR_UNCERTAIN' and failure.get('code')=='SCHEMA_RELEASE_RECONCILIATION_REQUIRED' and failure.get('stage')=='schema-release','PREBIND_FAILURE_RECEIPT')
 rootpolicy=capture.read('/etc/workspacex-image-release/us-tag-activation.json');need(rootpolicy.get('completeRecovery')==priorref,'PRIOR_ROOT_POLICY_BINDING')
 read=lambda ref:json.loads(capture.pinned({**ref,'private':ref!=request['manifest']}).read_bytes())
 # Historical admission time is solely for authenticating the previous evidence.
 # It is never used to qualify the new capture or the next activation.
 adapter=us.Adapter(Path(OLD),fd)
 activation.complete_recovery(rootpolicy,request,cfg,capture.read(INPUT),Path(OLD),adapter,None,maint,restore,us,read,now=prior['createdAt'])
 need(prior.get('refreshOf') is None,'REFRESH_CHAIN_FORBIDDEN')
 return prior,audit,priorref,pendingref

def reconcile_complete(closure_pins,*,refresh=None):
 need(os.geteuid()==0,'ROOT_REQUIRED')
 need(type(closure_pins) is dict and set(closure_pins)==set(CLOSURE),'COMPLETE_RECONCILE_CLOSURE')
 for name in CLOSURE:
  code=trusted(HERE/name);need(code.stat().st_size<=2*1024*1024 and re.fullmatch('[a-f0-9]{64}',closure_pins[name]) and sha(code)==closure_pins[name],'COMPLETE_RECONCILE_CODE_DRIFT')
 capture=load('us-complete-source-capture',closure_pins);core=load('schema-complete-restore',closure_pins);restore=load('schema-restore-rehearsal',closure_pins);maint=load('tag-maintenance-release',closure_pins);us=load('us-tag-migration-adapter',closure_pins);prep=load('schema-tag-prepare',closure_pins);engine=load('minimal-docker-release',closure_pins);activation=load('tag-migrated-activation',closure_pins)
 need(set(capture.CLOSURE)<=set(closure_pins),'CAPTURE_CLOSURE_INCOMPLETE')
 cfg=capture.read(CONFIG);need(cfg['environment']=='us' and cfg['lockFile']==LOCK and cfg['docker']=='/usr/bin/docker','FIXED_CONFIG')
 lock=trusted(LOCK,True);fd=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW);previous={}
 def interrupted(*_):raise RuntimeError('COMPLETE_RECONCILE_INTERRUPTED')
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);us.inherited_lock(fd,LOCK)
  for sig in (signal.SIGTERM,signal.SIGHUP):previous[sig]=signal.signal(sig,interrupted)
  old=Path(OLD);previous_recovery=None;failed_pending=None
  if refresh is not None:
   previous_recovery,audit,priorref,failed_pending=refresh_inputs(refresh,cfg,capture,activation,maint,restore,us,fd)
  archive_ref=None if previous_recovery is None else previous_recovery['pendingArchive']
  history_args={} if refresh is None else {'archived_recovery':refresh['priorRecovery']}
  p,history,pendinghash=capture.history(cfg,old,INPUT,restore,us,load('tag-bootstrap-probe',closure_pins),**history_args);oldfiles=capture.all_history_files(old)
  d=engine.Docker('/usr/bin/docker');baseline=p['baseline']
  def stable_runtime():
   rows=[prep.live_service(d,cfg['project'],s) for s in sorted(maint.SERVICES)];maint.runtime_set(rows,cfg['project'],baseline,True)
   return {r['Id']:{k:r[k] for k in ('Id','Image','Config','NetworkSettings')} for r in rows},rows
  runtime,rows=stable_runtime();marker=maint.startup_marker(rows)
  def quiet():
   uncertain=Path('/var/lib/workspacex-selfhost-state/business-probe-uncertain');need(not uncertain.exists() and not uncertain.is_symlink(),'PROBE_PREVIOUSLY_UNCERTAIN')
   for label in ('wsx.us-maintenance-probe','wsx.bootstrap-probe'):
    need(not d.run(['ps','--all','--no-trunc','--quiet','--filter','label='+label]).strip(),'OWNED_PROBE_REMAINS')
   args=us.psql_args(p['usDatabase']['containerId']);raw=d.run(args[1:]+['-c',QUIET_SQL],limit=65536,timeout=15);value=json.loads(raw);check_quiet(value);return value
  quiet_before=quiet()
  attempt=Path(cfg['stateDirectory'])/('tag-maintenance-'+uuid.uuid4().hex)
  barrier=Path(cfg['stateDirectory'])/(('complete-reconciliation-'+pendinghash) if refresh is None else ('complete-refresh-'+refresh['priorRecovery']['sha256']))
  barrier=barrier.with_suffix('.json')
  # Durable O_EXCL barrier survives lost stdout/ACK and rejects all auto-reentry.
  need(not barrier.exists() and not barrier.is_symlink(),'RECONCILIATION_ALREADY_ATTEMPTED')
  restore.save(barrier,{'kind':'complete-schema-reconciliation-intent-v1','originalAttempt':OLD,'pendingSha256':pendinghash,'sourceRevision':SOURCE,'tag':TAG,'recoveryAttempt':str(attempt),'closurePins':closure_pins,'createdAt':time.time(),'automaticRetryAllowed':False,'refresh':refresh})
  inputs=capture.capture_complete(CONFIG,OLD,INPUT,fd,closure_pins={n:closure_pins[n] for n in capture.CLOSURE},**({} if refresh is None else {'archived_recovery':refresh['priorRecovery']}))
  binding=capture.read(inputs['binding']['path']);image=binding['postgresImageId'];capture_dir=Path(inputs['binding']['path']).parent
  isolated=capture_dir/'complete-isolated';core.qualify_complete('/usr/bin/docker',image,inputs,isolated)
  qualification=core.validate_qualification(inputs,image,isolated)
  attempt.mkdir(mode=0o700)
  fresh=copy.deepcopy(p);fresh.update(kind='complete-schema-recovery',attempt=attempt.name,preparedAt=time.time())
  restore.save(attempt/'policy.json',fresh);host=maint.Host(fresh,attempt,fd)
  readiness=maint.readiness_pair('us',marker,host.run,3);restore.save(attempt/'readiness.json',readiness)
  # Exactly one new candidate preactivation probe, and one real old-business probe.
  restore.save(attempt/'bootstrap-once-intent.json',{'reconciliationIntent':{'path':str(barrier),'sha256':sha(barrier)},'sourceRevision':SOURCE,'tag':TAG,'createdAt':time.time()})
  bootstrap=host.adapter('bootstrapProbe','preactivate');need(bootstrap.get('status')=='CANDIDATE_BOOTSTRAP_COMPATIBLE','FRESH_BOOTSTRAP_FAILED')
  restore.save(attempt/'business-once-intent.json',{'reconciliationIntent':{'path':str(barrier),'sha256':sha(barrier)},'sourceRevision':SOURCE,'tag':TAG,'createdAt':time.time(),'automaticRetryAllowed':False})
  business=host.adapter('oldApplicationProbe','verify');need(business.get('status')=='OLD_APPLICATION_VERIFIED','FRESH_BUSINESS_FAILED')
  bootstrap_files=list(attempt.glob('bootstrap-receipt-*.json'));need(len(bootstrap_files)==1,'BOOTSTRAP_RECEIPT_SET')
  boot_path=bootstrap_files[0];boot_receipt=capture.read(boot_path);rawref=boot_receipt['rawOutput'];capture.pinned({**rawref,'private':True})
  need(bootstrap==boot_receipt and Path(rawref['path']).parent==attempt and re.fullmatch('bootstrap-raw-[a-f0-9]{32}[.]txt',Path(rawref['path']).name),'ORIGINAL_BOOTSTRAP_RECEIPT_BINDING')
  quiet_after=quiet();now_runtime,now_rows=stable_runtime();need(now_runtime==runtime and maint.startup_marker(now_rows)==marker,'FINAL_RUNTIME_DRIFT')
  # Read-only adapter reconcile cannot replay the committed SQL.
  adapter=us.Adapter(old,fd);need(adapter.run('reconcile').get('status')=='COMPLETE','FINAL_LEDGER_DRIFT')
  core.validate_qualification(inputs,image,isolated)
  need(capture.all_history_files(old)==oldfiles,'ORIGINAL_HISTORY_DRIFT')
  for path,checksum in binding['originalEvidenceHashes'].items():need(sha(trusted(path))==checksum,'HISTORY_OR_CONFIG_DRIFT')
  for name,checksum in closure_pins.items():need(sha(trusted(HERE/name))==checksum,'FINAL_CODE_DRIFT')
  us.inherited_lock(fd,LOCK);st=os.fstat(fd);lock_identity={'path':LOCK,'device':st.st_dev,'inode':st.st_ino}
  need(boot_receipt.get('canonicalLock')==lock_identity and binding['canonicalLock']==lock_identity,'FINAL_LOCK_DRIFT')
  ref=lambda path:{'path':str(path),'sha256':sha(path)}
  pending=Path(cfg['stateDirectory'])/'pending.json';archive=pending.with_name('pending-complete-'+uuid.uuid4().hex+'.json')
  receipt={'kind':'complete-schema-recovery-v1','status':'COMPLETE_SCHEMA_RECOVERY_VERIFIED','environment':'us','sourceRevision':SOURCE,'tag':TAG,'createdAt':time.time(),'originalAttempt':OLD,'originalPolicy':ref(old/'policy.json'),'originalInputPolicy':ref(Path(INPUT)),'originalHistory':{'files':{str(Path(path).relative_to(old)):checksum for path,checksum in oldfiles.items()}},'originalAck':ref(old/'databaseCommand-apply.json'),'originalBackup':{'qualification':ref(old/'stopped-backup/qualification.json'),'validAt':(old/'databaseCommand-apply.json').stat().st_mtime},'pendingArchive':({'path':str(archive),'sha256':pendinghash} if archive_ref is None else archive_ref),'freshPolicy':ref(attempt/'policy.json'),'recoveryAttempt':str(attempt),'freshBackup':{'inputs':inputs,'image':image,'output':str(isolated),'qualification':ref(isolated/'qualification.json')},'bootstrap':{'receipt':ref(boot_path),'raw':rawref},'business':ref(attempt/'oldApplicationProbe-verify.json'),'readiness':ref(attempt/'readiness.json'),'quietBefore':quiet_before,'quietAfter':quiet_after,'canonicalLock':lock_identity,'reconciliationIntent':ref(barrier),'businessOnceIntent':ref(attempt/'business-once-intent.json'),'bootstrapOnceIntent':ref(attempt/'bootstrap-once-intent.json'),'scope':'complete-schema-owner-acl-restore-bootstrap-old-business-only','targetImageActivated':False,'productionMigrationExecuted':False}
  if refresh is not None:
   failed_archive=pending.with_name('pending-prebind-'+uuid.uuid4().hex+'.json')
   receipt.update(refreshOf=refresh['priorRecovery'],preBindFailure={'audit':refresh['preBindFailureAudit'],'pendingArchive':{'path':str(failed_archive),'sha256':failed_pending['sha256']}})
  activation.recovery_identity(receipt,'us',old,ref(old/'policy.json'),time.time())
  restore.save(attempt/'complete-recovery.json',receipt)
  # Recheck exact current original bytes immediately before final state transition.
  need(capture.all_history_files(old)==oldfiles,'ORIGINAL_HISTORY_DRIFT');quiet();need(stable_runtime()[0]==runtime,'FINAL_RUNTIME_DRIFT')
  if refresh is None:archive_pending(pending,archive,pendinghash)
  else:
   # Repeat the exact finite failure audit after all new probes before archiving.
   refresh_inputs(refresh,cfg,capture,activation,maint,restore,us,fd)
   archive_pending(pending,failed_archive,failed_pending['sha256'])
  return ref(attempt/'complete-recovery.json')
 finally:
  for sig,handler in previous.items():signal.signal(sig,handler)
  os.close(fd)
