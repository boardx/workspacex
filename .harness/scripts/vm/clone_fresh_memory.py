"""Fresh clone memory stage; same Admission and external lifecycle owner."""
import json,uuid,hashlib,re
from isolated_rehearsal import Admission,validate_binding,exclusive
from clone_quiescence import SOURCE,KEYS,ref_bytes,need,canonical

def run(p,admission,invoke=None):
 need(type(p)is dict and set(p) in ({'binding','approval','quiescenceReceipt','secret'},{'binding','approval','quiescenceReceipt','secret','mode'}),'MEMORY_INPUT')
 b=validate_binding(p['binding']);mode=p.get('mode','check')
 need(b['candidateSha']==SOURCE and str(uuid.UUID(b['attemptId']))==b['attemptId'] and uuid.UUID(b['attemptId']).version==4,'MEMORY_SOURCE_ATTEMPT')
 need(isinstance(admission,Admission) and admission.b==b,'SAME_ADMISSION_REQUIRED');admission.check()
 need(mode in ('check','prepare'),'MEMORY_MODE');bound={k:b[k] for k in KEYS};schema='wsx_fixture_'+b['attemptId'].replace('-','')
 q=json.loads(ref_bytes(p['quiescenceReceipt']))
 need(p['quiescenceReceipt']['path']==str(admission.root/'clone-quiescence.receipt.json') and q.get('kind')=='clone-quiescence-result-v1' and q.get('binding')==bound and q.get('committed') is True and q.get('a3Accepted') is False and q.get('afterCounts')==[0]*11,'QUIESCENCE_COMMIT_REQUIRED')
 approval=json.loads(ref_bytes(p['approval']))
 need(b.get('freshMemoryApproval')==p['approval'] and approval=={'kind':'clone-fresh-memory-approved-v1','binding':bound,'quiescenceReceiptSha256':p['quiescenceReceipt']['sha256'],'schema':schema,'mode':mode,'originalSchema':'workspacex_memory','runtimeRole':'memory_rw','ownerRole':'memory_owner'},'MEMORY_APPROVAL')
 intent={'kind':'clone-fresh-memory-intent-v1','binding':bound,'schema':schema,'approvalSha256':p['approval']['sha256'],'quiescenceReceiptSha256':p['quiescenceReceipt']['sha256']}
 if mode=='prepare':exclusive(admission.root/'clone-fresh-memory.intent.json',intent)
 admission.check()
 if mode=='prepare':exclusive(admission.root/'clone-fresh-memory.dispatch.json',{'intentSha256':hashlib.sha256(canonical(intent)).hexdigest(),'state':'unknown-until-receipt'})
 payload={'binding':b,'secret':p['secret'],'schema':schema,'mode':mode,'deadlineEpoch':admission.deadline,'monotonicDeadline':admission.end}
 if b['tls']['sslmode']=='verify-full':payload['caPem']=ref_bytes(b['tls']['ca']).decode()
 if invoke is None:
  from clone_quiescence_adapter import invoke as docker_invoke
  invoke=lambda v:docker_invoke(v,runtime_spec_key='freshMemoryRuntime')
 result=invoke(payload)
 need(type(result)is dict and set(result)=={'kind','binding','schema','prepared','a3Accepted','originalRows','originalSha256','freshRows'},'MEMORY_RESULT_SHAPE')
 need(result['kind']=='clone-fresh-memory-result-v1' and result['binding']==bound and result['schema']==schema and result['prepared']is(mode=='prepare') and result['a3Accepted'] is False and type(result['originalRows'])is int and result['originalRows']>=0 and type(result['originalSha256'])is str and re.fullmatch('[a-f0-9]{64}',result['originalSha256']),'MEMORY_RESULT')
 need(result['freshRows'] is None if mode=='check' else type(result['freshRows'])is int and result['freshRows']==0,'MEMORY_EMPTY')
 if mode=='prepare':exclusive(admission.root/'clone-fresh-memory.receipt.json',result)
 admission.check();return result
