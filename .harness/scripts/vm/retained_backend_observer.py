"""Parent-only observer over existing retained backup channels. Never reconnects.
The caller invokes this in the owner process/event loop, not bounded_observe's
fork. cn_backup_stream currently requires a parent-owned relay before use.
"""
import os,time,math,hashlib,re
from pathlib import Path
from cn_backup_package import dump_command
from candidate_backend_collector import process_snapshot
from current_held_epoch_evidence_producer import write_collection
from writer_fence import digest
from cn_backup_backend import BackupBackendCollector
from cn_backup_package import validate
from writer_fence import DATABASES,require

class RetainedObserverSource:
 def __init__(self,plan,channel,authority,deadline=None):
  self.plan=plan;self.channel=channel;self.authority=authority
  self.parent_pid=os.getpid();self.binding=dict(channel.pinned);self.deadline=deadline
 def owner(self):
  require(os.getpid()==self.parent_pid,'RETAINED_OBSERVER_FORK_FORBIDDEN')
  require(self.channel.channel.binding==self.binding,'RETAINED_OBSERVER_SESSION_DRIFT')
 def remaining(self):
  if self.deadline is None:return 10
  left=self.deadline-time.monotonic();require(left>0,'RETAINED_OBSERVER_DEADLINE');return min(10,left)
 def authority_call(self,name,*args):
  self.owner();budget=self.remaining();fn=getattr(self.authority,name)
  if self.deadline is None:return fn(*args)
  # Source authority commands must honour this timeout; old unbounded methods
  # intentionally fail instead of silently falling back.
  result=fn(*args,timeout_seconds=budget);self.remaining();return result
 def request(self,message):
  self.owner();budget=self.remaining()
  if self.deadline is None:return self.channel.request(message)
  result=self.channel.request(message,deadline_seconds=budget);self.remaining();return result
 def verify_backup_context(self,plan,db,cid,pid,app):
  self.owner();require(plan==self.plan and db==self.channel.database,'RETAINED_OBSERVER_PLAN_BINDING')
  self.authority_call('verify_backup_context',plan,db,cid,pid,app)
 def verified_pg_dump16(self):self.owner();return self.authority_call('verified_pg_dump16')
 def docker_inventory(self):self.owner();return self.authority_call('docker_inventory')
 def read_backup_database_sessions(self,db):
  self.owner();require(db==self.channel.database,'RETAINED_OBSERVER_DATABASE')
  self.request({'operation':'query','queryId':'begin-readonly'})
  try:
   reply=self.request({'operation':'query','queryId':'backup-sessions'})
   require(len(reply['fields'])==1 and len(reply['rows'])==1,'RETAINED_OBSERVER_SESSION_ROWS')
   return reply['rows'][0][reply['fields'][0]]
  finally:self.request({'operation':'query','queryId':'rollback-readonly'})
 def verify_backup_peer(self,plan,peer):
  self.owner();require(plan==self.plan and peer==self.binding['peer'],'RETAINED_OBSERVER_PEER')
  self.authority_call('verify_backup_peer',plan,peer)
 def verify_existing_no_tls_exception(self,plan,facts):
  self.owner();require(plan==self.plan,'RETAINED_OBSERVER_TLS_PLAN')
  result=self.channel.verify_backup_transport(facts,deadline_seconds=self.remaining()) if self.deadline is not None else self.channel.verify_backup_transport(facts)
  self.remaining();return result is True

class RetainedBackendObserver:
 def __init__(self,plan,channels,authority,proc_root='/proc',*,expected_identity):
  validate(plan,expected_identity=expected_identity);
  self.expected_identity=dict(expected_identity);require(set(channels)==set(DATABASES),'RETAINED_OBSERVER_THREE_CHANNELS')
  self.plan=plan;self.channels=channels;self.authority=authority;self.proc=proc_root;self.pid=os.getpid();self.deadline=None
 def collect(self,db,container_id,process_pid,application_name):
  require(os.getpid()==self.pid,'RETAINED_OBSERVER_PARENT_ONLY')
  require(db in DATABASES,'RETAINED_OBSERVER_DATABASE')
  source=RetainedObserverSource(self.plan,self.channels[db],self.authority,self.deadline)
  return BackupBackendCollector(source,self.proc).collect(self.plan,db,container_id,process_pid,application_name,expected_identity=self.expected_identity)

class SourceOwnedParentObservation:
 """Source-only direct stream observer. Never suitable for fork callbacks.
 container/backend PID must originate from actual owned registry/Docker top.
 Each call persists a verified collector proof, not a callback's truthy flag.
 """
 def __init__(self,observer,database,container_id,backend_process_pid,application_name,
              container_name,owner,helper_sha256,deadline_monotonic,proof_path):
  require(type(observer) is RetainedBackendObserver,'PARENT_OBSERVATION_SOURCE_TYPE')
  require(database in DATABASES,'PARENT_OBSERVATION_DATABASE')
  deferred=container_id is None and backend_process_pid is None
  if deferred:
   from retained_backup_host import RetainedBackupHostObserverAuthority
   require(type(observer.authority) is RetainedBackupHostObserverAuthority,'PARENT_OBSERVATION_DEFERRED_SOURCE')
  else:require(re.fullmatch('[a-f0-9]{64}',container_id or '') and type(backend_process_pid) is int and backend_process_pid>1,'PARENT_OBSERVATION_BACKEND_BINDING')
  require(application_name=='wsx-backup-'+observer.plan['identity']['attemptId']+'-'+database,'PARENT_OBSERVATION_APPLICATION')
  require(type(deadline_monotonic) in (int,float) and math.isfinite(deadline_monotonic) and time.monotonic()<deadline_monotonic<=time.monotonic()+330,'PARENT_OBSERVATION_DEADLINE')
  require(re.fullmatch('[a-f0-9]{64}',helper_sha256 or ''),'PARENT_OBSERVATION_HELPER_HASH')
  self.observer=observer;self.database=database;self.container_id=container_id;self.backend_pid=backend_process_pid;self.application_name=application_name
  self.command=dump_command(observer.plan,database,container_name,owner,expected_identity=observer.expected_identity)
  self.helper_sha256=helper_sha256;self.deadline=deadline_monotonic;self.proof_path=Path(proof_path)
  self.pid=os.getpid();self.receipts=[];self.proof=None;self.helper_pid=None;self.deferred=deferred
 def __call__(self,producerPID):
  require(os.getpid()==self.pid==self.observer.pid,'PARENT_OBSERVATION_OWNER')
  require(type(producerPID) is int and producerPID>1 and (self.helper_pid is None or self.helper_pid==producerPID),'PARENT_OBSERVATION_HELPER_PID')
  require(time.monotonic()<self.deadline,'PARENT_OBSERVATION_DEADLINE')
  root=Path(self.observer.proc)/str(producerPID);before=process_snapshot(root)
  require((root/'cmdline').read_bytes().split(b'\0')==[s.encode() for s in self.command]+[b''],'PARENT_OBSERVATION_HELPER_COMMAND')
  require(os.readlink(root/'exe')==self.command[0] and hashlib.sha256((root/'exe').read_bytes()).hexdigest()==self.helper_sha256,'PARENT_OBSERVATION_HELPER_BINARY')
  if self.deferred:
   actual=self.observer.authority.locate_owned_backend(timeout_seconds=min(10,self.deadline-time.monotonic()))
   require(time.monotonic()<self.deadline,'PARENT_OBSERVATION_DEFERRED_DEADLINE')
   if actual is None:return None
   self.container_id,self.backend_pid=actual;self.deferred=False
  old=self.observer.deadline;self.observer.deadline=self.deadline
  try:proof=self.observer.collect(self.database,self.container_id,self.backend_pid,self.application_name)
  finally:self.observer.deadline=old
  require(time.monotonic()<self.deadline,'PARENT_OBSERVATION_LATE_PROOF')
  require(type(proof) is dict and proof.get('kind')=='live-owned-pgdump-backend' and proof.get('identity')==self.observer.plan['identity'],'PARENT_OBSERVATION_ACTUAL_PROOF')
  facts=proof.get('facts',{});require(proof.get('evidenceSha256')==digest(facts) and facts.get('database')==self.database and facts.get('containerId')==self.container_id and facts.get('processPid')==self.backend_pid and facts.get('applicationName')==self.application_name,'PARENT_OBSERVATION_PROOF_BINDING')
  require(process_snapshot(root)==before,'PARENT_OBSERVATION_HELPER_RACE')
  self.helper_pid=producerPID
  record={'schemaVersion':1,'kind':'source-owned-parent-backup-observation','ownerPid':self.pid,'ownedHelperPid':producerPID,'ownedHelperSha256':self.helper_sha256,'observedAt':time.time(),'backendProof':proof,'backendProofSha256':digest(proof)}
  # One immutable receipt per successful iteration; no overwrite/mutable boolean.
  path=self.proof_path.with_name(self.proof_path.name+'.'+str(len(self.receipts))+'.json')
  ref=write_collection(str(path),record)
  require(time.monotonic()<self.deadline,'PARENT_OBSERVATION_LATE_PERSIST')
  self.receipts.append(ref);self.proof=record;return True
