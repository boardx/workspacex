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
 def publication_inputs(self):
  import test_cn_candidate_host as hf
  host=hf.h
  self.r['phase']='publication';now=self.now.isoformat()
  self.r['publicationCapability']={'issuedAt':now,'expiresAt':self.r['deadlineAt']}
  evidence=self.root/'binary-evidence.json';evidence.write_bytes(b'{"synthetic":true}')
  provider=dict(schemaVersion=1,observedAt=now,accountId='1177216024653153',region='cn-shanghai',instanceId=f.a.INSTANCE,repositories={n:dict(IsSuccess=True,Code='success',InstanceId=f.a.INSTANCE,RepoNamespaceName='workspacex-prod',RepoName=n,RepoStatus='NORMAL',RepoType='PRIVATE',TagImmutability=True,RepoId='crr-test') for n in f.a.REPOSITORIES.values()})
  values=dict(tools={'allNineHashesMatch':True,'files':{n:'5'*64 for n in host.CLOSURE|{'cn_candidate_revalidation.py'}}},canonical=dict(sourceRevision=self.r['sourceRevision'],attemptId=self.r['attemptId'],installed={'node':{},'canonical-source':{},'canonical-control.json':{}},canonicalConfigurationSha256='6'*64),provider=provider,redis=dict(IsSuccess=True,Code='success',Images=[dict(Tag='redis-7-alpine',Status='NORMAL',Digest='7'*64)]),binaries=dict(kind='cn-reviewed-publication-binaries-v1',observedAt=now,binaries=hf.approval()['binaries'],evidenceRefs=[{'path':str(evidence),'sha256':m.sha(evidence.read_bytes())}]))
  self.inputs.update({n:m.encode(v) for n,v in values.items()});self.r['inputs']={n:m.sha(raw) for n,raw in self.inputs.items()}
 def test_publication_generates_real_canonical_stage_check_publish(self):
  self.publication_inputs()
  result=self.bind();out=self.root/'out';approval=json.loads((out/'approval.json').read_bytes())
  self.assertEqual(approval['sourceRevision'],self.r['sourceRevision']);self.assertEqual(approval['expiresAt'],self.r['deadlineAt'])
  self.assertEqual((out/'candidate-revalidation.json').read_bytes(),self.inputs['proof'])
  order=json.loads((out/'stage-order.json').read_bytes());self.assertEqual([x['operation'] for x in order['steps']][-3:],['stage-assemble','check-plan','publish'])
  for step in order['steps']:
   params=json.loads((out/step['parameters']).read_bytes());self.assertEqual(params['InstanceId.1'],'i-uf6ga92ewloganobbln6');self.assertEqual(params['RepeatMode'],'Once')
  self.assertEqual(result['cloudCalls'],0);compile((out/'stage.py').read_bytes(),'stage','exec')
 def test_late_publication_capability_preserves_original_execution_budget(self):
  self.publication_inputs();self.r['requestedAt']=(self.now-dt.timedelta(seconds=957)).isoformat();self.r['deadlineAt']=(self.now+dt.timedelta(seconds=843)).isoformat()
  self.r['publicationCapability']={'issuedAt':self.now.isoformat(),'expiresAt':(self.now+dt.timedelta(minutes=25)).isoformat()}
  result=self.bind();out=self.root/'out';approval=json.loads((out/'approval.json').read_bytes())
  self.assertEqual(approval['expiresAt'],self.r['publicationCapability']['expiresAt']);self.assertEqual(result['deadlineAt'],self.r['deadlineAt'])
  for step in json.loads((out/'stage-order.json').read_bytes())['steps']:
   params=json.loads((out/step['parameters']).read_bytes());self.assertLessEqual(int(params['Timeout']),843)
 def test_large_proof_original_bytes_split_and_reassembled(self):
  import ast,base64,random,zlib
  self.publication_inputs();original=self.inputs['proof']
  for size in (17238,70000):
   with self.subTest(size=size):
    rng=random.Random(size);self.inputs['proof']=original+bytes(rng.choice(b' \t\r\n') for _ in range(size-len(original)));self.assertEqual(len(self.inputs['proof']),size)
    self.r['inputs']['proof']=m.sha(self.inputs['proof']);self.bind();out=self.root/'out';order=json.loads((out/'stage-order.json').read_bytes());parts=[];final=None
    self.assertEqual(len({x['parameters'] for x in order['steps']}),len(order['steps']))
    for step in order['steps']:
     raw=(out/step['parameters']).read_bytes();self.assertEqual(m.sha(raw),step['sha256']);param=json.loads(raw);self.assertLessEqual(len(param['CommandContent'].encode()),18000)
     command=param['CommandContent'];tree=ast.parse(command.split("<<'CN_DEADLINE'\n",1)[1].rsplit('\nCN_DEADLINE\n',1)[0]);packed=ast.literal_eval(tree.body[1].value.args[0].args[0]);guard=zlib.decompress(base64.b64decode(packed));gt=ast.parse(guard);cfg=ast.literal_eval(next(n.value for n in gt.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CONFIG' for t in n.targets)))
     self.assertEqual(cfg['deadlineAt'],self.r['deadlineAt'])
     if step['operation'] in ('check-plan','publish'):continue
     body=base64.b64decode(cfg['source']);tree=ast.parse(body);config=ast.literal_eval(next(n.value for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CONFIG' for t in n.targets)))
     if config['op']=='chunk':parts.append(base64.b64decode(config['data']))
     else:final=config
    stage=zlib.decompress(b''.join(parts));self.assertEqual(stage,(out/'stage.py').read_bytes());self.assertEqual(m.sha(stage),final['stageSha256'])
    self.assertEqual((out/'candidate-revalidation.json').read_bytes(),self.inputs['proof']);shutil.rmtree(out)
 def test_order_omission_reordering_and_tamper_rejected(self):
  import copy
  self.publication_inputs();self.bind();content={p.name:p.read_bytes() for p in (self.root/'out').iterdir()};order=json.loads(content['stage-order.json'])
  for mutation in ('omit','reorder','tamper'):
   with self.subTest(mutation=mutation):
    changed=dict(content);v=copy.deepcopy(order)
    if mutation=='omit':v['steps'].pop(0)
    elif mutation=='reorder':v['steps'][-1],v['steps'][-2]=v['steps'][-2],v['steps'][-1]
    else:changed[v['steps'][0]['parameters']]+=b' '
    changed['stage-order.json']=m.encode(v)
    with self.assertRaisesRegex(ValueError,'STAGE_ORDER'):m.validate_order(changed,self.r)
 def test_capability_not_covered_by_proof_is_rejected(self):
  self.publication_inputs();now=dt.datetime.now(dt.timezone.utc)
  self.r['publicationCapability']={'issuedAt':now.isoformat(),'expiresAt':(now+dt.timedelta(minutes=30)).isoformat()}
  with self.assertRaisesRegex(ValueError,'PROOF_WINDOW_TOO_SHORT'):self.bind()
 def test_consume_cannot_request_extended_capability(self):
  self.r['publicationCapability']={'issuedAt':self.r['requestedAt'],'expiresAt':self.r['deadlineAt']}
  with self.assertRaisesRegex(ValueError,'REQUEST_FIELDS'):self.bind()
 def test_missing_publication_evidence_is_not_ready(self):
  self.r['phase']='publication';self.r['publicationCapability']={'issuedAt':self.r['requestedAt'],'expiresAt':self.r['deadlineAt']}
  with self.assertRaisesRegex(ValueError,'INPUT_CLOSURE'):self.bind()

class TransportTests(unittest.TestCase):
 def setUp(self):
  import types,os
  from unittest.mock import patch
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.mod=types.ModuleType('transport');raw=(m.TEMPLATES/'transport-runtime.py').read_text().replace('__CONFIG__','None').split("if __name__=='__main__':")[0];exec(compile(raw,'transport','exec'),self.mod.__dict__)
  original=os.fstat
  def rootstat(fd):
   st=original(fd);values={k:getattr(st,k) for k in dir(st) if k.startswith('st_')};values.update(st_uid=0,st_gid=0);return types.SimpleNamespace(**values)
  for patcher in (patch.object(self.mod,'directory',lambda _:os.open(self.root,os.O_RDONLY|os.O_DIRECTORY)),patch.object(self.mod.os,'geteuid',lambda:0),patch.object(self.mod.os,'getegid',lambda:0),patch.object(self.mod.os,'fstat',rootstat)):
   patcher.start();self.addCleanup(patcher.stop)
 def configurations(self):
  import base64,zlib
  stage=b"print('STAGE_EXECUTED')\n";raw=zlib.compress(stage);parts=[raw[:10],raw[10:]];directory='publication-bytes-'+'a'*64
  configs=[dict(op='chunk',directory=directory,index=i,data=base64.b64encode(v).decode(),size=len(v),sha256=m.sha(v)) for i,v in enumerate(parts)]
  final=dict(op='assemble',directory=directory,chunks=[dict(size=len(v),sha256=m.sha(v)) for v in parts],compressedSha256=m.sha(raw),stageSize=len(stage),stageSha256=m.sha(stage))
  return configs,final
 def run_stage(self,c):
  import contextlib,io
  out=io.StringIO()
  with contextlib.redirect_stdout(out):self.mod.execute(c)
  return out.getvalue()
 def test_sequential_transport_and_one_shot_assembly(self):
  chunks,final=self.configurations()
  for c in chunks:self.assertNotIn('STAGE_EXECUTED',self.run_stage(c))
  self.assertIn('STAGE_EXECUTED',self.run_stage(final))
  with self.assertRaises((ValueError,FileExistsError)):self.run_stage(final)
 def test_missing_chunk_and_skipped_sequence_rejected(self):
  chunks,final=self.configurations()
  with self.assertRaises(FileNotFoundError):self.run_stage(chunks[1])
  self.run_stage(chunks[0])
  with self.assertRaises(ValueError):self.run_stage(final)
  bad=dict(chunks[1],index=2)
  with self.assertRaises(ValueError):self.run_stage(bad)
 def test_tamper_and_duplicate_rejected(self):
  chunks,final=self.configurations();self.run_stage(chunks[0])
  with self.assertRaises(FileExistsError):self.run_stage(chunks[0])
  self.run_stage(chunks[1]);(self.root/final['directory']/'000.part').write_bytes(b'wrong')
  with self.assertRaises(ValueError):self.run_stage(final)

class StorageTests(unittest.TestCase):
 def setUp(self):
  import types
  self.mod=types.ModuleType('consumer');self.mod.CONFIG=dict(prefix='runs/1/1/',sourceRevision='a'*40,controlRevision='b'*40,attemptId='fixture')
  exec(compile((m.TEMPLATES/'consumer.py').read_bytes(),'consumer','exec'),self.mod.__dict__)
  self.capacity={**m.capacity_guards((ROOT/'scripts/cn_candidate_host.py').read_bytes()),'imageBytes':3825868800,'storageMarginBytes':2147483648}
  self.v={'capacity':self.capacity,'objects':{n:{'bytes':3825868800//7} for n in ('plan','set','api','web','agent','sandbox','postgres')}}
  self.v['objects'].update(proof={'bytes':17238},policy={'bytes':4000})
 def observations(self,devices=(1,1,1,1),free=100*1024**3):
  return {n:dict(device=d,free=free,allocationUnit=4096) for n,d in zip(('consumer','inbox','spool','docker'),devices)}
 def test_real_sticky_spool_directory_only_and_secure_parent_traversal(self):
  import os,stat,types
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'var/tmp').mkdir(parents=True);(root/'var/lib/docker').mkdir(parents=True);(root/'var/lib/workspacex-cn/candidate-inbox').mkdir(parents=True)
   (root/'var/tmp').chmod(0o1777)
   self.assertEqual(stat.S_IMODE((root/'var/tmp').stat().st_mode),0o1777)
   real_open,real_fstat=os.open,os.fstat
   def opening(path,*args,**kwargs):return real_open(str(root) if path=='/' else path,*args,**kwargs)
   def owner_only(fd):
    # Actual fixture directory mode/device/free; root ownership alone is simulated
    # because these portable tests run as an unprivileged developer on macOS.
    value=real_fstat(fd);fields={k:getattr(value,k) for k in dir(value) if k.startswith('st_')};fields.update(st_uid=0,st_gid=0);return types.SimpleNamespace(**fields)
   with patch.object(self.mod.os,'open',side_effect=opening),patch.object(self.mod.os,'fstat',side_effect=owner_only):
    self.assertGreater(self.mod.filesystem('/var/tmp')['free'],0)
    for path in ('/var/lib/docker','/var/lib/workspacex-cn','/var/lib/workspacex-cn/candidate-inbox'):
     fixture=root/path.lstrip('/');fixture.chmod(0o1777)
     with self.assertRaises(AssertionError):self.mod.filesystem(path)
     fixture.chmod(0o700)
    (root/'var/tmp').chmod(0o777)
    with self.assertRaises(AssertionError):self.mod.filesystem('/var/tmp')
    (root/'var/tmp').chmod(0o1777);(root/'var').chmod(0o1777)
    with self.assertRaises(AssertionError):self.mod.filesystem('/var/tmp')
    (root/'var').chmod(0o700);(root/'var/tmp').rmdir();(root/'var/tmp').symlink_to(root/'var/lib/docker')
    with self.assertRaises(OSError):self.mod.filesystem('/var/tmp')
 def test_real_free_before_download_is_insufficient_for_retained_plus_publisher(self):
  obs=self.observations(free=18865900000);report=self.mod.storage_plan(self.v,obs);device=report['devices'][0]
  self.assertEqual(device['publisherSpool'],17450958848);self.assertEqual(device['publisherDocker'],17450958848)
  self.assertGreater(device['required'],device['free']);self.assertEqual(device['required'],device['consumerRetained']+17450958848)
  self.assertEqual(report['canonicalHostSha256'],m.sha((ROOT/'scripts/cn_candidate_host.py').read_bytes()))
 def test_exact_byte_boundary_and_one_byte_short(self):
  obs=self.observations();report=self.mod.storage_plan(self.v,obs);required=report['devices'][0]['required']
  for value,expect in ((required,True),(required-1,False)):
   report=self.mod.storage_plan(self.v,self.observations(free=value));self.assertEqual(all(x['free']>=x['required'] for x in report['devices']),expect)
 def test_different_devices_are_checked_independently(self):
  report=self.mod.storage_plan(self.v,self.observations((1,1,2,3)));devices={x['device']:x for x in report['devices']}
  self.assertEqual(devices[2]['required'],17450958848);self.assertEqual(devices[3]['required'],17450958848)
  self.assertEqual(devices[1]['required'],devices[1]['consumerRetained']+self.capacity['storageMarginBytes'])
  self.assertEqual(devices[2]['consumerRetained'],0)
  with self.assertRaisesRegex(AssertionError,'INBOX_PROMOTION_CROSS_DEVICE'):self.mod.storage_plan(self.v,self.observations((1,4,2,3)))
 def test_compressed_zip_and_changed_plan_margin(self):
  for x in self.v['objects'].values():x['bytes']=100
  self.capacity['imageBytes']=10*1024**3;self.capacity['storageMarginBytes']=3*1024**3
  report=self.mod.storage_plan(self.v,self.observations());d=report['devices'][0]
  self.assertGreaterEqual(d['consumerRetained'],report['objectBytes']+self.capacity['imageBytes']+report['metadataUpperBound'])
  self.assertEqual(d['publisherSpool'],43*1024**3)
 def test_formula_path_coefficient_total_or_duplicate_drift_fails_closed(self):
  raw=(ROOT/'scripts/cn_candidate_host.py').read_text()
  changes=[raw.replace('total * 4','total * 5'),raw.replace("plan['storageMarginBytes'], 'SPOOL_CAPACITY'","1, 'SPOOL_CAPACITY'"),raw.replace("disk_usage('/var/tmp')","disk_usage('/tmp')"),raw.replace("sum(item['size'] for item", "sum(item['other'] for item")]
  guard="    a.require(shutil.disk_usage('/var/tmp').free >= total * 4 + plan['storageMarginBytes'], 'SPOOL_CAPACITY')"
  changes.append(raw.replace(guard,guard+'\n'+guard))
  for changed in changes:
   with self.subTest():
    with self.assertRaises(ValueError):m.capacity_guards(changed.encode())
 def test_insufficient_space_rejects_before_any_sdk_import_or_get(self):
  from unittest.mock import patch
  seen=[];obs=self.observations(free=18865900000)
  def probe(path,allow_missing=False):return obs[{'/var/lib/workspacex-cn':'consumer','/var/lib/workspacex-cn/candidate-inbox':'inbox','/var/tmp':'spool','/var/lib/docker':'docker'}[path]]
  original=__import__('builtins').__import__
  def importing(name,*args,**kwargs):
   if name in ('oss2','cn_candidate_authenticated_oss','alibabacloud_credentials.client'):seen.append(name);raise AssertionError('SDK_BEFORE_CAPACITY')
   return original(name,*args,**kwargs)
  with patch.object(self.mod,'validate',lambda v:v),patch.object(self.mod,'filesystem',probe),patch.object(self.mod.os,'geteuid',lambda:0),patch.object(self.mod.os,'getegid',lambda:0),patch('builtins.__import__',side_effect=importing):
   result=self.mod.run(self.v)
  self.assertEqual(result['status'],'CAPACITY_REJECTED');self.assertEqual(result['ossGets'],0);self.assertEqual(seen,[]);self.assertFalse(result['storageAdmission']['admitted'])

class DeadlineTests(unittest.TestCase):
 def guard(self,source,start,end,limit):
  import base64
  config=dict(requestedAt=start.isoformat(),deadlineAt=end.isoformat(),maxSeconds=limit,source=base64.b64encode(source.encode()).decode(),sourceSha256=m.sha(source.encode()))
  return (m.TEMPLATES/'deadline-runtime.py').read_text().replace('__CONFIG__',repr(config))
 def test_expired_start_does_not_execute(self):
  with tempfile.TemporaryDirectory() as temp:
   target=Path(temp)/'mutation';now=dt.datetime.now(dt.timezone.utc)
   code=self.guard('from pathlib import Path;Path('+repr(str(target))+').touch()',now-dt.timedelta(minutes=1),now-dt.timedelta(seconds=1),5)
   r=subprocess.run([sys.executable,'-I','-S','-B','-c',code],capture_output=True,text=True,timeout=5)
   self.assertEqual(r.returncode,75);self.assertFalse(target.exists());self.assertFalse(json.loads(r.stdout)['retryAllowed'])
 def test_sensitive_stderr_is_never_forwarded(self):
  now=dt.datetime.now(dt.timezone.utc);code=self.guard('import sys;print("SECRET_PROVIDER_TOKEN",file=sys.stderr);print("{\\"receipt\\":true}")',now,now+dt.timedelta(seconds=5),3)
  result=subprocess.run([sys.executable,'-I','-S','-B','-c',code],capture_output=True,text=True,timeout=5)
  self.assertEqual(result.returncode,0);self.assertNotIn('SECRET_PROVIDER_TOKEN',result.stdout+result.stderr);self.assertTrue(json.loads(result.stdout)['receipt'])
 def test_killpg_permission_error_still_joins_child_and_remains_unknown(self):
  import types,os
  from unittest.mock import patch
  now=dt.datetime.now(dt.timezone.utc);code=self.guard('import time;time.sleep(1.2)',now,now+dt.timedelta(seconds=5),1)
  module=types.ModuleType('guard');exec(compile(code.split("if __name__=='__main__':")[0],'guard','exec'),module.__dict__)
  original=subprocess.Popen;children=[]
  def launch(*args,**kwargs):
   child=original(*args,**kwargs);children.append(child);return child
  with patch.object(module.os,'killpg',side_effect=PermissionError('fixture denied')),patch.object(module.subprocess,'Popen',side_effect=launch):
   with self.assertRaisesRegex(RuntimeError,'UNKNOWN_RECONCILE_NO_RETRY'):module.execute(module.CONFIG)
  self.assertEqual(len(children),1);self.assertIsNotNone(children[0].returncode);self.assertTrue(children[0].stdout.closed)
  with self.assertRaises(ChildProcessError):os.waitpid(children[0].pid,os.WNOHANG)
 def test_daemon_accepted_work_is_unknown_not_claimed_stopped(self):
  import threading,time
  with tempfile.TemporaryDirectory() as temp:
   accepted=Path(temp)/'accepted';external=Path(temp)/'external-effect';now=dt.datetime.now(dt.timezone.utc)
   # Independent daemon stand-in is outside the child process group. Test owns it.
   def daemon():
    until=time.monotonic()+5
    while not accepted.exists() and time.monotonic()<until:time.sleep(.01)
    if accepted.exists():time.sleep(1.2);external.write_text('accepted work finished')
   thread=threading.Thread(target=daemon);thread.start()
   source='from pathlib import Path;import time;Path('+repr(str(accepted))+').touch();time.sleep(10)'
   code=self.guard(source,now,now+dt.timedelta(seconds=5),1)
   result=subprocess.run([sys.executable,'-I','-S','-B','-c',code],capture_output=True,text=True,timeout=5);thread.join(5)
   self.assertEqual(result.returncode,75);v=json.loads(result.stdout);self.assertEqual(v['status'],'UNKNOWN_RECONCILE_NO_RETRY');self.assertFalse(v['externalWritesStopped']);self.assertTrue(v['independentObserverRequired']);self.assertTrue(external.exists())

if __name__=='__main__':unittest.main()
