"""Offline real canonical seven-ZIP revalidation with fake authenticated provider."""
import base64,datetime as dt,importlib.util,json,os,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
LOCAL=(HERE/'runner.py').exists()
REPO=HERE.parents[2]/'release-five-round-audit' if LOCAL else HERE.parent
s=importlib.util.spec_from_file_location('refresh',HERE/'runner.py' if LOCAL else REPO/'scripts/cn-proof-only-refresh.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
sys.path.insert(0,str(REPO/'tests'))
import test_cn_candidate_revalidation as f
class Refresh(unittest.TestCase):
 def test_real_canonical_acquire_cached_admit_existing_bundle(self):
  with tempfile.TemporaryDirectory(prefix='.refresh-fixture-',dir=HERE)as td:
   root=Path(td);code=root/'producer/scripts';code.mkdir(parents=True,mode=0o700);bins=root/'bin';bins.mkdir(mode=0o700)
   control='27bada5321e45fbdd5f0506fd06d08fa29ea24ce';plan=f.plan();plan['controlRevision']=control;pr=m.encode(plan)
   old=dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=2);images={k:f.archive(root/(k+'.tar'),plan,k)for k in f.a.REPOSITORIES};sr=m.encode(f.receipt(plan,images,old))
   files={'plan':{'cn-candidate-plan.json':pr},'set':{'candidate-plan.json':pr,'candidate-set.json':sr}}
   for k in images:files[k]={'candidate-plan.json':pr,'candidate-fragment.json':m.encode(f.receipt(plan,{k:images[k]},old)),k+'.tar':(root/(k+'.tar')).read_bytes()}
   selection={'repositoryId':123,'runId':123456,'runAttempt':1,'controlRevision':control,'producerWorkflowSha256':m.sha(b'reviewed workflow'),'candidatePlanRawSha256':m.sha(pr),'candidateSetRawSha256':m.sha(sr),'artifactIds':{k:i+1 for i,k in enumerate(files)}}
   provider=f.Provider(selection,files);catalog={'/repos/boardx/workspacex/actions/runs/123456/attempts/1':provider.run,'/repos/boardx/workspacex/contents/'+f.g.WORKFLOW+'?ref='+control:{'encoding':'base64','content':base64.b64encode(provider.content).decode()}}
   blobs={};artifacts={};pins={}
   for k,i in selection['artifactIds'].items():
    catalog['/repos/boardx/workspacex/actions/artifacts/'+str(i)]=provider.metadata[i];blobs['/repos/boardx/workspacex/actions/artifacts/'+str(i)+'/zip']=base64.b64encode(provider.blobs[i]).decode();artifacts[k]={'zipBytes':len(provider.blobs[i]),'zipSha256':m.sha(provider.blobs[i])}
   for k in m.FILES:
    raw=(REPO/'scripts'/k).read_bytes();(code/k).write_bytes(raw);pins[k]=m.sha(raw)
   (bins/'gh').write_text('#!'+sys.executable+'\nimport sys,json,base64\ncatalog='+repr(catalog)+'\nblobs='+repr(blobs)+'\nk=sys.argv[4]\nsys.stdout.buffer.write(base64.b64decode(blobs[k]) if k in blobs else json.dumps(catalog[k]).encode())\n');(bins/'gh').chmod(0o700)
   (bins/'git').write_text('#!'+sys.executable+'\nprint('+repr(control)+')\n');(bins/'git').chmod(0o700)
   now=dt.datetime.now(dt.timezone.utc);request={'kind':'cn-proof-only-refresh-plan-v1','selection':selection,'artifacts':artifacts,'verifierRevision':control,'verifierFiles':pins,'issuedAt':now.isoformat(),'expiresAt':(now+dt.timedelta(hours=1)).isoformat(),'maxSeconds':1200}
   with patch.object(m.sys,'platform','linux'),patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH']}):result=m.run(request,code.parent,root/'output','fixture-1')
   small=root/'output/small';self.assertEqual({p.name for p in small.iterdir()},{'proof.json','policy.json','receipt.json'})
   cap=f.rv.admit((small/'proof.json').read_bytes(),result['proofSha256'],result['policySha256'],(small/'policy.json').read_bytes())
   bundle=root/'output/refresh-proof-fixture-1/bundle';cap.verify_bundle(bundle,plan,sr,m.sha(sr),m.sha(pr))
   # Same existing bundle, fresh metadata only; tampering even one tar is rejected.
   (bundle/'api.tar').write_bytes(b'changed')
   with self.assertRaises(Exception):cap.verify_bundle(bundle,plan,sr,m.sha(sr),m.sha(pr))
   self.assertFalse(result['productionReady']);self.assertEqual(result['cloudWrites'],0)
 def test_invalid_or_expired_plan_rejected_before_acquire(self):
  now=dt.datetime.now(dt.timezone.utc)
  p={'kind':'cn-proof-only-refresh-plan-v1','selection':{'repositoryId':1,'runId':2,'runAttempt':1,'controlRevision':'a'*40,'producerWorkflowSha256':'b'*64,'candidatePlanRawSha256':'c'*64,'candidateSetRawSha256':'d'*64,'artifactIds':{k:i+1 for i,k in enumerate(sorted(m.NAMES))}},'artifacts':{k:{'zipBytes':1,'zipSha256':'e'*64}for k in m.NAMES},'verifierRevision':'a'*40,'verifierFiles':{k:'f'*64 for k in m.FILES},'issuedAt':now.isoformat(),'expiresAt':(now+dt.timedelta(hours=1)).isoformat(),'maxSeconds':1200}
  m.validate(p,now)
  for change in ({'expiresAt':(now-dt.timedelta(seconds=1)).isoformat()},{'verifierRevision':'b'*40},{'maxSeconds':True},{'artifacts':{}}):
   with self.assertRaises(ValueError):m.validate({**p,**change},now)
 def test_workflow_has_no_oidc_or_oss_or_build(self):
  text=(HERE/'workflow.yml' if LOCAL else REPO/'.github/workflows/refresh-cn-candidate-proof.yml').read_text();self.assertNotIn('id-token:',text);self.assertNotIn('configure-aliyun',text);self.assertNotIn('docker ',text);self.assertEqual(text.count('/small/'),3)
if __name__=='__main__':unittest.main()
