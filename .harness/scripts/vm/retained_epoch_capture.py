"""Source-owned capture draft and protected external-policy finalization.
No CLI or import starts capture. No policy is approved or qualification granted.
"""
import hashlib,json,os,pathlib,re,stat,time
from cn_production_recovery_executor import Protected
from cn_backup_package import BackupLease,DATABASES,IMAGE,ROLE,RDS,require,digest
from cn_backup_sql import capture
from candidate_backend_collector import process_snapshot
from retained_backup_host import RetainedBackupHost
from current_held_epoch_evidence_producer import write_collection,produce as collect_epoch
from isolated_conservation_evidence_producer import produce as collect_isolation
from isolated_rehearsal import STAGES
from current_epoch_qualification import QualificationReader,JOURNEYS

SOURCE_PATH='.harness/scripts/vm/retained_epoch_capture.py'
EVIDENCE_ROOT=pathlib.Path('/etc/workspacex-cn/maintenance-evidence')
class CaptureRetainedBackupHost(RetainedBackupHost):
 """Records actual permission facts at the existing source verification boundary."""
 def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.permission_captures={}
 def verify_effective_permissions(self,plan,objects):
  super().verify_effective_permissions(plan,objects)
  for db in DATABASES:self.permission_captures[db]={'facts':capture(self.channels[db],db),'scope':objects}

class RetainedEpochCapture:
 def __init__(self,host,actor,binding,output_root,journal):
  require(type(host) is CaptureRetainedBackupHost,'EPOCH_CAPTURE_SOURCE_HOST')
  require(actor is host.actor and binding['identity']==host.plan['identity'] and binding['toolRevision']==host.plan['toolRevision'] and binding['providerBindingSha256']==host.plan['providerBindingSha256'],'EPOCH_CAPTURE_IDENTITY')
  self.host=host;self.actor=actor;self.b=binding;self.root=pathlib.Path(output_root);self.journal=journal;self.draft=None;self.production_outputs=None;self.production_windows=None;self.input_references=None
  self.assert_root()
 def assert_root(self):
  expected=EVIDENCE_ROOT/self.b['identity']['sourceRevision']/self.b['identity']['attemptId']
  require(self.root==expected and '..' not in self.root.parts,'EPOCH_CAPTURE_FIXED_ATTEMPT_ROOT')
 def save(self,name,value):
  self.assert_root();return write_collection(str(self.root/(name+'.json')),value)
 def private_output_parent(self):
  self.assert_root()
  for parent in (self.root,*self.root.parents):
   st=parent.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and not st.st_mode&0o022,'EPOCH_CAPTURE_OUTPUT_PARENT')
  require(stat.S_IMODE(self.root.stat().st_mode)==0o700,'EPOCH_CAPTURE_PRIVATE_ROOT')
 def save_raw(self,name,raw):
  """Exact protected JSON bytes, no normalization or credential acquisition."""
  self.private_output_parent();json.loads(raw);destination=self.root/(name+'.json')
  fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
  fd=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:os.fsync(fd)
  finally:os.close(fd)
  return {'path':str(destination),'sha256':hashlib.sha256(raw).hexdigest()}
 def observe(self,phase):
  observation_started=time.time();self.actor.hold();actual=self.actor.observe();self.actor.assert_blocked(actual)
  require(actual['host']==self.b['host'] and self.actor.plan['holdGeneration']==self.b['holdGeneration'],'EPOCH_CAPTURE_HOST_HOLD')
  value={'binding':self.b,'state':'held','writerSessions':[],'writerContainers':[],'automationAdmitted':[],'holdGeneration':self.b['holdGeneration'],'observedAt':time.time()}
  raw=self.save(phase+'-raw-observation',actual);ref=self.save(phase+'-held-drained',value)
  common={k:self.b[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')}
  held=self.save(phase+'-held',{**common,'kind':phase+'-held','passed':True,'facts':{'state':'held','observedAt':value['observedAt']}})
  drained=self.save(phase+'-drained',{**common,'kind':phase+'-drained','passed':True,'facts':{'allWritersDrained':True,'observedAt':value['observedAt'],'observationSha256':raw['sha256']}})
  return {'raw':raw,'qualification':ref,'value':value,'startedAt':observation_started,'endedAt':time.time(),'collection':{'held':held,'drained':drained}}
 def snapshot_inputs(self):
  """Read original protected authorities, then emit data witnesses in attempt scope.
  Witness copies confer no approval; source/module pins remain installed-root.
  """
  self.assert_root();require(self.input_references is None,'EPOCH_CAPTURE_INPUT_SNAPSHOT_REPLAY')
  original=self.host.reference;raw=self.host.read(original['path'])
  require(hashlib.sha256(raw).hexdigest()==original['sha256'] and json.loads(raw)==self.host.host,'EPOCH_CAPTURE_HOST_SOURCE_PIN')
  profile_raw=self.host.read('/etc/workspacex-cn/trusted-tool-binding.json');profile=json.loads(profile_raw)
  require(profile['backupHostPlan']==original and profile['toolRevision']==self.b['toolRevision'],'EPOCH_CAPTURE_HOST_ROOT_PROFILE')
  actor_plan=self.actor.plan;transport=self.actor.transport
  require(actor_plan==transport.plan and actor_plan['identity']==self.b['identity'],'EPOCH_CAPTURE_ACTUAL_ACTOR_PLAN')
  seal_path=actor_plan['runtimeSealPath'];expected='/var/lib/workspacex-cn/runtime/'+self.b['identity']['attemptId']+'/sealed-writer-runtime.json'
  require(seal_path==expected,'EPOCH_CAPTURE_ACTOR_SEAL_PATH')
  seal_raw=self.host.read(seal_path);seal=json.loads(seal_raw)
  require(seal['kind']=='sealed-maintenance-writer-runtime' and seal['runtimePlan']==actor_plan and seal['runtimePlanSha256']==digest(actor_plan) and seal['identity']==self.b['identity'] and seal['toolRevision']==self.b['toolRevision'],'EPOCH_CAPTURE_ACTOR_SEAL_BINDING')
  source_raw=self.host.read(seal['sourcePlanPath']);source=json.loads(source_raw)
  require(hashlib.sha256(source_raw).hexdigest()==seal['sourcePlanSha256']==transport.manifest_sha and digest(source)==seal['sourcePlanCanonicalSha256']==actor_plan['runtimeSourcePlanSha256'],'EPOCH_CAPTURE_ACTOR_ORIGINAL_PIN')
  require(source['identity']==self.b['identity'] and source['toolRevision']==self.b['toolRevision'],'EPOCH_CAPTURE_ACTOR_SOURCE_IDENTITY')
  for mode in ('control','diagnostic'):
   actual={db:ch.binding for db,ch in getattr(transport,mode+'_connections').items()}
   require(actual==actor_plan[mode+'Sessions'],'EPOCH_CAPTURE_ACTUAL_SIX_SESSIONS')
  refs=[]
  refs.append(self.save_raw('actual-approved-host-plan',raw))
  refs.append(self.save_raw('actual-root-profile',profile_raw))
  refs.append(self.save_raw('actual-actor-source-plan',source_raw))
  refs.append(self.save('actual-actor-runtime-plan',actor_plan))
  refs.append(self.save_raw('actual-actor-runtime-seal',seal_raw))
  refs.append(self.save('actual-provider-transport-authorities',{'identity':self.b['identity'],'toolRevision':self.b['toolRevision'],'providerBindingSha256':self.b['providerBindingSha256'],'transport':self.host.host['connection']['transport']}))
  refs.append(self.save('input-source-bindings',{'identity':self.b['identity'],'originalHostReference':original,'originalHostRawSha256':hashlib.sha256(raw).hexdigest(),'rootProfileRawSha256':hashlib.sha256(profile_raw).hexdigest(),'originalActorSourcePath':seal['sourcePlanPath'],'originalActorRawSha256':hashlib.sha256(source_raw).hexdigest(),'originalActorCanonicalSha256':digest(source),'actorRuntimeCanonicalSha256':digest(actor_plan),'sealRawSha256':hashlib.sha256(seal_raw).hexdigest(),'witnesses':refs[:],'authority':False,'ready':False}))
  # Re-read originals; no copy may hide a concurrent source/profile change.
  require(self.host.read(original['path'])==raw and self.host.read('/etc/workspacex-cn/trusted-tool-binding.json')==profile_raw and self.host.read(seal['sourcePlanPath'])==source_raw and self.host.read(seal_path)==seal_raw,'EPOCH_CAPTURE_INPUT_SOURCE_DRIFT')
  self.input_references=refs;return [dict(ref) for ref in refs]
 def actual_input_references(self):
  require(self.input_references is not None,'EPOCH_CAPTURE_INPUTS_NOT_SNAPSHOTTED')
  return [dict(ref) for ref in self.input_references]
 def snapshot_ciphertext(self,database,receipt):
  """Copy verified encrypted bytes to the qualifier's fixed private attempt scope."""
  self.private_output_parent();require(database in DATABASES,'EPOCH_CAPTURE_CIPHER_DATABASE')
  original=self.host.root/(database+'.dump.cms');expected=receipt['ciphertextSha256'];size=receipt['ciphertextBytes']
  protected=Protected();protected.bind_large(str(original),expected,size)
  destination=self.root/(database+'.ciphertext.cms');h=hashlib.sha256();written=0
  sourcefd=os.open(original,os.O_RDONLY|os.O_NOFOLLOW)
  try:outfd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  except BaseException:os.close(sourcefd);raise
  try:
   with os.fdopen(sourcefd,'rb') as source,os.fdopen(outfd,'wb') as output:
    for block in iter(lambda:source.read(1024*1024),b''):
     written+=len(block);require(written<=size,'EPOCH_CAPTURE_CIPHER_BOUND');h.update(block);output.write(block)
    require(written==size and h.hexdigest()==expected,'EPOCH_CAPTURE_CIPHER_RAW_HASH');output.flush();os.fsync(output.fileno())
   protected.recheck();directory=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
   try:os.fsync(directory)
   finally:os.close(directory)
  except BaseException:
   # A partial immutable output needs independent reconciliation, never overwrite.
   raise
  return {'path':str(destination),'sha256':expected,'bytes':size}
 def run_production(self):
  """Actual existing BackupLease path; failure preserves held state, no success draft."""
  require(self.draft is None,'EPOCH_CAPTURE_REPLAY_REQUIRES_RECONCILIATION')
  inputs=self.snapshot_inputs();before=self.observe('before');started=time.time()
  proc=pathlib.Path('/proc')/str(os.getpid());process_before=process_snapshot(proc)
  namespaces={name:re.fullmatch(r'[a-z]+:\[([0-9]+)\]',os.readlink(proc/'ns'/name)).group(1) for name in ('pid','mnt','net')}
  executable_sha=hashlib.sha256((proc/'exe').read_bytes()).hexdigest()
  producer_process={'pid':os.getpid(),'processStart':process_before['processStart'],'namespaces':namespaces,'sourcePath':SOURCE_PATH,'sourceSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'executableSha256':executable_sha,'cgroupContainerId':process_before['cgroupContainerId']}

  # Permissions, stream children and cleanup are verified by source host/lease.
  result=BackupLease(self.host.plan,self.host,self.journal).run()
  require(result['cleanupVerified'] is True and result['currentEpochVerified'] is False,'EPOCH_CAPTURE_BACKUP_NOT_QUALIFICATION')
  require(set(self.host.permission_captures)==set(DATABASES) and len(self.host.relays)==3,'EPOCH_CAPTURE_ACTUAL_FACTS_MISSING')
  permissions={db:self.save('permissions-'+db,self.host.permission_captures[db]) for db in DATABASES};lanes={};backend={};database_components={}
  common={k:self.b[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')}
  for db,relay in zip(DATABASES,self.host.relays):
   proof=relay.proof['backendProof'];require(proof['facts']['database']==db and relay.receipts,'EPOCH_CAPTURE_BACKEND_DATABASE')
   backend[db]=self.save('backend-'+db,proof);receipt=self.save('backup-receipt-'+db,result['databases'][db]);r=result['databases'][db]
   cipher=self.snapshot_ciphertext(db,r)
   lane={'binding':self.b,'database':db,'role':ROLE,'backendProof':backend[db],'imageId':IMAGE,'backendPid':proof['facts']['session']['pid'],'backendStart':proof['facts']['session']['backendStart'],'exeSha256':proof['readOnlyEvidence']['exeSha256'],'ciphertext':cipher,'backupReceipt':receipt,'snapshotId':self.b['epoch'],'sourceRdsInstanceId':RDS}
   lanes[db]=self.save('dump-'+db,lane);database_components[db]={}
   facts=self.host.permission_captures[db]['facts']
   for component in ('ciphertext',):
    detail={'database':db,'complete':True,'sourceRdsInstanceId':RDS,'permissionFacts':permissions[db]}
    if component=='ciphertext':detail['artifact']=cipher
    else:detail['rawFacts']=facts
    database_components[db][component]=self.save(db+'-'+component,{**common,'kind':'database-'+component,'passed':True,'facts':detail})
  cleanup={name:self.save(name,{**common,'kind':'cleanup-'+name,'passed':True,'facts':{name:True}}) for name in ('ownedChildrenJoined','credentialCleanup')}
  production_ended=time.time();after=self.observe('after');ended=time.time()
  require(process_snapshot(proc)==process_before and hashlib.sha256((proc/'exe').read_bytes()).hexdigest()==executable_sha,'EPOCH_CAPTURE_PRODUCER_PROCESS_DRIFT')
  raw_journal=self.save('writer-source-journal',self.actor.journal.value)
  for event in self.actor.journal.value.get('events',[]):
   require(not any(x in event.get('state','').lower() for x in ('resume','reopen','unblock','traffic-open','cleared')),'EPOCH_CAPTURE_JOURNAL_REOPEN')
  events=[{k:observation['value'][k] for k in ('observedAt','holdGeneration','state','writerSessions','writerContainers','automationAdmitted')} for observation in (before,after)]
  journal=self.save('held-journal',{'binding':self.b,'events':events})
  value={'schemaVersion':1,'kind':'source-owned-epoch-capture-draft','binding':self.b,'before':before,'after':after,'permissions':permissions,'dumpLanes':lanes,'backend':backend,'databaseComponents':database_components,'cleanup':cleanup,'heldJournal':journal,'rawWriterJournal':raw_journal,'inputReferences':inputs,'producerProcess':producer_process,'ownedChildrenJoined':True,'captureStartedAt':started,'captureEndedAt':production_ended,'captureCompletedAt':ended,'ready':False,'qualified':False,'requiredExternalInputs':['objects','isolation','journeys','recoveryEvidence','recoveryManifest','collectionDatabaseRefs','collectionObjectRefs','collectionIsolationRefs','sourcePolicy']}
  self.draft=self.save('capture-draft',value)
  outputs={'before-held-drained':before['qualification'],'after-held-drained':after['qualification'],'held-interval-journal':journal}
  for db in DATABASES:outputs.update({'permissions:'+db:permissions[db],'dump:'+db:lanes[db],'backend:'+db:backend[db]})
  self.production_outputs=outputs
  self.production_windows={kind:(started,production_ended) for kind in outputs}
  self.production_windows['before-held-drained']=(before['startedAt'],before['endedAt'])
  self.production_windows['after-held-drained']=(after['startedAt'],after['endedAt'])
  self.production_windows['held-interval-journal']=(before['startedAt'],ended)
  return self.draft
 def actual_production_outputs(self):
  require(self.draft is not None and self.production_outputs is not None,'EPOCH_CAPTURE_PRODUCTION_NOT_EXECUTED')
  return {kind:{'output':dict(ref),'startedAt':self.production_windows[kind][0],'endedAt':self.production_windows[kind][1]} for kind,ref in self.production_outputs.items()}
 def stage_external_evidence(self,draft_reference,external,reader):
  """Stage actual externally produced refs before final policy approval."""
  self.assert_root();require(draft_reference['path']==str(self.root/'capture-draft.json'),'EPOCH_CAPTURE_FIXED_DRAFT_PATH')
  qr=QualificationReader(reader);draft=qr.json(draft_reference)
  require(draft['kind']=='source-owned-epoch-capture-draft' and draft['binding']==self.b and draft.get('qualified') is False,'EPOCH_CAPTURE_DRAFT_BINDING')
  required={'objects','isolation','journeys','recoveryEvidence','recoveryManifest','collectionDatabaseRefs','collectionObjectRefs','collectionIsolationRefs'}
  require(type(external) is dict and set(external)==required,'EPOCH_CAPTURE_FINAL_EXTERNAL_INPUTS')
  require(set(external['objects'])=={'before','after','restored'} and set(external['journeys'])==set(JOURNEYS) and set(external['isolation']['stageReceipts'])==set(STAGES),'EPOCH_CAPTURE_EXTERNAL_SOURCE_CLOSURE')
  def read_raw(path,h):
   ref=qr.reference(path);require(ref['sha256']==h,'EPOCH_CAPTURE_RAW_REF');return b''.join(qr.blocks(ref))
  # Existing actual source consumers verify isolation byte/hash/stage/fidelity;
  # missing replay or six journey outputs never become a collection flag.
  collect_isolation(external['isolation'],reader=read_raw)
  require(set(external['collectionDatabaseRefs'])==set(DATABASES) and all(set(v)=={'catalog','roles','acl','sequence','version'} for v in external['collectionDatabaseRefs'].values()),'EPOCH_CAPTURE_EXTERNAL_CATALOG_CLOSURE')
  components={db:{**draft['databaseComponents'][db],**external['collectionDatabaseRefs'][db]} for db in DATABASES}
  collection_input={'kind':'current-held-epoch-evidence-input',**{k:self.b[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')},'before':draft['before']['collection'],'after':draft['after']['collection'],'databases':components,'objects':external['collectionObjectRefs'],'cleanup':draft['cleanup'],'isolation':external['collectionIsolationRefs']}
  collection=collect_epoch(collection_input,reader=read_raw,large_reader=lambda r:list(qr.blocks(r)))
  collection_ref=self.save('epoch-collection',collection);collection_input_ref=self.save('epoch-collection-input',collection_input)
  value={'schemaVersion':2,'kind':'current-held-epoch-qualification','binding':self.b,'sourcePolicy':None,'collection':collection_ref,'collectionInput':collection_input_ref,'recoveryEvidence':external['recoveryEvidence'],'recoveryManifest':external['recoveryManifest'],'before':draft['before']['qualification'],'after':draft['after']['qualification'],'heldJournal':draft['heldJournal'],'permissions':draft['permissions'],'dumpLanes':draft['dumpLanes'],'objects':external['objects'],'isolation':external['isolation'],'journeys':external['journeys'],'outputRoot':str(self.root/'qualified-current-epoch')}
  # Every qualification raw output must match an EXTERNALLY approved invocation.
  outputs={'held-interval-journal':value['heldJournal'],'collection':collection_ref,'before-held-drained':value['before'],'after-held-drained':value['after'],'recovery-evidence':value['recoveryEvidence'],'recovery-manifest':value['recoveryManifest']}
  for db in DATABASES:outputs.update({'permissions:'+db:value['permissions'][db],'dump:'+db:value['dumpLanes'][db],'backend:'+db:draft['backend'][db]})
  outputs.update({'objects:'+k:v for k,v in value['objects'].items()});outputs.update({'stage:'+k:v for k,v in value['isolation']['stageReceipts'].items()});outputs.update({'journey:'+k:v for k,v in value['journeys'].items()})
  qr.finish();return self.save('qualification-input-draft',{'schemaVersion':1,'kind':'source-owned-qualification-input-draft','binding':self.b,'input':value,'outputs':outputs,'ready':False,'qualified':False})
 def finalize(self,staged_reference,reader,source_policy_reference):
  self.assert_root();require(staged_reference['path']==str(self.root/'qualification-input-draft.json'),'EPOCH_CAPTURE_FIXED_STAGED_PATH')
  qr=QualificationReader(reader);staged=qr.json(staged_reference)
  require(staged['kind']=='source-owned-qualification-input-draft' and staged['binding']==self.b and staged.get('qualified') is False,'EPOCH_CAPTURE_STAGED_BINDING')
  policy=qr.json(source_policy_reference);require(policy['kind']=='source-approved-epoch-policy' and policy['binding']==self.b,'EPOCH_CAPTURE_EXTERNAL_POLICY_BINDING')
  value=staged['input'];require(value.get('outputRoot')==str(self.root/'qualified-current-epoch'),'EPOCH_CAPTURE_FIXED_OUTPUT_ROOT');require(value['sourcePolicy'] is None,'EPOCH_CAPTURE_POLICY_NOT_SELF_APPROVED');value['sourcePolicy']=source_policy_reference
  for kind,ref in staged['outputs'].items():
   require(kind in policy['invocations'],'EPOCH_CAPTURE_FINAL_INVOCATION_MISSING');invocation=qr.json(policy['invocations'][kind]);require(invocation['binding']==self.b and invocation['output']==qr.expand(ref) and invocation['kind']==kind,'EPOCH_CAPTURE_FINAL_INVOCATION_BINDING')
   list(qr.blocks(ref))
  qr.finish();return self.save('qualification-input',value)
