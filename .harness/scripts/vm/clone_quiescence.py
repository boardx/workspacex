"""Clone-only stage supervisor. Caller owns the existing Admission and cleanup lifecycle."""
import hashlib,json,os,re,stat,uuid
from pathlib import Path
from isolated_rehearsal import Admission,STAGES,exclusive,trusted_bytes,validate_binding
SOURCE='5285bef9a6c91bbb9857ede42779aafa64b98f32'
SQL_SHA='7440c6dcccddfc1857fe3461344be4efb4794201bd6ffcfaac86da9a2f26d85f'
KEYS=('accountId','regionId','attemptId','candidateSha','targetInstanceId','providerCreatedUtc','peerSha256')
def need(value,code):
 if not value:raise ValueError(code)
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def ref_bytes(ref):
 need(type(ref)is dict and set(ref)=={'path','sha256'} and Path(ref['path']).is_absolute() and '..' not in Path(ref['path']).parts and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'QUIESCENCE_REF')
 return trusted_bytes(ref['path'],ref['sha256'])
def run(p,admission,invoke=None):
 """invoke is the lane's fixed hash-verified engine adapter, never a user command."""
 if invoke is None:
  from clone_quiescence_adapter import invoke
 need(type(p)is dict and set(p) in ({'binding','sql','approval','originalReceipts','sealedEvidence','secret','fixtureActor'},{'binding','mode','sql','approval','originalReceipts','sealedEvidence','secret','fixtureActor'}),'QUIESCENCE_INPUT')
 p=dict(p,mode=p.get('mode','check'))
 b=validate_binding(p['binding']);need(b['candidateSha']==SOURCE,'QUIESCENCE_SOURCE')
 need(str(uuid.UUID(b['attemptId']))==b['attemptId'] and uuid.UUID(b['attemptId']).version==4,'CANONICAL_ATTEMPT_V4')
 need(isinstance(admission,Admission) and admission.b==b,'SAME_ADMISSION_REQUIRED');admission.check()
 need(p['mode'] in ('check','commit'),'QUIESCENCE_MODE')
 need(p['sql']['sha256']==SQL_SHA,'QUIESCENCE_FIXED_SQL');sql=ref_bytes(p['sql']).decode()
 bound={k:b[k] for k in KEYS};need(type(p['originalReceipts'])is dict and set(p['originalReceipts'])==set(STAGES),'ORIGINAL_EIGHT_RECEIPTS')
 hashes={}
 for stage,ref in p['originalReceipts'].items():
  receipt=json.loads(ref_bytes(ref));need(receipt.get('accepted') is True and all(receipt.get(k)==b[k] for k in ('targetInstanceId','attemptId','candidateSha')),'ORIGINAL_RECEIPT_BINDING');hashes[stage]=ref['sha256']
 sealed=json.loads(ref_bytes(p['sealedEvidence']))
 need(sealed=={'kind':'isolated-original-evidence-sealed-v1','binding':bound,'receiptSha256':hashes,'externalPreservationVerified':True},'EXTERNAL_EVIDENCE_SEAL')
 approval=json.loads(ref_bytes(p['approval']))
 need(approval=={'kind':'clone-quiescence-approved-v1','binding':bound,'sqlSha256':SQL_SHA,'originalReceiptSha256':hashes,'sealedEvidenceSha256':p['sealedEvidence']['sha256'],'fixtureActor':p['fixtureActor'],'allowedMode':p['mode']},'QUIESCENCE_APPROVAL')
 # Independent root manifest must pin this approval ref: an arbitrary path/hash is not authority.
 expected=b.get('cloneQuiescenceApproval')
 need(expected==p['approval'],'ROOT_APPROVAL_BINDING')
 need(type(p['fixtureActor'])is str and 0<len(p['fixtureActor'])<=256,'FIXTURE_ACTOR')
 intent={'kind':'clone-quiescence-intent-v1','binding':bound,'sqlSha256':SQL_SHA,'approvalSha256':p['approval']['sha256'],'originalReceiptSha256':hashes,'mode':p['mode']}
 root=admission.root;name='clone-quiescence'
 if p['mode']=='commit':exclusive(root/(name+'.intent.json'),intent)
 admission.check()
 if p['mode']=='commit':exclusive(root/(name+'.dispatch.json'),{'intentSha256':hashlib.sha256(canonical(intent)).hexdigest(),'outcome':'unknown-until-receipt'})
 payload={'binding':b,'secret':p['secret'],'sql':sql,'sqlSha256':SQL_SHA,'mode':p['mode'],'fixtureActor':p['fixtureActor'],'deadlineEpoch':admission.deadline,'monotonicDeadline':admission.end}
 if b['tls']['sslmode']=='verify-full':payload['caPem']=ref_bytes(b['tls']['ca']).decode()
 result=invoke(payload)
 need(type(result)is dict and result.get('kind')=='clone-quiescence-result-v1' and result.get('binding')==bound and result.get('sqlSha256')==SQL_SHA and set(result)=={'kind','binding','sqlSha256','committed','rolledBack','a3Accepted','beforeCounts','afterCounts'} and result.get('a3Accepted') is False and type(result.get('beforeCounts')) is list and len(result['beforeCounts'])==11 and all(type(x)is int and x>=0 for x in result['beforeCounts']) and result.get('afterCounts')==[0]*11 and all(type(x)is int for x in result['afterCounts']) and result.get('committed')is(p['mode']=='commit') and result.get('rolledBack')is(p['mode']=='check'),'QUIESCENCE_RESULT')
 if p['mode']=='commit':exclusive(root/(name+'.receipt.json'),result)
 admission.check()
 return result
