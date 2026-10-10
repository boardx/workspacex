"""Full real ZIP/tar revalidation against isolated authenticated-provider stand-in."""
import base64
import copy
from datetime import datetime,timedelta,timezone
import io
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cn_image_archive as a
import cn_image_candidate as c
import cn_candidate_github as g
import cn_candidate_revalidation as rv
import cn_candidate_publication as pub
import cn_candidate_oss as oss
from test_cn_image_candidate import plan,archive,receipt
from test_cn_candidate_publication import Port as PublicationPort
from test_cn_archive_oss_independent import Port as OssPort


def zipped(files):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        for name,data in files.items():z.writestr(name,data)
    return out.getvalue()


class Provider:
    def __init__(self,p,files):
        self.policy=p;self.calls=[];self.content=b'reviewed workflow';self.blobs={};self.metadata={}
        self.run=dict(id=p['runId'],run_attempt=p['runAttempt'],head_sha=p['controlRevision'],head_branch='main',
                      path=g.WORKFLOW,event='workflow_dispatch',status='completed',conclusion='success',
                      repository=dict(id=p['repositoryId'],full_name=g.REPO))
        for service,entries in files.items():
            ident=p['artifactIds'][service];raw=zipped(entries);self.blobs[ident]=raw
            self.metadata[ident]=dict(id=ident,name=g.artifact_name(service,p),expired=False,digest='sha256:'+a.sha(raw),size_in_bytes=len(raw),
                workflow_run=dict(id=p['runId'],repository_id=p['repositoryId'],head_repository_id=p['repositoryId'],head_sha=p['controlRevision']))
    def json(self,path):
        self.calls.append(path)
        if '/attempts/' in path:return copy.deepcopy(self.run)
        if '/contents/' in path:return dict(encoding='base64',content=base64.b64encode(self.content).decode())
        return copy.deepcopy(self.metadata[int(path.rsplit('/',1)[1])])
    def fetch(self,path,target,maximum):
        self.calls.append(path);raw=self.blobs[int(path.split('/')[-2])]
        a.require(len(raw)<=maximum,'TEST_PROVIDER_LIMIT');target.write(raw);return len(raw)


class RevalidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.plan=plan();self.plan_raw=a.json_bytes(self.plan)
        images={s:archive(self.root/(s+'.tar'),self.plan,s) for s in a.REPOSITORIES}
        old=datetime.now(timezone.utc)-timedelta(hours=2)
        self.receipt=receipt(self.plan,images,old);self.raw=a.json_bytes(self.receipt)
        self.files={'plan':{'cn-candidate-plan.json':self.plan_raw},'set':{'candidate-plan.json':self.plan_raw,'candidate-set.json':self.raw}}
        for s in a.REPOSITORIES:
            self.files[s]={'candidate-plan.json':self.plan_raw,'candidate-fragment.json':a.json_bytes(receipt(self.plan,{s:images[s]},old)),s+'.tar':(self.root/(s+'.tar')).read_bytes()}
        now=datetime.now(timezone.utc)
        self.policy=dict(kind='candidate-revalidation-policy-v1',schemaVersion=1,audience='i-uf6ga92ewloganobbln6',purpose='candidate-transfer-publication',verificationId='verify-test',
            repositoryId=123,runId=456,runAttempt=1,controlRevision=self.plan['controlRevision'],producerWorkflowSha256=a.sha(b'reviewed workflow'),
            candidatePlanRawSha256=a.sha(self.plan_raw),candidateSetRawSha256=a.sha(self.raw),artifactIds={s:i+1 for i,s in enumerate(self.files)},
            verifierRevision='d'*40,verifierFiles={n:'e'*64 for n in rv.FILES},ghExecutable='/fixture/gh',ghSha256='f'*64,
            issuedAt=now.isoformat(),expiresAt=(now+timedelta(minutes=30)).isoformat())
        self.provider=Provider(self.policy,self.files)
    def produce(self):
        self.work=self.root/'work';self.work.mkdir(mode=0o700)
        self.policy_raw=a.json_bytes(self.policy)
        return g.produce(self.policy,a.sha(self.policy_raw),self.provider,self.work,self.policy_raw)
    def admitted(self):
        raw=self.produce();return rv.admit(raw,a.sha(raw),a.sha(self.policy_raw),self.policy_raw)
    def test_expired_default_still_rejects_full_revalidation_preserves_all_bytes(self):
        with self.assertRaises(a.Rejected):c.validate_receipt(self.raw,self.plan,a.sha(self.raw))
        cap=self.admitted();cap.verify_bundle(self.work/'bundle',self.plan,self.raw,a.sha(self.raw),a.sha(self.plan_raw))
        self.assertEqual((self.work/'bundle/candidate-set.json').read_bytes(),self.raw)
        self.assertEqual(cap._value['originalExpiresAt'],self.receipt['expiresAt']);self.assertFalse(cap._value['productionReady'])
        self.assertEqual(len([p for p in self.provider.calls if p.endswith('/zip')]),7)
    def test_wrong_repo_run_attempt_control_workflow_status(self):
        for key,value in [('run_attempt',2),('head_sha','a'*40),('path','other.yml'),('conclusion','failure'),('repository',dict(id=99,full_name=g.REPO))]:
            original=copy.deepcopy(self.provider.run);self.provider.run[key]=value
            work=self.root/str(len(self.provider.calls));work.mkdir()
            with self.assertRaises(a.Rejected):g.produce(self.policy,a.sha(a.json_bytes(self.policy)),self.provider,work,a.json_bytes(self.policy))
            self.provider.run=original
    def test_artifact_same_name_foreign_id_or_run_expired(self):
        ident=self.policy['artifactIds']['plan'];self.provider.metadata[ident]['workflow_run']['id']=999
        with self.assertRaises(a.Rejected):self.produce()
    def test_provider_zip_digest_mismatch(self):
        ident=self.policy['artifactIds']['api'];self.provider.blobs[ident]+=b'tamper'
        with self.assertRaises(a.Rejected):self.produce()
    def test_provider_hash_valid_but_tar_changed(self):
        self.files['web']['web.tar']+=b'tamper';self.provider=Provider(self.policy,self.files)
        with self.assertRaises(a.Rejected):self.produce()
    def test_fragment_plan_mismatch(self):
        self.files['agent']['candidate-plan.json']=b' '+self.plan_raw;self.provider=Provider(self.policy,self.files)
        with self.assertRaises(a.Rejected):self.produce()
    def test_fragment_timestamp_cannot_refresh_old_set(self):
        value=a.decode(self.files['api']['candidate-fragment.json']);value['expiresAt']=datetime.now(timezone.utc).isoformat()
        self.files['api']['candidate-fragment.json']=a.json_bytes(value);self.provider=Provider(self.policy,self.files)
        with self.assertRaises(a.Rejected):self.produce()
    def test_zip_traversal_duplicate_symlink_no_extraction(self):
        path=self.root/'bad.zip';directory=self.root/'out';directory.mkdir()
        path.write_bytes(zipped({'../escape':b'x'}))
        with self.assertRaises(a.Rejected):g.extract(path,directory,{'allowed':20})
        self.assertEqual(list(directory.iterdir()),[])
    def test_proof_cannot_change_verifier_or_policy_scope(self):
        raw=self.produce();value=a.decode(raw);value['verifierRevision']='9'*40;changed=a.json_bytes(value)
        with self.assertRaises(a.Rejected):rv.admit(changed,a.sha(changed),a.sha(self.policy_raw),self.policy_raw)
        with self.assertRaises(a.Rejected):rv.admit(raw,a.sha(raw),'0'*64,self.policy_raw)
    def test_new_proof_expiry_and_postverify_tar_tamper(self):
        cap=self.admitted()
        with (self.work/'bundle/api.tar').open('ab') as f:f.write(b'x')
        with self.assertRaises(a.Rejected):cap.verify_bundle(self.work/'bundle',self.plan,self.raw,a.sha(self.raw),a.sha(self.plan_raw))
        cap._value['expiresAt']='2000-01-01T00:00:00Z'
        with self.assertRaises(a.Rejected):cap.check(self.plan,self.raw,a.sha(self.raw),a.sha(self.plan_raw))
    def test_explicit_publication_redis_and_dynamic_gate_preserved(self):
        cap=self.admitted();port=PublicationPort(self.plan,self.receipt['images'])
        intent=dict(kind='cn-candidate-publication-intent-v2',schemaVersion=2,candidatePlanRawSha256=a.sha(self.plan_raw),candidateSetRawSha256=a.sha(self.raw),candidateIdentity=c.identity(self.plan),
            **{k:self.plan[k] for k in ('sourceRevision','controlRevision','attemptId')},release='2026.10.10',registryPrefix=a.PREFIX,redisImage=a.PREFIX+'/base-redis@sha256:'+'6'*64,revalidationRawSha256=cap.sha)
        raw=a.json_bytes(intent)
        port.fail_redis=True
        with self.assertRaises(a.Rejected):pub.publish(self.plan_raw,a.sha(self.plan_raw),self.raw,a.sha(self.raw),raw,a.sha(raw),self.work/'bundle',port,revalidation=cap)
        self.assertFalse(any(e.startswith('load:') for e in port.events))
        port.fail_redis=False;result=pub.publish(self.plan_raw,a.sha(self.plan_raw),self.raw,a.sha(self.raw),raw,a.sha(raw),self.work/'bundle',port,revalidation=cap)
        self.assertEqual(result['binding']['revalidationRawSha256'],cap.sha);self.assertEqual(result['binding']['candidateExpiresAt'],self.receipt['expiresAt'])
    def test_oss_explicit_branch_dynamic_authorization_remains(self):
        cap=self.admitted();bundle=self.work/'bundle';prefix='cn-image-candidates/'+self.plan['sourceRevision']+'/'+self.plan['attemptId']+'/'
        tr=dict(kind='approved-candidate-oss-staging-v2',bucket='fixture-bucket',region='cn-shanghai',endpoint='https://oss-cn-shanghai.aliyuncs.com',prefix=prefix,uploadPrincipal='u',downloadPrincipal='d',objects={p.name:dict(key=prefix+p.name,versionId='',sha256=a.sha(p.read_bytes())) for p in bundle.iterdir()})
        now=datetime.now(timezone.utc)
        approval=dict(schemaVersion=2,transferAuthorized=True,candidatePlanRawSha256=a.sha(self.plan_raw),candidateSetRawSha256=a.sha(self.raw),candidateIdentity=c.identity(self.plan),**{k:self.plan[k] for k in ('sourceRevision','controlRevision','attemptId')},transportSha256=a.sha(a.json_bytes(tr)),operation='upload',observedAt=now.isoformat(),expiresAt=(now+timedelta(minutes=20)).isoformat(),versioningFenceProofSha256='f'*64,revalidationRawSha256=cap.sha)
        port=OssPort();transfer=oss.CandidateTransfer(port,self.plan_raw,a.sha(self.plan_raw),self.raw,a.sha(self.raw),tr,approval,revalidation=cap)
        result=transfer.upload(bundle);self.assertEqual(result['revalidationRawSha256'],cap.sha)
        approval['expiresAt']='2000-01-01T00:00:00Z'
        with self.assertRaises(a.Rejected):oss.CandidateTransfer(port,self.plan_raw,a.sha(self.plan_raw),self.raw,a.sha(self.raw),tr,approval,revalidation=cap)

    def test_isolated_bootstrap_real_process_and_atomic_protected_output(self):
        import json
        import os
        import subprocess
        repo=Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='.revalidation-test-',dir=repo) as td:
            parent=Path(td);catalog={}
            for path,value in [('/repos/'+g.REPO+'/actions/runs/456/attempts/1',self.provider.run),
                ('/repos/'+g.REPO+'/contents/'+g.WORKFLOW+'?ref='+self.policy['controlRevision'],dict(encoding='base64',content=base64.b64encode(self.provider.content).decode()))]:
                catalog[path]=base64.b64encode(a.json_bytes(value)).decode()
            for ident,value in self.provider.metadata.items():
                catalog['/repos/'+g.REPO+'/actions/artifacts/'+str(ident)]=base64.b64encode(a.json_bytes(value)).decode()
                catalog['/repos/'+g.REPO+'/actions/artifacts/'+str(ident)+'/zip']=base64.b64encode(self.provider.blobs[ident]).decode()
            fixture=parent/'catalog.json';fixture.write_text(json.dumps(catalog));fixture.chmod(0o600)
            binary=parent/'fixture-gh'
            binary.write_text('#!'+sys.executable+'\nimport sys,json,base64\ndata=json.load(open('+repr(str(fixture))+'))\nsys.stdout.buffer.write(base64.b64decode(data[sys.argv[-1]]))\n');binary.chmod(0o700)
            self.policy['ghExecutable']=str(binary);self.policy['ghSha256']=a.sha(binary.read_bytes())
            self.policy['verifierFiles']={n:a.sha((repo/'scripts'/n).read_bytes()) for n in rv.FILES}
            policy_raw=a.json_bytes(self.policy);policy=parent/'policy.json';policy.write_bytes(policy_raw);policy.chmod(0o600)
            argv=[sys.executable,'-I','-S','-B',str(repo/'scripts/revalidate-cn-image-candidates.py'),str(policy),a.sha(policy_raw),str(parent)]
            result=subprocess.run(argv,capture_output=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stderr.decode())
            final=parent/'verify-test';proof=(final/'candidate-revalidation.json').read_bytes()
            cap=rv.admit(proof,a.sha(proof),a.sha(policy_raw),policy_raw)
            cap.verify_bundle(final/'bundle',self.plan,self.raw,a.sha(self.raw),a.sha(self.plan_raw))
            self.assertEqual((final/'candidate-revalidation.json').stat().st_mode & 0o777,0o600)
            rerun=subprocess.run(argv,capture_output=True,timeout=30)
            self.assertNotEqual(rerun.returncode,0)
            self.assertEqual((final/'candidate-revalidation.json').read_bytes(),proof)

if __name__=='__main__':unittest.main()
