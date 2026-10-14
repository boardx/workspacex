#!/usr/bin/env python3
"""Bound child workflow coordinator. Missing cold approval bridge fails closed."""
import argparse, hashlib, importlib.util, json, os, re
from pathlib import Path
def module(name,file):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
D=module('dispatch','cn-release-mvp-dispatch.py');B=module('binding','cn-release-mvp-chain.py')
T=module('transfer_input','cn-release-mvp-transfer-input.py')

def bridge_admission(status):
 D.need(isinstance(status,dict),'ROOT_BRIDGE_STATUS_REQUIRED')
 required=('fixedReleaseInstalled','advanceInstalled','controlInstalled','approvalStoreInstalled','sudoFixedEntryAllowed')
 D.need(all(status.get(k)is True for k in required),'ROOT_BRIDGE_NOT_READY')
 # Observations admit preparation only. They cannot authorize/install anything.
 return True

def cold_prepare(bundle,control,root):
 identity=B.identity(bundle['identity']);D.need(identity['controlRevision']==control,'MASTER_CONTROL')
 bridge_admission(bundle.get('rootBridgeStatus'))
 request=bundle['buildRequest']
 D.need(request['stage']=='build'and request['controlRevision']==control and request['releaseId']==identity['releaseId'],'BUILD_IDENTITY')
 plan=json.loads(request['inputs']['candidate_plan'])
 D.need(plan['sourceRevision']==identity['sourceRevision']and plan['controlRevision']==control,'BUILD_PLAN_IDENTITY')
 built=D.coordinate(request,root/'build-intent.json')
 (root/'build-receipt.json').write_text(json.dumps(built,sort_keys=True)+'\n')
 derived=T.derive(identity,built['runId'],bundle['reviewedTransferPolicy'])
 inputs=dict(transfer_plan=derived['transferRaw'],revalidation_template=derived['templateRaw'],plan_sha256=hashlib.sha256(derived['transferRaw'].encode()).hexdigest())
 transfer={**request,'stage':'transfer','inputs':inputs}
 result=D.coordinate(transfer,root/'transfer-intent.json')
 (root/'transfer-receipt.json').write_text(json.dumps(result,sort_keys=True)+'\n')
 # The root bridge must now bind the ACTUAL publication run/proof and generate
 # and install an approval through its reviewed canonical generator. There is
 # no such callable entry installed today; never reuse a pre-build approval.
 raise ValueError('POST_TRANSFER_ROOT_APPROVAL_BRIDGE_REQUIRED')
def validate(bundle,control):
 need=D.need;identity=B.identity(bundle['identity']);need(identity['controlRevision']==control,'MASTER_CONTROL')
 requests=bundle['requests'];need([r['stage']for r in requests]==['build','transfer','production'],'STAGE_ORDER')
 for r in requests:need(r['controlRevision']==control and r['releaseId']==identity['releaseId'] and r['requestedAt']==bundle['requestedAt'] and r['deadlineAt']==bundle['deadlineAt'],'SHARED_IDENTITY_WINDOW')
 build=json.loads(requests[0]['inputs']['candidate_plan']);need(build['sourceRevision']==identity['sourceRevision']and build['controlRevision']==control,'BUILD_IDENTITY')
 transfer=json.loads(requests[1]['inputs']['transfer_plan']);need(transfer['kind']=='hk-original-artifact-transfer-v3'and transfer['sourceRevision']==identity['sourceRevision']and transfer['producerControl']==control,'TRANSFER_IDENTITY')
 need(hashlib.sha256(requests[1]['inputs']['transfer_plan'].encode()).hexdigest()==requests[1]['inputs']['plan_sha256'],'TRANSFER_HASH')
 approval=bundle.get('installedApproval');need(isinstance(approval,dict),'ROOT_APPROVAL_BRIDGE_REQUIRED')
 raw=approval['rawJson'].encode();a=json.loads(raw);need(hashlib.sha256(raw).hexdigest()==requests[2]['inputs']['release_sha256'],'APPROVAL_HASH')
 need(a['kind']=='cn-fixed-release-approval-v1'and a['identity']['sourceRevision']==identity['sourceRevision']and a['identity']['controlRevision']==control,'APPROVAL_IDENTITY')
 need(a['identity']['requestedAt']==bundle['requestedAt']and a['identity']['deadlineAt']==bundle['deadlineAt'],'APPROVAL_WINDOW')
 need(requests[2]['inputs']['mode']=='run'and requests[2]['inputs']['lane']=='release','APPROVED_DRIVER_ONLY')
 return requests,transfer

def main():
 p=argparse.ArgumentParser();p.add_argument('--request-env',required=True);p.add_argument('--state-directory',required=True);p.add_argument('--control',required=True);args=p.parse_args();root=Path(args.state_directory);root.mkdir(mode=0o700)
 try:
  raw=os.environ[args.request_env];D.need(len(raw.encode())<=65536,'INPUT_LIMIT');bundle=json.loads(raw)
  if bundle.get('kind')=='cn-mvp-cold-request-v1':cold_prepare(bundle,args.control,root)
  requests,transfer=validate(bundle,args.control)
  receipts=[]
  for request in requests:
   if request['stage']=='transfer':D.need(transfer['sourceRun']==receipts[0]['runId'],'BUILD_TRANSFER_RUN_BINDING')
   result=D.coordinate(request,root/(request['stage']+'-intent.json'))
   (root/(request['stage']+'-receipt.json')).write_text(json.dumps(result,sort_keys=True)+'\n');receipts.append(result)
  # Workflow green is not production/content acceptance. Actual immutable driver
  # and content/readback receipts must be collected by the root bridge.
  raise ValueError('FINAL_ACCEPTANCE_RECEIPT_BRIDGE_REQUIRED')
 except (ValueError,KeyError,TypeError,OSError)as error:
  code=str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z][A-Z0-9_]{0,100}',str(error)) else 'INPUT_OR_EXECUTION_FAILED'
  result=dict(status='BLOCKED_OR_UNKNOWN',reason=code,modelQuality='SKIPPED',futureV2Content='NOT_APPLICABLE',fullBusinessAcceptance=False)
  (root/'terminal.json').write_text(json.dumps(result,sort_keys=True)+'\n');print(json.dumps(result));return 2
if __name__=='__main__':raise SystemExit(main())
