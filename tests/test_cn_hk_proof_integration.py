"""Offline synthetic ZIP/tar + fake authenticated metadata CLI; real bootstrap twice."""
from pathlib import Path
import tempfile,sys,os,subprocess,json,hashlib,base64
HERE=Path(__file__).resolve().parent
LOCAL=(HERE/'generate-proof.py').exists()
REPO=HERE.parents[2]/'home-cn-default-language' if LOCAL else HERE.parent
WRAPPER=HERE/'generate-proof.py' if LOCAL else REPO/'scripts/cn-hk-generate-proof.py'
sys.path.insert(0,str(REPO/'tests'))
import test_cn_candidate_revalidation as f
from datetime import datetime,timedelta,timezone
enc=lambda v:(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
sha=lambda b:hashlib.sha256(b).hexdigest()
CONTROL='9bb9c401497877c09f7a432a87bc6291de83bbe5'
RUN=38386036159
with tempfile.TemporaryDirectory(prefix='.hk-proof-test-',dir=REPO)as td:
 root=Path(td);bundle=root/'bundle';bundle.mkdir(mode=0o700);code=root/'producer-control/scripts';code.mkdir(parents=True,mode=0o700);bins=root/'bin';bins.mkdir(mode=0o700)
 plan=f.plan();plan.update(sourceRevision='f0eb9d07398a66fdd5646a9e6b855fa1b940e571',controlRevision=CONTROL,attemptId='cn-five-f0eb9d07-20261011-134820-14f9fd');pr=enc(plan)
 images={s:f.archive(root/(s+'.tar'),plan,s,{'org.opencontainers.image.revision':plan['sourceRevision'],f.c.LABEL:f.c.identity(plan)})for s in f.a.REPOSITORIES}
 old=datetime.now(timezone.utc)-timedelta(hours=2);sr=enc(f.receipt(plan,images,old));files={'plan':{'cn-candidate-plan.json':pr},'set':{'candidate-plan.json':pr,'candidate-set.json':sr}}
 for name in images:files[name]={'candidate-plan.json':pr,'candidate-fragment.json':enc(f.receipt(plan,{name:images[name]},old)),name+'.tar':(root/(name+'.tar')).read_bytes()}
 policy=dict(controlRevision=CONTROL,verifierRevision=CONTROL,repositoryId=1000328649,runId=RUN,runAttempt=1,producerWorkflowSha256=sha(b'reviewed workflow'),candidatePlanRawSha256=sha(pr),candidateSetRawSha256=sha(sr),artifactIds={k:i+1 for i,k in enumerate(files)},verifierFiles={},kind='candidate-revalidation-policy-v1',schemaVersion=1,audience=None,purpose=None,verificationId=None,issuedAt=None,expiresAt=None)
 for name in f.rv.FILES:
  raw=(REPO/'scripts'/name).read_bytes();(code/name).write_bytes(raw);policy['verifierFiles'][name]=sha(raw)
 provider=f.Provider(policy,files);catalog={'/repos/boardx/workspacex/actions/runs/'+str(RUN)+'/attempts/1':provider.run,'/repos/boardx/workspacex/contents/'+f.g.WORKFLOW+'?ref='+CONTROL:{'encoding':'base64','content':base64.b64encode(provider.content).decode()}}
 artifacts={}
 for name,ident in policy['artifactIds'].items():
  raw=provider.blobs[ident];path=bundle/(name+'.zip');path.write_bytes(raw);path.chmod(0o600);artifacts[name]={'id':ident,'bytes':len(raw),'sha256':sha(raw)};catalog['/repos/boardx/workspacex/actions/artifacts/'+str(ident)]=provider.metadata[ident]
 upload=dict(kind='hk-original-artifact-transfer-v2',artifacts=artifacts,sourceRun=RUN,producerControl=CONTROL,sourceRevision=plan['sourceRevision'],producerWorkflowSha256=policy['producerWorkflowSha256'],candidatePlanRawSha256=sha(pr),revalidationTemplateSha256=sha(enc(policy)),expiresAt=(datetime.now(timezone.utc)+timedelta(minutes=30)).isoformat());upload_raw=enc(upload)
 (bundle/'upload-plan.json').write_bytes(upload_raw);(bundle/'upload-plan.json').chmod(0o600);template=root/'template.json';template.write_bytes(enc(policy))
 fakegh=bins/'gh';fakegh.write_text('#!'+sys.executable+'\nimport json,sys\ncatalog='+repr(catalog)+'\nassert sys.argv[1:4]==["api","--hostname","github.com"]\nprint(json.dumps(catalog[sys.argv[4]]))\n');fakegh.chmod(0o700)
 fakegit=bins/'git';fakegit.write_text('#!'+sys.executable+'\nimport sys\nassert sys.argv[-2:]==["rev-parse","HEAD"]\nprint("'+CONTROL+'")\n');fakegit.chmod(0o700)
 result=subprocess.run([sys.executable,'-I','-B',str(WRAPPER),'--bundle',str(bundle),'--upload-plan-sha256',sha(upload_raw),'--control',str(code.parent),'--template',str(template),'--output',str(root/'proof-output')],env=dict(os.environ,PATH=str(bins)+':'+os.environ['PATH']),capture_output=True)
 if result.returncode:raise AssertionError(result.stderr.decode()+result.stdout.decode())
 output=json.loads(result.stdout);proof=Path(output['proofPath']).read_bytes();policyraw=Path(output['policyPath']).read_bytes();cap=f.rv.admit(proof,output['proofSha256'],output['policySha256'],policyraw)
 cap.verify_bundle(root/'proof-output/hk-cloud-proof/bundle',plan,sr,sha(sr),sha(pr))
 assert datetime.fromisoformat(json.loads(proof)['expiresAt'])<=datetime.fromisoformat(upload['expiresAt'])
 assert json.loads(proof)['github']['runId']==RUN and json.loads(proof)['controlRevision']==CONTROL
 assert all(Path(p).is_file()for p in output['artifactZipPaths'].values())
 assert not any((bundle/(name+'.zip')).exists()for name in artifacts)
 assert (root/'proof-output/hk-cloud-proof/bundle/candidate-plan.json').read_bytes()==pr
 assert (root/'proof-output/hk-cloud-proof/bundle/candidate-set.json').read_bytes()==sr
 print('PASS real --acquire reuse + --cached verifier with synthetic 7ZIP/fake metadata; proof admission + all tar verification; original bytes unchanged; no cloud')
