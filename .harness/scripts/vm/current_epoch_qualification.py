#!/usr/bin/env python3
"""Schema-2 offline qualification. Reads existing artifacts; never captures/SQLs.
The caller supplies a hash-pinned root source policy, not JSON operation callbacks.
Old recovery admission guards remain untouched.
"""
import hashlib,importlib,json,math,os,re,stat,sys
from pathlib import Path
from cn_backup_package import APP,BASE,RDS,ECS,IMAGE,ROLE
from cn_backup_sql import permission_gaps
from isolated_conservation_stage import verify_outer,verify_result
from isolated_conservation_evidence_producer import produce as conservation
from isolated_rehearsal import STAGES
from current_held_epoch_evidence_producer import write_collection,produce as collect_epoch
D=Path(__file__).parent
import epoch_recovery as recovery
# The production FD finder resolves only the root-approved exact module set.
# There is no sibling-path loader or sys.path mutation here.
DBS=('workspacex','workspacex_agent','workspacex_memory')
JOURNEYS=('login','hello','asr','githubFeedbackRead','skillTool','pdfDownload')
SOURCES=('current_epoch_qualification.py','cn-maintenance-recovery-evidence-verifier.py','cn_backup_sql.py','isolated_conservation_stage.py','isolated_conservation_evidence_producer.py','isolated_conservation_plan.py','isolated_canonical_plan_factory.py','isolated_conservation_inputs.py','isolated_rehearsal.py','cn_backup_package.py','cn_production_recovery_executor.py','writer_fence.py','current_held_epoch_evidence_producer.py')
# These are artifact producers, not executable dependencies of this verifier.
# Their pinned bytes may be evidence inputs; they are never dynamically imported
# or dispatched from policy JSON. New producers require a source review here.
PRODUCER_SOURCE_FILES=(
 'retained_epoch_capture.py','retained_epoch_acquisition.py',
 'retained_backup_host.py','retained_backend_observer.py',
 'source_invocation_receipt.py','parent_source_invocation_receipt.py','opened_service_health.py',
 'acceptance_receipt_store.py','canonical_acceptance_receipt.py',
 'acceptance_receipt_producer.cjs','retained_backup_helper.cjs',
 'retained_session_recovery.cjs','cn_backup_backend.py','cn_backup_stream.py',
 'isolated_conservation_supervisor.py','conservation-engine.cjs',
 'secondary-conservation-engine-final.cjs',
 'isolated_rehearsal_aliyun.py','isolated_rehearsal_sql_stage.py',
 'isolated_rehearsal_prepare.py','isolated_rehearsal_restore.py',
 'isolated_rehearsal_snapshot.py','isolated_rehearsal_databases.cjs',
 'isolated_rehearsal_migrate.cjs','isolated_rehearsal_fidelity.cjs',
 'cn-production-recovery-executor.py','cn_production_recovery_transport.py',
 'cn_production_recovery_stream.py','cn-production-recovery-catalog.cjs',
 'cn-production-recovery-fidelity.cjs','cn-production-recovery-readback.cjs',
 'cn_restore_objects.cjs','cn_restore_objects.ts',
 'cn_object_inventory/source_audit.py','cn_object_inventory/runtime_audit.py',
 'cn_object_inventory/inventory.py')
def need(v,c):
 if not v:raise ValueError(c)
def exact(v,keys,c):need(type(v) is dict and set(v)==set(keys),c)
def hashok(v):return type(v) is str and re.fullmatch('[a-f0-9]{64}',v) is not None
def sha(v):return hashlib.sha256(v).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
class QualificationCodeAuthority:
 """Independent root-profile pins; never sourced from an evidence plan.
 Only this closed set may leave the private evidence reader's path/mode scope.
 Non-root disposable API fixtures have an explicit private code root; no CLI
 option can request that override and root cannot use it.
 """
 def __init__(self,source_pins,executable_pins,*,uid=0,gid=0,fixture_root=None):
  self.uid=uid;self.gid=gid;self.snapshots={};self.approved={};self.source_pins={}
  self.fixture_root=Path(fixture_root) if fixture_root is not None else None
  need(self.fixture_root is None or (os.geteuid()!=0 and uid==os.geteuid() and gid==os.getegid() and self.fixture_root.is_absolute()),'EPOCH_CODE_FIXTURE_FORBIDDEN')
  need(self.fixture_root is not None or (uid==0 and gid==0),'EPOCH_CODE_OWNER_OVERRIDE_FORBIDDEN')
  need(type(source_pins) is dict and type(executable_pins) is dict,'EPOCH_CODE_PIN_SCHEMA')
  allowed={'.harness/scripts/vm/'+name for name in (*SOURCES,*PRODUCER_SOURCE_FILES)}
  for source,r in source_pins.items():
   need(source in allowed,'EPOCH_CODE_SOURCE_ALLOWLIST');exact(r,('path','sha256'),'EPOCH_CODE_SOURCE_PIN')
   name=source.removeprefix('.harness/scripts/vm/')
   expected=str((self.fixture_root/'sources'/name) if self.fixture_root else Path('/usr/local/lib/workspacex-cn')/name)
   need(r['path']==expected and hashok(r['sha256']),'EPOCH_CODE_SOURCE_PATH')
   need(expected not in self.approved,'EPOCH_CODE_DUPLICATE_PIN');self.approved[expected]=(r['sha256'],0o700);self.source_pins[source]={'path':expected,'sha256':r['sha256']}
  expected_python=str(self.fixture_root/'python3') if self.fixture_root else str(Path('/usr/bin/python3').resolve(strict=True))
  # Existing 9b Node engines may attest their actual fixed interpreter. Pins
  # authorize reads only; they never select a runtime for execution from JSON.
  expected_node=str(self.fixture_root/'node') if self.fixture_root else str(Path('/usr/bin/node').resolve(strict=False))
  need(expected_python in executable_pins and set(executable_pins)<={expected_python,expected_node},'EPOCH_CODE_EXECUTABLE_ALLOWLIST')
  for path,digest in executable_pins.items():
   need(hashok(digest),'EPOCH_CODE_EXECUTABLE_PIN');self.approved[path]=(digest,0o755)
 def admits(self,ref):
  return type(ref) is dict and set(ref) in ({'path','sha256'},{'path','sha256','bytes'}) and self.approved.get(ref.get('path'),(None,None))[0]==ref.get('sha256')
 def _signature(self,st):return (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns,st.st_mode,st.st_uid,st.st_gid,st.st_nlink)
 def read(self,ref):
  need(self.admits(ref),'EPOCH_CODE_REFERENCE_NOT_APPROVED')
  path=Path(ref['path']);need(path.is_absolute() and '..' not in path.parts,'EPOCH_CODE_PATH')
  for parent in path.parents:
   if self.fixture_root and parent==self.fixture_root.parent:break
   st=parent.lstat();need(stat.S_ISDIR(st.st_mode) and st.st_uid==self.uid and st.st_gid==self.gid and not st.st_mode&0o022,'EPOCH_CODE_PARENT_TRUST')
  before=path.lstat();expected_mode=self.approved[str(path)][1]
  need(stat.S_ISREG(before.st_mode) and before.st_uid==self.uid and before.st_gid==self.gid and before.st_nlink==1 and stat.S_IMODE(before.st_mode)==expected_mode and before.st_size<=256*1024*1024,'EPOCH_CODE_FILE_TRUST')
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  with os.fdopen(fd,'rb') as f:
   opened=os.fstat(f.fileno());need(self._signature(before)==self._signature(opened),'EPOCH_CODE_OPEN_RACE')
   raw=f.read(256*1024*1024+1);after=os.fstat(f.fileno())
  signature=self._signature(before)
  need(signature==self._signature(after)==self._signature(path.lstat()) and len(raw)==before.st_size,'EPOCH_CODE_READ_RACE')
  need(sha(raw)==ref['sha256'] and ('bytes' not in ref or ref['bytes']==len(raw)),'EPOCH_CODE_RAW_HASH')
  if str(path) in self.snapshots:need(self.snapshots[str(path)]==signature,'EPOCH_CODE_CHANGED_AFTER_READ')
  self.snapshots[str(path)]=signature
  return raw
 def expand(self,ref):
  raw=self.read(ref);return {'path':ref['path'],'sha256':ref['sha256'],'bytes':len(raw)}
 def finish(self):
  for path in tuple(self.snapshots):self.read({'path':path,'sha256':self.approved[path][0]})
class QualificationReader:
 def __init__(self,protected,code_authority=None):self.protected=protected;self.code_authority=code_authority
 def expand(self,ref):
  if self.code_authority and self.code_authority.admits(ref):return self.code_authority.expand(ref)
  if type(ref) is dict and set(ref)=={'path','sha256'}:
   actual=self.protected.reference(ref['path']);need(actual['sha256']==ref['sha256'],'EPOCH_PROOF_RAW_HASH');return actual
  return ref
 def blocks(self,ref):
  if self.code_authority and self.code_authority.admits(ref):return iter((self.code_authority.read(ref),))
  return self.protected.blocks(self.expand(ref))
 def json(self,ref):return json.loads(b''.join(self.blocks(ref)))
 def reference(self,path):
  if self.code_authority and str(path) in self.code_authority.approved:return self.code_authority.expand({'path':str(path),'sha256':self.code_authority.approved[str(path)][0]})
  return self.protected.reference(path)
 def finish(self):
  self.protected.finish()
  if self.code_authority:self.code_authority.finish()
class _QualificationPublication:
 """Source-owned fixed publication mode; never a caller-supplied writer."""
 def __init__(self,reader,output,existing):
  self.reader=reader;self.output=output;self.existing=existing;self.emitted=[]
 def emit(self,name,value):
  need(name in {*(db+'.json' for db in DBS),'objects.json','epoch.json'} and name not in self.emitted,'EPOCH_FIXED_PUBLICATION_NAME')
  self.emitted.append(name);path=self.output/name
  if not self.existing:return write_collection(path,value)
  raw=canonical(value)
  expected={'path':str(path),'sha256':sha(raw),'bytes':len(raw)}
  # ProtectedArtifacts checks actual mode/owner/link/path/stat and raw SHA.
  # Equal decoded JSON with different serialization is deliberately rejected.
  actual=b''.join(self.reader.blocks(expected))
  need(actual==raw,'EPOCH_EXISTING_SERIALIZED_BYTES')
  return {'path':str(path),'sha256':expected['sha256']}
 def finish(self):
  need(set(self.emitted)=={*(db+'.json' for db in DBS),'objects.json','epoch.json'},'EPOCH_FIVE_OUTPUT_CLOSURE')
  self.reader.finish()
def qualify(p,reader,source_policy_reference,*,code_authority=None):
 return _qualification(p,reader,source_policy_reference,False,code_authority)
def verify_existing_qualification(p,reader,source_policy_reference,*,code_authority=None):
 """Repeat every source qualification check; read exactly five existing outputs.
 No creation, overwrite, rename, producer execution or freely injected emitter.
 """
 return _qualification(p,reader,source_policy_reference,True,code_authority)
def _qualification(p,reader,source_policy_reference,existing,code_authority):
 reader=QualificationReader(reader,code_authority)
 need(p.get('sourcePolicy')==source_policy_reference,'EPOCH_EXTERNAL_SOURCE_POLICY_BINDING')
 exact(p,('schemaVersion','kind','binding','sourcePolicy','collection','collectionInput','recoveryEvidence','recoveryManifest','before','after','heldJournal','permissions','dumpLanes','objects','isolation','journeys','outputRoot'),'EPOCH_SCHEMA2')
 need(p['schemaVersion']==2 and p['kind']=='current-held-epoch-qualification','EPOCH_SCHEMA2')
 b=p['binding'];exact(b,('identity','toolRevision','host','epoch','holdGeneration','targetInstanceId','providerBindingSha256'),'EPOCH_BINDING')
 i=b['identity'];exact(i,('sourceRevision','baselineRevision','migrationPlanSha256','attemptId'),'EPOCH_IDENTITY')
 need(i['sourceRevision']==APP and i['baselineRevision']==BASE and hashok(i['migrationPlanSha256']) and re.fullmatch('[A-Za-z0-9-]{1,32}',i['attemptId']),'EPOCH_FROZEN_RELEASE')
 exact(b['host'],('instanceId','bootId'),'EPOCH_HOST');need(b['host']['instanceId']==ECS and re.fullmatch('[a-f0-9-]{36}',b['host']['bootId']),'EPOCH_HOST')
 need(re.fullmatch('[a-f0-9]{40}',b['toolRevision']) and hashok(b['epoch']) and re.fullmatch('[a-f0-9]{32}',b['holdGeneration']) and hashok(b['providerBindingSha256']),'EPOCH_DIGEST')
 need(re.fullmatch('pgm-[a-z0-9]+',b['targetInstanceId']) and b['targetInstanceId']!=RDS,'EPOCH_TARGET')
 policy=reader.json(p['sourcePolicy']);exact(policy,('schemaVersion','kind','binding','sources','producers','invocations'),'EPOCH_SOURCE_POLICY')
 need(policy['schemaVersion']==2 and policy['kind']=='source-approved-epoch-policy' and policy['binding']==b,'EPOCH_SOURCE_POLICY_BINDING')
 required={'.harness/scripts/vm/'+s for s in SOURCES}
 allowed_producers={'.harness/scripts/vm/'+s for s in PRODUCER_SOURCE_FILES}
 need(type(policy['sources']) is dict and required<=set(policy['sources']) and set(policy['sources'])<=required|allowed_producers,'EPOCH_SOURCE_CLOSURE')
 if code_authority:
  for source,r in policy['sources'].items():
   need(code_authority.source_pins.get(source)=={'path':r['path'],'sha256':r['sha256']} and code_authority.admits(r),'EPOCH_INSTALLED_SOURCE_INDEPENDENT_PIN')
 for path in set(policy['sources'])-required:list(reader.blocks(policy['sources'][path]))
 for name in SOURCES:
  r=policy['sources']['.harness/scripts/vm/'+name];need(sha(Path(__file__ if name=='current_epoch_qualification.py' else importlib.import_module('epoch_recovery' if name=='cn-maintenance-recovery-evidence-verifier.py' else name[:-3]).__file__).read_bytes())==r['sha256'],'EPOCH_LOADED_SOURCE_HASH');list(reader.blocks(r))
 need(type(policy['producers']) is dict and policy['producers'] and type(policy['invocations']) is dict,'EPOCH_PRODUCER_CLOSURE')
 used=set();window=[]
 def actual(ref,kind):
  # This exact invocation ref must have been approved in the protected source
  # policy. A free-form output JSON or passed boolean is never an authority.
  need(kind in policy['invocations'],'EPOCH_UNAPPROVED_INVOCATION')
  invocation=reader.json(policy['invocations'][kind]);exact(invocation,('schemaVersion','kind','binding','producerId','source','executable','pid','processStart','startedAt','endedAt','namespaces','providerBindingSha256','inputs','output','exitCode','ownedChildrenJoined'),'EPOCH_INVOCATION_SCHEMA')
  need(invocation['schemaVersion']==2 and invocation['kind']==kind and invocation['binding']==b and reader.expand(invocation['output'])==reader.expand(ref),'EPOCH_INVOCATION_OUTPUT_BINDING')
  producer=policy['producers'].get(invocation['producerId']);exact(producer,('source','executable','imageId','namespaces'),'EPOCH_APPROVED_PRODUCER')
  need(invocation['source']==producer['source'] and invocation['executable']==producer['executable'] and invocation['namespaces']==producer['namespaces'] and re.fullmatch('sha256:[a-f0-9]{64}',producer['imageId']),'EPOCH_PRODUCER_IDENTITY')
  need(invocation['source'] in policy['sources'].values(),'EPOCH_PRODUCER_SOURCE_CLOSURE')
  if code_authority:
   need(code_authority.admits(invocation['source']) and code_authority.approved[invocation['source']['path']][1]==0o700,'EPOCH_SOURCE_INSTALLED_AUTHORITY')
   need(code_authority.admits(invocation['executable']) and code_authority.approved[invocation['executable']['path']][1]==0o755,'EPOCH_RUNTIME_INDEPENDENT_AUTHORITY')
  for r in (invocation['source'],invocation['executable'],*invocation['inputs']):list(reader.blocks(r))
  need(type(invocation['pid']) is int and invocation['pid']>1 and type(invocation['processStart']) is str and re.fullmatch('[0-9]+',invocation['processStart']),'EPOCH_PROCESS_IDENTITY')
  exact(invocation['namespaces'],('pid','mnt','net'),'EPOCH_PROCESS_NAMESPACES');need(all(type(v) is str and re.fullmatch('[0-9]+',v) for v in invocation['namespaces'].values()),'EPOCH_PROCESS_NAMESPACES')
  need(all(type(invocation[k]) in (int,float) and math.isfinite(invocation[k]) for k in ('startedAt','endedAt')) and invocation['startedAt']<=invocation['endedAt'] and invocation['providerBindingSha256']==b['providerBindingSha256'] and invocation['exitCode']==0 and invocation['ownedChildrenJoined'] is True,'EPOCH_EXECUTION_OUTCOME')
  need(kind not in used,'EPOCH_INVOCATION_REUSE');used.add(kind);window.append((kind,invocation['startedAt'],invocation['endedAt']))
  value=reader.json(ref)
  nested=[]
  def walk(v):
   if type(v) is dict:
    if {'path','sha256'}<=set(v) and set(v)<={'path','sha256','bytes'}:nested.append(reader.expand(v))
    else:
     for x in v.values():walk(x)
   elif type(v) is list:
    for x in v:walk(x)
  walk(value)
  need({sha(canonical(v)) for v in nested}<={sha(canonical(reader.expand(v))) for v in invocation['inputs']},'EPOCH_INVOCATION_INPUT_CLOSURE')
  return value
 collection=actual(p['collection'],'collection');
 collected_input=reader.json(p['collectionInput'])
 def raw_reader(path,h):
  r=reader.reference(path);need(r['sha256']==h,'EPOCH_NESTED_RAW_HASH');return b''.join(reader.blocks(r))
 generated=collect_epoch(collected_input,reader=raw_reader,large_reader=lambda r:list(reader.blocks(r)))
 need(collection==generated,'EPOCH_ACTUAL_COLLECTION_REPRODUCTION');need(collection.get('kind')=='current-held-epoch-evidence-collection' and collection.get('qualified') is False and collection.get('ready') is False,'EPOCH_COLLECTION_NOT_QUALIFICATION')
 for k in ('identity','toolRevision','host','epoch','holdGeneration'):need(collection.get(k)==b[k],'EPOCH_COLLECTION_BINDING')
 need(collection.get('sourceRdsInstanceId')==RDS and collection.get('isolatedTargetInstanceId')==b['targetInstanceId'],'EPOCH_COLLECTION_TARGET')
 observations={}
 for phase in ('before','after'):
  v=actual(p[phase],phase+'-held-drained');exact(v,('binding','state','writerSessions','writerContainers','automationAdmitted','holdGeneration','observedAt'),'EPOCH_HELD_OBSERVATION')
  need(v['binding']==b and v['state']=='held' and v['holdGeneration']==b['holdGeneration'] and v['writerSessions']==[] and v['writerContainers']==[] and v['automationAdmitted']==[] and type(v['observedAt']) in (int,float) and math.isfinite(v['observedAt']),'EPOCH_WRITERS_NOT_DRAINED');observations[phase]=v
 need(observations['before']['observedAt']<observations['after']['observedAt'] and p['before']['sha256']!=p['after']['sha256'],'EPOCH_HELD_WINDOW')
 evidence=actual(p['recoveryEvidence'],'recovery-evidence');manifest=actual(p['recoveryManifest'],'recovery-manifest');raw=b''.join(reader.blocks(p['recoveryEvidence']))
 need(evidence['identity']==i and evidence['toolRevision']==b['toolRevision'] and manifest['targetInstanceId']==b['targetInstanceId'],'EPOCH_RECOVERY_BINDING')
 recovery.replay(evidence,manifest,reader,evidence_raw=raw)
 exact(p['permissions'],DBS,'EPOCH_PERMISSION_DATABASES');exact(p['dumpLanes'],DBS,'EPOCH_DUMP_DATABASES')
 for db in DBS:
  perms=actual(p['permissions'][db],'permissions:'+db);exact(perms,('facts','scope'),'EPOCH_PERMISSION_RAW_FACTS')
  need(perms['facts']['database']==db and not permission_gaps(perms['facts'],perms['scope']),'EPOCH_READONLY_PERMISSION_REJECTED')
  catalog=reader.json(manifest['databases'][db]['sourceCatalog']);scope=perms['scope'][db]
  need({(v['schema'],v['name']) for v in scope['tables']}=={(v['schema'],v['table']) for v in catalog['tables']} and {(v['schema'],v['name']) for v in scope['sequences']}=={(v['schema'],v['sequence']) for v in catalog['sequences']},'EPOCH_PERMISSION_ACTUAL_CATALOG_SCOPE')
  lane=actual(p['dumpLanes'][db],'dump:'+db);exact(lane,('binding','database','role','backendProof','imageId','backendPid','backendStart','exeSha256','ciphertext','backupReceipt','snapshotId','sourceRdsInstanceId'),'EPOCH_DUMP_LANE')
  need(lane['binding']==b and lane['database']==db and lane['role']==ROLE and lane['imageId']==IMAGE and type(lane['backendPid']) is int and lane['backendPid']>1 and lane['backendStart'] and hashok(lane['exeSha256']) and lane['sourceRdsInstanceId']==RDS and lane['ciphertext']==manifest['databases'][db]['ciphertext'] and lane['backupReceipt']==manifest['databases'][db]['backupReceipt'],'EPOCH_DUMP_ACTUAL_BINDING')
  backend=actual(lane['backendProof'],'backend:'+db)
  exact(backend,('kind','identity','observedAt','facts','evidenceSha256','readOnlyEvidence'),'EPOCH_DUMP_BACKEND_SCHEMA')
  fact=backend['facts'];att=backend['readOnlyEvidence']
  need(backend['kind']=='live-owned-pgdump-backend' and backend['identity']==i and backend['evidenceSha256']==sha(canonical(fact)) and fact['identity']==i and fact['database']==db and fact['session']['pid']==lane['backendPid'] and fact['session']['backendStart']==lane['backendStart'] and fact['session']['role']==ROLE and fact['applicationName']=='wsx-backup-'+i['attemptId']+'-'+db and type(fact['processPid']) is int and fact['processPid']>1 and fact['processStart'] and hashok(fact['containerId']),'EPOCH_DUMP_BACKEND_BINDING')
  exact(att,('kind','sqlObserved','imageId','exeSha256','contract'),'EPOCH_PGDUMP_ATTESTATION_SCHEMA')
  need(att['kind']=='pinned-pgdump16-implementation-attestation' and att['sqlObserved'] is False and att['imageId']==IMAGE and att['exeSha256']==lane['exeSha256'] and att['contract']=='pg_dump serializable-deferrable read-only snapshot; precheck PID excluded','EPOCH_PGDUMP_READONLY_IMPLEMENTATION')
  need(collection['evidenceRefs']['ciphertext-bytes:'+db]==lane['ciphertext'],'EPOCH_COLLECTION_CIPHERTEXT_BINDING')
  baseline=reader.json(manifest['baselineManifest']);need(lane['snapshotId']==baseline['snapshotId']==b['epoch'],'EPOCH_LOGICAL_HELD_SNAPSHOT')
 exact(p['objects'],('before','after','restored'),'EPOCH_OBJECT_CLOSURE');objectvalues={}
 for side,r in p['objects'].items():
  o=actual(r,'objects:'+side);exact(o,('binding','scopeSha256','objects','sourceFactsSha256'),'EPOCH_OBJECT_RAW_INVENTORY')
  need(o['binding']==b and hashok(o['scopeSha256']) and o['sourceFactsSha256']==sha(canonical(o['objects'])),'EPOCH_OBJECT_SOURCE_FACTS')
  need(type(o['objects']) is list,'EPOCH_OBJECT_LIST');keys=[]
  for item in o['objects']:
   exact(item,('bucket','key','versionId','bytes','sha256','content'),'EPOCH_OBJECT_VERSIONED_REFERENCE');need(all(type(item[k]) is str and item[k] for k in ('bucket','key','versionId')) and type(item['bytes']) is int and item['bytes']>=0 and hashok(item['sha256']),'EPOCH_OBJECT_VERSION')
   raw=b''.join(reader.blocks(item['content']));need(len(raw)==item['bytes'] and sha(raw)==item['sha256'],'EPOCH_OBJECT_RESTORE_BYTES');keys.append((item['bucket'],item['key'],item['versionId']))
  need(len(keys)==len(set(keys)) and keys==sorted(keys),'EPOCH_OBJECT_INVENTORY_ORDER');objectvalues[side]=o
 need(objectvalues['before']==objectvalues['after']==objectvalues['restored'],'EPOCH_OBJECT_RESTORE_DRIFT')
 iso=p['isolation'];exact(iso,('binding','baselineSha','release','stageReceipts'),'EPOCH_ISOLATION_SCHEMA');need(iso['binding']['candidateSha']==APP and iso['binding']['targetInstanceId']==b['targetInstanceId'] and iso['baselineSha']==BASE,'EPOCH_ISOLATION_TARGET')
 need(set(iso['stageReceipts'])==set(STAGES),'EPOCH_EIGHT_STAGES')
 for stage,r in iso['stageReceipts'].items():
  outer=actual(r,'stage:'+stage);verify_outer(outer,iso['binding'],stage)
  if stage in ('before','after','canonical-setup'):
   for db,nested in outer['proofRefs'].items():verify_result(reader.json(nested),iso['binding'],stage,None if db=='canonical' else db)
 conservation(iso,reader=lambda path,h:b''.join(reader.blocks(reader.reference(path))) if reader.reference(path)['sha256']==h else (_ for _ in ()).throw(ValueError('EPOCH_NESTED_HASH')))
 exact(p['journeys'],JOURNEYS,'EPOCH_SIX_JOURNEYS')
 for journey,r in p['journeys'].items():
  j=actual(r,'journey:'+journey);exact(j,('binding','request','response','body'),'EPOCH_JOURNEY_RAW_OUTPUT');need(j['binding']==b and j['request']['targetInstanceId']==b['targetInstanceId'] and j['request']['candidateSha']==APP and j['response']['status']==200,'EPOCH_JOURNEY_TARGET_STATUS')
  body=b''.join(reader.blocks(j['body']));need(j['response']['bodySha256']==sha(body),'EPOCH_JOURNEY_BODY_HASH')
  if journey=='pdfDownload':need(body.startswith(b'%PDF-') and len(body)>8,'EPOCH_PDF_CONTENT')
  else:
   value=json.loads(body)
   if journey=='login':need(type(value.get('subject')) is str and value['subject'] and hashok(value.get('sessionSha256')),'EPOCH_LOGIN_OUTPUT')
   elif journey=='hello':need(value.get('message')=='hello' and value.get('subject'),'EPOCH_HELLO_OUTPUT')
   elif journey=='asr':need(type(value.get('transcript')) is str and value['transcript'] and hashok(value.get('audioSha256')),'EPOCH_ASR_OUTPUT')
   elif journey=='githubFeedbackRead':need(type(value.get('items')) is list and value.get('method')=='GET','EPOCH_GITHUB_READ_OUTPUT')
   elif journey=='skillTool':need(value.get('toolName') and value.get('invocationId') and 'result' in value,'EPOCH_SKILL_OUTPUT')
 # SQL writes remain closed throughout backup/object captures. Isolation runs
 # target only; its operations may run after production capture finishes.
 low=observations['before']['observedAt'];high=observations['after']['observedAt']
 for kind,start,end in window:
  if kind.startswith(('dump:','backend:','permissions:','objects:')):need(low<=start<=end<=high,'EPOCH_CAPTURE_OUTSIDE_HELD_WINDOW')
 journal=actual(p['heldJournal'],'held-interval-journal');exact(journal,('binding','events'),'EPOCH_HELD_JOURNAL')
 need(journal['binding']==b and type(journal['events']) is list and len(journal['events'])>=2,'EPOCH_HELD_JOURNAL_BINDING')
 last=None
 for event in journal['events']:
  exact(event,('observedAt','holdGeneration','state','writerSessions','writerContainers','automationAdmitted'),'EPOCH_HELD_JOURNAL_EVENT')
  need(type(event['observedAt']) in (int,float) and math.isfinite(event['observedAt']) and (last is None or last<event['observedAt']) and event['holdGeneration']==b['holdGeneration'] and event['state']=='held' and event['writerSessions']==[] and event['writerContainers']==[] and event['automationAdmitted']==[],'EPOCH_HELD_INTERVAL_REOPENED');last=event['observedAt']
 need(journal['events'][0]['observedAt']<=low and journal['events'][-1]['observedAt']>=high,'EPOCH_HELD_JOURNAL_WINDOW')
 need(set(policy['invocations'])==used,'EPOCH_INVOCATION_FULL_CLOSURE');reader.finish()
 output=Path(p['outputRoot']);need(output.is_absolute() and '..' not in output.parts,'EPOCH_OUTPUT_ROOT')
 publication=_QualificationPublication(reader,output,existing)
 database_refs={}
 for db in DBS:
  database_refs[db]=publication.emit(db+'.json',{'schemaVersion':2,'kind':'qualified-held-database-evidence','binding':b,'artifacts':manifest['databases'][db],'permissions':p['permissions'][db],'dumpLane':p['dumpLanes'][db],'sourcePolicy':p['sourcePolicy'],'collection':p['collection']})
 object_ref=publication.emit('objects.json',{'schemaVersion':2,'kind':'qualified-held-object-recovery','binding':b,'artifacts':p['objects'],'sourcePolicy':p['sourcePolicy']})
 result={'schemaVersion':1,'kind':'held-current-epoch-manifest','identity':i,'toolRevision':b['toolRevision'],'holdGeneration':b['holdGeneration'],'databases':database_refs,'objectRecovery':object_ref,'beforeHeldObservationSha256':p['before']['sha256'],'afterHeldObservationSha256':p['after']['sha256']}
 epoch=publication.emit('epoch.json',result)
 publication.finish()
 return {**result,'kind':'held-current-epoch-evidence','epoch':epoch}


def main():
 # Fixed entry only reads root-private source-approved inputs. It never issues
 # SQL, provider calls, captures, replays workloads or releases a hold/lock.
 need(os.geteuid()==0 and os.getegid()==0,'EPOCH_ROOT_ONLY')
 need(len(sys.argv)==3 and sys.argv[1] in ('--qualify-current-epoch','--verify-prehold-epoch'),'EPOCH_USAGE')
 rootprofile=Path('/etc/workspacex-cn/trusted-tool-binding.json')
 authority=recovery.ProtectedArtifacts(rootprofile.parent)
 profile=authority.json(authority.reference(rootprofile))
 prehold=sys.argv[1]=='--verify-prehold-epoch'
 entry=profile.get('preholdEpochQualification' if prehold else 'currentEpochQualification')
 exact(entry,('schemaVersion','sourcePath','sha256','input','sourcePolicy','executablePins'),'EPOCH_ROOT_SOURCE_POLICY_CAPABILITY')
 need(entry['schemaVersion']==2 and entry['sourcePath']=='.harness/scripts/vm/current_epoch_qualification.py' and entry['sha256']==sha(Path(__file__).read_bytes()) and profile['filesSha256'].get(entry['sourcePath'])==entry['sha256'],'EPOCH_ENTRY_SOURCE_BINDING')
 need(sys.argv[2]==entry['input']['path'],'EPOCH_FIXED_INPUT_PATH')
 inputpath=Path(sys.argv[2]);need(inputpath.name=='qualification-input.json' and inputpath.parent.parent.parent==Path('/etc/workspacex-cn/maintenance-evidence'),'EPOCH_ATTEMPT_INPUT_PATH')
 reader=recovery.ProtectedArtifacts(inputpath.parent)
 p=reader.json(entry['input']);need(p['binding']['toolRevision']==profile['toolRevision'],'EPOCH_ROOT_TOOL_BINDING')
 approved=reader.json(entry['sourcePolicy'])
 for path,r in approved['sources'].items():need(profile['filesSha256'].get(path)==r['sha256'],'EPOCH_ROOT_MODULE_CLOSURE')
 need(p['outputRoot']==str(inputpath.parent/'qualified-current-epoch'),'EPOCH_FIXED_OUTPUT_ROOT')
 source_pins={}
 for source,r in approved['sources'].items():
  expected=str(Path('/usr/local/lib/workspacex-cn')/source.removeprefix('.harness/scripts/vm/'))
  need(r['path']==expected and r['sha256']==profile['filesSha256'].get(source),'EPOCH_ROOT_CODE_SOURCE_PIN')
  source_pins[source]={'path':expected,'sha256':r['sha256']}
 code_authority=QualificationCodeAuthority(source_pins,entry['executablePins'])
 authority.finish()
 consumer=verify_existing_qualification if prehold else qualify
 result=consumer(p,reader,entry['sourcePolicy'],code_authority=code_authority)
 authority.finish();reader.finish()
 print(json.dumps(result,sort_keys=True,separators=(',',':')))
if __name__=='__main__':
 try:main()
 except BaseException:
  print('CURRENT_EPOCH_QUALIFICATION_REJECTED',file=sys.stderr);sys.exit(1)
