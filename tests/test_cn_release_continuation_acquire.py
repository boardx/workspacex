"""Synthetic original seven ZIPs through actual canonical validation and binder."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
import test_cn_candidate_revalidation as f
spec=importlib.util.spec_from_file_location('acquire',ROOT/'scripts/cn-release-continuation-acquire.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class AcquireTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.repo_tmp=tempfile.TemporaryDirectory();cls.repo=Path(cls.repo_tmp.name);(cls.repo/'scripts').mkdir()
  for p in (ROOT/'scripts').glob('*.py'):shutil.copyfile(p,cls.repo/'scripts'/p.name)
  directory=cls.repo/'.harness/scripts/vm';directory.mkdir(parents=True)
  for name in ('import-cn-image-archives.py','import-cn-image-candidates.py'):shutil.copyfile(ROOT/'.harness/scripts/vm'/name,directory/name)
  for args in (['init','-q'],['add','scripts','.harness'],['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','synthetic control']):
   subprocess.run(['git','-C',str(cls.repo),*args],check=True,capture_output=True)
  cls.control=subprocess.check_output(['git','-C',str(cls.repo),'rev-parse','HEAD']).decode().strip()
 @classmethod
 def tearDownClass(cls):cls.repo_tmp.cleanup()
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  plan=f.plan();plan.update(sourceRevision=f.c.SOURCE,controlRevision=self.control,attemptId='cn-generic-second-release')
  pr=m.encode(plan);images={s:f.archive(self.root/(s+'.tar'),plan,s) for s in f.a.REPOSITORIES};old=dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=2)
  sr=m.encode(f.receipt(plan,images,old));files={'plan':{'cn-candidate-plan.json':pr},'set':{'candidate-plan.json':pr,'candidate-set.json':sr}}
  for n in images:files[n]={'candidate-plan.json':pr,'candidate-fragment.json':m.encode(f.receipt(plan,{n:images[n]},old)),n+'.tar':(self.root/(n+'.tar')).read_bytes()}
  now=dt.datetime.now(dt.timezone.utc);self.now=now
  policy=dict(kind='candidate-revalidation-policy-v1',schemaVersion=1,audience='i-uf6ga92ewloganobbln6',purpose='candidate-transfer-publication',verificationId='verify-second',repositoryId=123,runId=987654,runAttempt=2,controlRevision=self.control,producerWorkflowSha256=m.sha(b'reviewed workflow'),candidatePlanRawSha256=m.sha(pr),candidateSetRawSha256=m.sha(sr),artifactIds={n:i+10 for i,n in enumerate(files)},verifierRevision=self.control,verifierFiles={n:m.sha((self.repo/'scripts'/n).read_bytes()) for n in f.rv.FILES},ghExecutable='/fixture/gh',ghSha256='f'*64,issuedAt=now.isoformat(),expiresAt=(now+dt.timedelta(minutes=30)).isoformat())
  self.provider=f.Provider(policy,files);work=self.root/'work';work.mkdir();pol=m.encode(policy);proof=f.g.produce(policy,m.sha(pol),self.provider,work,pol)
  self.inputs=dict(plan=pr,set=sr,proof=proof,policy=pol)
  required={'execute-cn-candidate-download.py','cn_candidate_sdk_runtime.py','cn_candidate_download_supervisor.py','cn_candidate_authenticated_oss.py','cn_candidate_revalidation.py','cn_image_candidate.py','cn_image_archive.py','cn_candidate_oss.py','cn_archive_oss.py','canonical_control.py','hosted-release.py'}
  self.r=dict(schemaVersion=1,phase='consume',sourceRevision=plan['sourceRevision'],controlRevision=self.control,attemptId=plan['attemptId'],repositoryId=123,runId=987654,runAttempt=2,producerWorkflowSha256=policy['producerWorkflowSha256'],requestedAt=now.isoformat(),deadlineAt=(now+dt.timedelta(minutes=25)).isoformat(),inputs={n:m.sha(raw) for n,raw in self.inputs.items()},release='2026.10.12',launcher={'sdkSha256':'a'*64,'code':{n:m.sha((self.repo/'scripts'/n).read_bytes()) for n in required}})
 def bind(self):
  raw=m.encode(self.r);approval=m.encode(dict(kind='cn-continuation-acquire-approval-v1',requestSha256=m.sha(raw),issuedAt=self.r['requestedAt'],expiresAt=self.r['deadlineAt'],templateFiles={n:m.sha((m.TEMPLATES/n).read_bytes()) for n in m.NAMES}))
  return m.materialize(raw,approval,self.inputs,self.repo,self.root/'out')
 def test_other_source_control_run_attempt_real_seven_zip_consumer(self):
  result=self.bind();config=json.loads((self.root/'out/consumer-request.json').read_bytes())
  self.assertEqual(config['prefix'],'runs/987654/2/');self.assertEqual(config['sourceRevision'],f.c.SOURCE)
  self.assertFalse(result['proofGenerated']);self.assertEqual(result['deadlineAt'],self.r['deadlineAt'])
  # Execute actual consumer extraction/revalidation on synthetic ZIPs only.
  root=self.root/'consumer';cache=root/'original';cache.mkdir(parents=True)
  for name,x in config['objects'].items():
   raw=self.inputs[name] if name in ('proof','policy') else self.provider.blobs[x['artifactId']]
   (cache/(name+('.json' if name in ('proof','policy') else '.zip'))).write_bytes(raw)
  ns={'__name__':'fixture','CONFIG':config};exec(compile((m.TEMPLATES/'consumer.py').read_bytes(),'consumer','exec'),ns)
  receipt=ns['verify_downloaded'](config,root,lambda:None)
  self.assertEqual(set(receipt['images']),{'api','web','agent','sandbox','postgres'})
  self.assertFalse(receipt['publicationExecuted'])
 def test_tampered_small_ref(self):
  self.inputs['proof']+=b' '
  with self.assertRaisesRegex(ValueError,'INPUT_HASH'):self.bind()
 def test_wrong_github_attempt(self):
  self.r['runAttempt']=3
  with self.assertRaisesRegex(ValueError,'CANONICAL_REVALIDATION'):self.bind()
 def test_wrong_source(self):
  self.r['sourceRevision']='c'*40
  with self.assertRaisesRegex(ValueError,'CANONICAL_REVALIDATION'):self.bind()
 def test_more_than_thirty_minutes(self):
  self.r['deadlineAt']=(self.now+dt.timedelta(minutes=31)).isoformat()
  with self.assertRaisesRegex(ValueError,'END_TO_END_DEADLINE'):self.bind()
 def test_unpinned_launcher(self):
  self.r['launcher']['code']['execute-cn-candidate-download.py']='e'*64
  with self.assertRaisesRegex(ValueError,'LAUNCHER_CONTROL_HASH'):self.bind()
 def test_no_approval_cli_override(self):
  p=subprocess.run([sys.executable,str(ROOT/'scripts/cn-release-continuation-acquire.py'),'--help'],capture_output=True,text=True)
  self.assertEqual(p.returncode,0);self.assertNotIn('--approval',p.stdout)
 def test_publication_generates_real_canonical_stage_check_publish(self):
  import test_cn_candidate_host as hf
  host=hf.h
  self.r['phase']='publication';now=self.now.isoformat()
  evidence=self.root/'binary-evidence.json';evidence.write_bytes(b'{"synthetic":true}')
  provider=dict(schemaVersion=1,observedAt=now,accountId='1177216024653153',region='cn-shanghai',instanceId=f.a.INSTANCE,repositories={n:dict(IsSuccess=True,Code='success',InstanceId=f.a.INSTANCE,RepoNamespaceName='workspacex-prod',RepoName=n,RepoStatus='NORMAL',RepoType='PRIVATE',TagImmutability=True,RepoId='crr-test') for n in f.a.REPOSITORIES.values()})
  values=dict(tools={'allNineHashesMatch':True,'files':{n:'5'*64 for n in host.CLOSURE|{'cn_candidate_revalidation.py'}}},canonical=dict(sourceRevision=self.r['sourceRevision'],attemptId=self.r['attemptId'],installed={'node':{},'canonical-source':{},'canonical-control.json':{}},canonicalConfigurationSha256='6'*64),provider=provider,redis=dict(IsSuccess=True,Code='success',Images=[dict(Tag='redis-7-alpine',Status='NORMAL',Digest='7'*64)]),binaries=dict(kind='cn-reviewed-publication-binaries-v1',observedAt=now,binaries=hf.approval()['binaries'],evidenceRefs=[{'path':str(evidence),'sha256':m.sha(evidence.read_bytes())}]))
  self.inputs.update({n:m.encode(v) for n,v in values.items()});self.r['inputs']={n:m.sha(raw) for n,raw in self.inputs.items()}
  result=self.bind();out=self.root/'out';approval=json.loads((out/'approval.json').read_bytes())
  self.assertEqual(approval['sourceRevision'],self.r['sourceRevision']);self.assertEqual(approval['expiresAt'],self.r['deadlineAt'])
  self.assertEqual((out/'candidate-revalidation.json').read_bytes(),self.inputs['proof'])
  for phase in ('stage','check-plan','publish'):
   params=json.loads((out/(phase+'-parameters.json')).read_bytes());self.assertEqual(params['InstanceId.1'],'i-uf6ga92ewloganobbln6');self.assertEqual(params['RepeatMode'],'Once')
  self.assertEqual(result['cloudCalls'],0);compile((out/'stage.py').read_bytes(),'stage','exec')
 def test_missing_publication_evidence_is_not_ready(self):
  self.r['phase']='publication'
  with self.assertRaisesRegex(ValueError,'INPUT_CLOSURE'):self.bind()

if __name__=='__main__':unittest.main()
