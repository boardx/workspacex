#!/usr/bin/env python3
"""GitHub Linux only: original seven ZIP acquisition and canonical fresh proof.
No OCI build, cloud credentials, OSS calls, or production authority.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

FILES={'revalidate-cn-image-candidates.py','cn_candidate_github.py','cn_candidate_revalidation.py','cn_image_candidate.py','cn_image_archive.py','hosted-release.py','canonical_control.py'}
NAMES={'api','web','agent','sandbox','postgres','plan','set'}

def need(v,c):
 if not v:raise ValueError(c)
def sha(b):return hashlib.sha256(b).hexdigest()
def encode(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def parse(raw):
 def pairs(xs):
  v={}
  for k,x in xs:need(k not in v,'DUPLICATE_KEY');v[k]=x
  return v
 return json.loads(raw,object_pairs_hook=pairs)
def stamp(v):
 t=dt.datetime.fromisoformat(v.replace('Z','+00:00'));need(t.tzinfo is not None,'TIMEZONE');return t
def validate(plan,now):
 need(set(plan)=={'kind','selection','artifacts','verifierRevision','verifierFiles','issuedAt','expiresAt','maxSeconds'},'PLAN_FIELDS')
 need(plan['kind']=='cn-proof-only-refresh-plan-v1','PLAN_KIND')
 s=plan['selection'];need(set(s)=={'repositoryId','runId','runAttempt','controlRevision','producerWorkflowSha256','candidatePlanRawSha256','candidateSetRawSha256','artifactIds'},'SELECTION')
 for k in ('repositoryId','runId','runAttempt'):need(type(s[k])is int and s[k]>0,'PROVIDER_ID')
 for k in ('producerWorkflowSha256','candidatePlanRawSha256','candidateSetRawSha256'):need(re.fullmatch('[a-f0-9]{64}',s[k]),'HASH')
 need(re.fullmatch('[a-f0-9]{40}',s['controlRevision']) and plan['verifierRevision']==s['controlRevision'],'CONTROL')
 need(set(s['artifactIds'])==NAMES and len(set(s['artifactIds'].values()))==7 and all(type(v)is int and v>0 for v in s['artifactIds'].values()),'ARTIFACT_IDS')
 need(set(plan['verifierFiles'])==FILES and all(re.fullmatch('[a-f0-9]{64}',x)for x in plan['verifierFiles'].values()),'CLOSURE')
 need(set(plan['artifacts'])==NAMES,'ARTIFACTS')
 for v in plan['artifacts'].values():need(set(v)=={'zipBytes','zipSha256'} and type(v['zipBytes'])is int and 0<v['zipBytes']<=5*1024**3 and re.fullmatch('[a-f0-9]{64}',v['zipSha256']),'ZIP_BOUND')
 need(sum(v['zipBytes']for v in plan['artifacts'].values())<=10*1024**3,'TOTAL_BYTES')
 start,end=stamp(plan['issuedAt']),stamp(plan['expiresAt']);need(start<=now<end and end-start<=dt.timedelta(hours=24),'REFRESH_AUTH_EXPIRED')
 need(type(plan['maxSeconds'])is int and 1<=plan['maxSeconds']<=1200,'BUDGET')
 return plan

def put(path,raw):
 with path.open('xb')as f:path.chmod(0o600);f.write(raw)
 return sha(raw)

def run(plan,control,output,execution_id):
 start=dt.datetime.now(dt.timezone.utc);validate(plan,start)
 need(sys.platform=='linux' and re.fullmatch('[a-z0-9-]{1,35}',execution_id),'LINUX_RUNNER_REQUIRED')
 need(subprocess.check_output(['git','-C',str(control),'rev-parse','HEAD'],text=True).strip()==plan['verifierRevision'],'CONTROL_HEAD')
 output.mkdir(mode=0o700);code=output/'code';code.mkdir(mode=0o700)
 for name,pin in plan['verifierFiles'].items():
  raw=(control/'scripts'/name).read_bytes();need(sha(raw)==pin,'VERIFIER_HASH');put(code/name,raw)
 gh=Path(shutil.which('gh')).resolve();ghraw=gh.read_bytes();binary=output/'gh';put(binary,ghraw);binary.chmod(0o700)
 acquisition='refresh-acquire-'+execution_id;verification='refresh-proof-'+execution_id
 request={'kind':'candidate-byte-acquisition-request-v1','schemaVersion':1,'acquisitionId':acquisition,'selection':plan['selection'],'artifacts':plan['artifacts'],'reusePaths':{},'verifierRevision':plan['verifierRevision'],'verifierFiles':plan['verifierFiles'],'ghExecutable':str(binary.resolve()),'ghSha256':sha(ghraw),'maxSeconds':plan['maxSeconds'],'workers':4,'networkAcquisitionAuthorized':True,'previousDownloadStopped':True}
 path=output/'acquisition-request.json';requestsha=put(path,encode(request));deadline=time.monotonic()+plan['maxSeconds']
 # No cloud credential env reaches the unchanged canonical verifier or gh.
 env={k:v for k,v in os.environ.items()if k in ('PATH','HOME','LANG','GH_TOKEN','GITHUB_TOKEN','TMPDIR')}
 def invoke(args):
  left=min(deadline-time.monotonic(),(stamp(plan['expiresAt'])-dt.datetime.now(dt.timezone.utc)).total_seconds());need(left>0,'REFRESH_DEADLINE')
  p=subprocess.run([sys.executable,'-I','-S','-B',str(code/'revalidate-cn-image-candidates.py'),*map(str,args)],capture_output=True,timeout=left,env=env)
  need(p.returncode==0 and len(p.stdout)<=16384,'CANONICAL_REVALIDATION_FAILED')
 invoke(['--acquire',path,requestsha,output]);manifest=output/acquisition/'acquisition-manifest.json'
 now=dt.datetime.now(dt.timezone.utc)
 policy={'kind':'candidate-revalidation-policy-v1','schemaVersion':1,'audience':'i-uf6ga92ewloganobbln6','purpose':'candidate-transfer-publication','verificationId':verification,**plan['selection'],'verifierRevision':plan['verifierRevision'],'verifierFiles':plan['verifierFiles'],'ghExecutable':str(binary.resolve()),'ghSha256':sha(ghraw),'issuedAt':now.isoformat(),'expiresAt':(now+dt.timedelta(hours=1)).isoformat()}
 policy_path=output/'policy.json';policysha=put(policy_path,encode(policy));invoke([policy_path,policysha,output,'--cached',manifest,sha(manifest.read_bytes())])
 proof=output/verification/'candidate-revalidation.json';raw=proof.read_bytes();need(len(raw)<=256*1024,'SMALL_PROOF_LIMIT')
 small=output/'small';small.mkdir(mode=0o700);put(small/'proof.json',raw);put(small/'policy.json',policy_path.read_bytes())
 receipt={'kind':'cn-proof-only-refresh-receipt-v1','selection':plan['selection'],'planRawSha256':sha(encode(plan)),'proofSha256':sha(raw),'policySha256':policysha,'expiresAt':parse(raw)['expiresAt'],'runnerExecution':execution_id,'originalArtifactsUnchanged':True,'cloudWrites':0,'imagesBuilt':False,'productionReady':False}
 need(len(encode(receipt))<=256*1024 and len(policy_path.read_bytes())<=256*1024,'SMALL_JSON_LIMIT')
 put(small/'receipt.json',encode(receipt));return receipt

def main():
 p=argparse.ArgumentParser();p.add_argument('--plan',type=Path,required=True);p.add_argument('--plan-sha256',required=True);p.add_argument('--control',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--execution-id',required=True);x=p.parse_args()
 raw=x.plan.read_bytes();need(len(raw)<=65536 and sha(raw)==x.plan_sha256,'PLAN_HASH');v=parse(raw);need(raw==encode(v),'CANONICAL_PLAN_BYTES');print(json.dumps(run(v,x.control,x.output,x.execution_id)))
if __name__=='__main__':
 try:main()
 except Exception:print('{"status":"PROOF_REFRESH_FAILED","retryAutomatic":false}',file=sys.stderr);sys.exit(1)
