#!/usr/bin/env python3
"""Collect source-owned held-epoch evidence. No acquisition, SQL or admission."""
import hashlib,json,math,os,re,stat,sys
from pathlib import Path
from cn_backup_package import APP,BASE,RDS,ECS
from writer_fence import DATABASES,require
from isolated_conservation_plan import read_ref,private_bytes
from isolated_conservation_evidence_producer import safe
from cn_production_recovery_executor import Protected

DB_FIELDS=('ciphertext','catalog','roles','acl','sequence','version')
JOURNEYS=('login','hello','asr','githubFeedbackRead','skillTool','pdfDownload')
BIND_FIELDS=('identity','toolRevision','host','epoch','holdGeneration')
def exact(value,keys,code):require(type(value) is dict and set(value)==set(keys),code)
def hash_shape(value):return type(value) is str and re.fullmatch('[a-f0-9]{64}',value) is not None

def binding(p,*,expected_identity):
 exact(p['identity'],('sourceRevision','baselineRevision','migrationPlanSha256','attemptId'),'EPOCH_IDENTITY_SHAPE')
 i=p['identity'];exact(expected_identity,('sourceRevision','baselineRevision','migrationPlanSha256','attemptId'),'EPOCH_AUTHORITY_IDENTITY');require(i==expected_identity and type(i['sourceRevision']) is str and re.fullmatch('[a-f0-9]{40}',i['sourceRevision']) and i['baselineRevision']==BASE and hash_shape(i['migrationPlanSha256']) and type(i['attemptId']) is str and re.fullmatch('[A-Za-z0-9-]{1,32}',i['attemptId']),'EPOCH_FIXED_IDENTITY')
 require(type(p['toolRevision']) is str and re.fullmatch('[a-f0-9]{40}',p['toolRevision']),'EPOCH_TOOL_REVISION')
 exact(p['host'],('instanceId','bootId'),'EPOCH_HOST_SHAPE');require(p['host']['instanceId']==ECS and type(p['host']['bootId']) is str and re.fullmatch('[a-f0-9-]{36}',p['host']['bootId']),'EPOCH_HOST')
 require(hash_shape(p['epoch']) and type(p['holdGeneration']) is str and re.fullmatch('[a-f0-9]{32}',p['holdGeneration']),'EPOCH_GENERATION')
 return {k:p[k] for k in BIND_FIELDS}

def produce(p,reader=private_bytes,large_reader=None,*,expected_identity):
 exact(p,(*BIND_FIELDS,'kind','before','after','databases','objects','cleanup','isolation'),'EPOCH_INPUT_SHAPE')
 require(p['kind']=='current-held-epoch-evidence-input','ONLINE_BACKUP_NOT_EPOCH')
 b=binding(p,expected_identity=expected_identity);refs={};seen=set();protected=Protected()
 def collect(ref,kind,database=None,target=None):
  value=read_ref(ref,reader)
  # Only this explicit cleanup boolean is a safe credential-named field.
  scrubbed=dict(value)
  if kind=='cleanup-credentialCleanup' and type(value.get('facts')) is dict:
   scrubbed['facts']={k:v for k,v in value['facts'].items() if k!='credentialCleanup'}
   require(type(value['facts'].get('credentialCleanup')) is bool,'EPOCH_CLEANUP_BOOLEAN')
  safe(scrubbed)
  exact(value,(*BIND_FIELDS,'kind','passed','facts'),'EPOCH_PROOF_SHAPE')
  require(all(value[k]==b[k] for k in BIND_FIELDS),'EPOCH_PROOF_BINDING')
  require(value['kind']==kind and value['passed'] is True and type(value['facts']) is dict,'EPOCH_PROOF_KIND')
  if database:require(value['facts'].get('database')==database,'EPOCH_DATABASE_BINDING')
  if target:require(value['facts'].get('targetInstanceId')==target,'EPOCH_ISOLATION_BINDING')
  require(ref['path'] not in seen,'EPOCH_REFERENCE_REUSE');seen.add(ref['path']);refs[kind+(':'+database if database else '')]=dict(ref)
  return value['facts']
 observations=[]
 for phase in ('before','after'):
  exact(p[phase],('held','drained'),'EPOCH_OBSERVATION_SET')
  values={k:collect(p[phase][k],phase+'-'+k) for k in ('held','drained')}
  require(values['held'].get('state')=='held' and values['drained'].get('allWritersDrained') is True,'EPOCH_NOT_HELD_DRAINED')
  for facts in values.values():
   require(type(facts.get('observedAt')) in (int,float) and math.isfinite(facts['observedAt']),'EPOCH_OBSERVATION_TIME')
  observations.append(values)
 require(min(v['observedAt'] for v in observations[1].values())>max(v['observedAt'] for v in observations[0].values()),'EPOCH_OBSERVATION_ORDER')
 for key in ('held','drained'):
  require(p['before'][key]['sha256']!=p['after'][key]['sha256'],'EPOCH_INDEPENDENT_OBSERVATIONS')
 exact(p['databases'],DATABASES,'EPOCH_THREE_DATABASES');ciphertexts={}
 for db,items in p['databases'].items():
  exact(items,DB_FIELDS,'EPOCH_DATABASE_COMPONENTS')
  for component,ref in items.items():
   facts=collect(ref,'database-'+component,db)
   require(facts.get('complete') is True and facts.get('sourceRdsInstanceId')==RDS,'EPOCH_DATABASE_COMPLETENESS')
   if component=='ciphertext':
    artifact=facts.get('artifact');exact(artifact,('path','sha256','bytes'),'EPOCH_CIPHERTEXT_REFERENCE')
    require(hash_shape(artifact['sha256']) and type(artifact['bytes']) is int and artifact['bytes']>0,'EPOCH_CIPHERTEXT_HASH')
    if large_reader:large_reader(artifact)
    else:protected.bind_large(artifact['path'],artifact['sha256'],artifact['bytes'])
    refs['ciphertext-bytes:'+db]=dict(artifact);ciphertexts[db]=artifact['sha256']
 exact(p['objects'],('inventory','version','recovery'),'EPOCH_OBJECT_COMPONENTS')
 objectfacts={k:collect(ref,'objects-'+k) for k,ref in p['objects'].items()}
 scope=objectfacts['inventory'].get('objectScopeSha256');require(hash_shape(scope),'EPOCH_OBJECT_SCOPE')
 require(all(v.get('objectScopeSha256')==scope and v.get('complete') is True for v in objectfacts.values()),'EPOCH_OBJECT_CLOSURE')
 require(all(hash_shape(v.get('inventorySha256')) for v in objectfacts.values()) and len({v['inventorySha256'] for v in objectfacts.values()})==1,'EPOCH_OBJECT_INVENTORY_DRIFT')
 exact(p['cleanup'],('ownedChildrenJoined','credentialCleanup'),'EPOCH_CLEANUP_COMPONENTS')
 for name,ref in p['cleanup'].items():require(collect(ref,'cleanup-'+name).get(name) is True,'EPOCH_CLEANUP_NOT_PROVEN')
 exact(p['isolation'],('targetInstanceId','restoreFidelity','journeys'),'EPOCH_ISOLATION_COMPONENTS')
 iso=p['isolation'];target=iso['targetInstanceId'];require(type(target) is str and re.fullmatch('pgm-[a-z0-9]+',target) and target!=RDS,'EPOCH_PRODUCTION_ISOLATION_FORBIDDEN')
 exact(iso['restoreFidelity'],DATABASES,'EPOCH_RESTORE_DATABASES')
 for db,ref in iso['restoreFidelity'].items():
  facts=collect(ref,'isolation-restore-fidelity',db,target)
  require(all(facts.get(k) is True for k in ('dataFidelityVerified','readOnly','rollbackComplete')),'EPOCH_RESTORE_FIDELITY')
  require(facts.get('ciphertextSha256')==ciphertexts[db],'EPOCH_RESTORE_CIPHERTEXT_DRIFT')
 exact(iso['journeys'],JOURNEYS,'EPOCH_SIX_JOURNEYS')
 for journey,ref in iso['journeys'].items():require(collect(ref,'isolation-journey-'+journey,target=target).get(journey) is True,'EPOCH_JOURNEY_NOT_PASSED')
 if not large_reader:protected.recheck()
 return {'schemaVersion':1,'kind':'current-held-epoch-evidence-collection',**b,'sourceRdsInstanceId':RDS,'isolatedTargetInstanceId':target,'evidenceRefs':refs,'collectionVerified':True,'ready':False,'qualified':False,'prepared':False,'remainingTransport':'retained-scoped-backup-transport-required'}

def write_collection(path,value):
 """Exclusive private immutable bytes; repeated path requires explicit reconciliation."""
 p=Path(path);require(p.is_absolute() and '..' not in p.parts,'EPOCH_OUTPUT_PATH')
 for parent in p.parents:
  st=parent.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and not st.st_mode&0o022,'EPOCH_OUTPUT_PARENT')
 require(stat.S_IMODE(p.parent.stat().st_mode)==0o700,'EPOCH_OUTPUT_PRIVATE_ROOT')
 raw=json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
 return {'path':str(p),'sha256':hashlib.sha256(raw).hexdigest()}

def protected_collection_identity(original_ref,payload,read_private):
 """Root-private original plan and installed source pin, not stdin approval."""
 exact(original_ref,('path','sha256'),'EPOCH_ORIGINAL_REFERENCE')
 require(hash_shape(original_ref['sha256']),'EPOCH_ORIGINAL_PIN_SHAPE')
 raw=read_private(original_ref['path']);require(len(raw)<=1024*1024 and hashlib.sha256(raw).hexdigest()==original_ref['sha256'],'EPOCH_ORIGINAL_PIN')
 original=json.loads(raw)
 require(original.get('schemaVersion')==1 and original.get('mode')=='maintenance-all-writer-fence' and original.get('productionActionsAuthorized') is True and not any(k in original for k in ('runtimeSourcePlanSha256','controlSessions','diagnosticSessions')),'EPOCH_ORIGINAL_PLAN')
 profile_raw=read_private('/etc/workspacex-cn/trusted-tool-binding.json');profile=json.loads(profile_raw)
 require(original.get('toolRevision')==payload.get('toolRevision')==profile.get('toolRevision') and profile.get('filesSha256',{}).get('.harness/scripts/vm/current_held_epoch_evidence_producer.py')==hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'EPOCH_ORIGINAL_TOOL_SOURCE')
 identity=original.get('identity');binding(payload,expected_identity=identity)
 require(read_private(original_ref['path'])==raw and read_private('/etc/workspacex-cn/trusted-tool-binding.json')==profile_raw,'EPOCH_ORIGINAL_AUTHORITY_DRIFT')
 return dict(identity)

if __name__=='__main__':
 try:
  require(os.geteuid()==0 and os.getegid()==0,'EPOCH_ROOT_ONLY')
  require(len(sys.argv)==5 and sys.argv[1]=='--protected-collection','EPOCH_PROTECTED_COLLECTION_USAGE')
  raw=sys.stdin.buffer.read(16*1024*1024+1);require(len(raw)<=16*1024*1024,'EPOCH_INPUT_LIMIT');payload=json.loads(raw)
  from host_transport import private
  identity=protected_collection_identity({'path':sys.argv[3],'sha256':sys.argv[4]},payload,private)
  output='/etc/workspacex-cn/maintenance-evidence/'+identity['sourceRevision']+'/'+identity['attemptId']+'/epoch-collection.json'
  require(sys.argv[2]==output,'EPOCH_APPROVED_COLLECTION_OUTPUT')
  print(json.dumps(write_collection(output,produce(payload,expected_identity=identity)),sort_keys=True))
 except Exception:print('CURRENT_HELD_EPOCH_COLLECTION_REJECTED',file=sys.stderr);sys.exit(1)
