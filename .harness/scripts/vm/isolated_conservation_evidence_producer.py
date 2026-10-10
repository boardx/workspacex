#!/usr/bin/env python3
"""Offline hash-bound collection only. Never executes replay or grants admission."""
import hashlib,json,re,sys
from isolated_rehearsal import STAGES,validate_binding
from writer_fence import admitted_release_identity
from isolated_conservation_plan import DBS,private_bytes,read_ref,reject
from isolated_conservation_stage import verify_result

FIXED_APP='9b25bfa65662b96c0826fe67506b562ea46aa6d0'
FIXED_BASE='ba6343199f3c834d6a198f83d0c771614292c82b'
FIXED_RELEASE='2026.10.3-cn.1'

def safe(value):
 if isinstance(value,dict):
  for key,item in value.items():
   if any(part in key.lower() for part in ('password','secret','credential','token')):reject('SECRET_BEARING_EVIDENCE')
   safe(item)
 elif isinstance(value,list):
  for item in value:safe(item)

def fidelity(proof,b,database):
 if proof.get('database')!=database or proof.get('targetRdsInstanceId')!=b['targetInstanceId'] or proof.get('targetPeerAddressSha256')!=b['peerSha256']:reject('FIDELITY_IDENTITY')
 if any(proof.get(key) is not True for key in ('dataFidelityVerified','readOnly','rollbackComplete')):reject('FIDELITY_REQUIRED')
 for key in ('backupReceiptSha256','ciphertextSha256'):
  if not re.fullmatch('[a-f0-9]{64}',proof.get(key,'')):reject('ARCHIVE_HASH_REQUIRED')

def produce(payload,reader=private_bytes,*,expected_identity,expected_isolation_binding,expected_release):
 b=validate_binding(payload['binding'])
 if type(expected_identity) is not dict or set(expected_identity)!={'sourceRevision','baselineRevision','migrationPlanSha256','attemptId'}:reject('CONSERVATION_AUTHORITY_IDENTITY')
 if type(expected_isolation_binding) is not dict or set(expected_isolation_binding)!={'candidateSha','attemptId','targetInstanceId'}:reject('CONSERVATION_CHILD_AUTHORITY')
 if any(type(expected_identity[k]) is not str or not re.fullmatch('[a-f0-9]{40}',expected_identity[k]) for k in ('sourceRevision','baselineRevision')) or type(expected_identity['migrationPlanSha256']) is not str or not re.fullmatch('[a-f0-9]{64}',expected_identity['migrationPlanSha256']):reject('CONSERVATION_AUTHORITY_IDENTITY')
 if not admitted_release_identity(expected_identity) or type(expected_identity['attemptId']) is not str or not re.fullmatch('[A-Za-z0-9-]{1,32}',expected_identity['attemptId']):reject('CONSERVATION_AUTHORITY_IDENTITY')
 if type(expected_release) is not str or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,127}',expected_release):reject('CONSERVATION_RELEASE_AUTHORITY')
 if expected_isolation_binding['candidateSha']!=expected_identity['sourceRevision'] or any(b[k]!=expected_isolation_binding[k] for k in expected_isolation_binding) or payload.get('baselineSha')!=expected_identity['baselineRevision'] or payload.get('release')!=expected_release:reject('FIXED_RELEASE_IDENTITY')
 refs=payload['stageReceipts']
 if set(refs)!=set(STAGES):reject('COMPLETE_STAGE_SET_REQUIRED')
 collected={};nested={};snapshot_hashes={}
 for stage in STAGES:
  outer=read_ref(refs[stage],reader);safe(outer)
  if outer.get('accepted') is not True or any(outer.get(k)!=b[k] for k in ('targetInstanceId','attemptId','candidateSha')) or outer.get('stage',stage)!=stage:reject('STAGE_RECEIPT_BINDING')
  if stage in ('restore','before','after','snapshot','recovery-verify') and (len(outer.get('databases',[]))!=len(DBS) or set(outer['databases'])!=set(DBS)):reject('THREE_DATABASE_CLOSURE')
  proofs={}
  if stage in ('restore','before','after','canonical-setup'):
   key='baselineProofRefs' if stage=='restore' else 'proofRefs'
   expected={'canonical'} if stage=='canonical-setup' else set(DBS)
   if set(outer.get(key,{}))!=expected:reject('NESTED_PROOF_CLOSURE')
   for name,ref in outer[key].items():
    proof=read_ref(ref,reader);safe(proof)
    if stage=='restore':fidelity(proof,b,name)
    else:verify_result(proof,b,stage,None if name=='canonical' else name)
    proofs[name]=ref['sha256']
  if stage in ('snapshot','recovery-verify'):
   if outer.get('ownedCleanupVerified') is not True or outer.get('plaintextArchiveCreated') is not False or set(outer.get('snapshots',{}))!=set(DBS):reject('RECOVERY_CLOSURE')
   for database,proof in outer['snapshots'].items():
    # Snapshot only proves encrypted capture; recovery must prove actual fidelity.
    if stage=='recovery-verify':
     fidelity(proof,b,database)
     if proof['ciphertextSha256']!=snapshot_hashes[database]:reject('RECOVERY_SNAPSHOT_HASH_DRIFT')
    elif not re.fullmatch('[a-f0-9]{64}',proof.get('ciphertextSha256','')):reject('SNAPSHOT_HASH_REQUIRED')
    else:snapshot_hashes[database]=proof['ciphertextSha256']
  collected[stage]=refs[stage]['sha256'];nested[stage]=proofs
 result={'schemaVersion':1,'kind':'isolated-conservation-evidence-collection','attemptId':b['attemptId'],'targetInstanceId':b['targetInstanceId'],'candidateSha':b['candidateSha'],'baselineSha':payload['baselineSha'],'release':payload['release'],'parentIdentity':dict(expected_identity),'migrationPlanSha256':expected_identity['migrationPlanSha256'],'stageReceiptSha256':collected,'nestedProofSha256':nested,'collectionVerified':True,'qualified':False,'prepared':False,'fullReady':False}
 result['receiptSha256']=hashlib.sha256(json.dumps(result,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 return result

if __name__=='__main__':
 try:
  raw=sys.stdin.buffer.read(16*1024*1024+1)
  if len(raw)>16*1024*1024:reject('INPUT_SIZE_LIMIT')
  print(json.dumps(produce(json.loads(raw)),sort_keys=True))
 except Exception:
  print('ISOLATED_EVIDENCE_COLLECTION_REJECTED',file=sys.stderr);sys.exit(1)
