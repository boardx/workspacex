"""Real temporary-file publication with synthetic provider/preparer fixtures.

These tests do not claim authenticated GitHub, RDS, root installation or deploy.
"""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('cloudprep',ROOT/'scripts/cn-release-mvp-cloud-prepare.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class CloudPreparation(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);root=Path(self.temp.name)
  self.policyroot=root/'policies';self.approvals=root/'approvals';self.inputs=root/'inputs';self.journals=root/'journal';self.portal=root/'portal'
  for p in (self.policyroot,self.policyroot/'objects',self.approvals,self.inputs,self.journals,self.portal,self.portal/'objects',self.portal/'selectors'):p.mkdir(mode=0o700)
  self.now=m.S.instant('2026-10-14T02:05:00Z')
  data={name:m.E.encode({'approvedInput':name})for name in ('authorization.json','template.json','migrationDiff.json','writer-authorization.json','test-data-scope.json','mvp-profile.json','mvp-schema-request.json','mvp-content-request.json','mvp-content-backup.json','mvp-nonmodel-fixtures.json','mvp-nonmodel-credentials.json','mvp-existing-environment.json','mvp-runtime-manifest.json')}
  for name,purpose in (('mvp-existing-environment.json','migration-environment'),('mvp-nonmodel-credentials.json','nonmodel-credentials')):
   data[name]=m.E.encode(dict(kind='cn-mvp-existing-private-input-ref-v1',purpose=purpose,format=purpose+'-json-v1',path='/etc/workspacex-cn/synthetic-only-'+purpose+'.json',sha256='e'*64))
  data['test-data-scope.json']=data['mvp-nonmodel-fixtures.json']
  host={'ghExecutable':'/usr/bin/gh','ghSha256':'d'*64,'authentication':'existing-root-gh'}
  data['mvp-profile.json']=m.E.encode({'githubProvider':host})
  self.objects={m.E.sha(raw):raw for raw in data.values()};self.pins={name:m.E.sha(raw)for name,raw in data.items()}
  identity={'sourceRevision':'a'*40,'controlRevision':'b'*40,'releaseId':'cloud-test','contentManifestSha256':self.pins['mvp-content-request.json']}
  target={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}
  code={name:m.E.sha((ROOT/name).read_bytes()) for name in ('scripts/cn-release-mvp-cloud-prepare.py','scripts/cn-release-mvp-private-input.py')}
  self.p={'kind':'cn-mvp-cloud-preparation-policy-v1','action':'install-approved-control-data','identity':identity,'target':target,'requestedAt':'2026-10-14T02:00:00Z','deadlineAt':'2026-10-14T02:30:00Z','codeFiles':code,'rootInputPins':self.pins,'githubPolicy':host,'probeSha256':m.E.sha(b'{}')}
  self.selector=dict(identity=identity,requestedAt=self.p['requestedAt'],deadlineAt=self.p['deadlineAt'],buildRunId=12,transferRunId=13)
  stage={'profileSha256':'mvp-profile.json','schemaRequestSha256':'mvp-schema-request.json','contentRequestSha256':'mvp-content-request.json','contentBackupSha256':'mvp-content-backup.json','nonmodelFixturesSha256':'mvp-nonmodel-fixtures.json','nonmodelCredentialsSha256':'mvp-nonmodel-credentials.json'}
  a={'kind':'cn-fixed-release-approval-v1','target':target,'identity':{'sourceRevision':'a'*40,'controlRevision':'b'*40,'requestedAt':self.p['requestedAt'],'deadlineAt':self.p['deadlineAt']},'codeFiles':code,
   'mvp':{'acceptanceScope':'mvp-non-model','contentManifestSha256':identity['contentManifestSha256'],'buildRunId':12,'transferRunId':13,'stageInputs':{k:self.pins[v]for k,v in stage.items()}},
   'runtime':{'staticInputHashes':{k:self.pins[k+'.json']for k in ('authorization','template','migrationDiff')}},'business':{'testDataScopeSha256':self.pins['test-data-scope.json']},
   'acquire':{'requests':{name:{'runId':12,'runAttempt':1}for name in ('consume','publication')}}}
  self.files={'approval.json':m.E.encode(a),**{n:b'{}'for n in ('candidate-plan.json','candidate-set.json','proof.json','policy.json')}}
  self.raw=m.E.encode(self.p);self.pin=m.E.sha(self.raw)
  (self.policyroot/(self.pin+'.json')).write_bytes(self.raw)
  for h,data in self.objects.items():(self.policyroot/'objects'/(h+'.json')).write_bytes(data)
  (self.policyroot/'objects'/(self.p['probeSha256']+'.json')).write_bytes(b'{}')
  self.provider_calls=[]
  def github(path):
   self.provider_calls.append(path)
   stage='build'if ('build-cn-image-candidates' in path or path.endswith('/12'))else'transfer'
   workflow='build-cn-image-candidates.yml'if stage=='build'else'transfer-cn-candidates-via-hongkong.yml'
   value={'id':12 if stage=='build'else 13,'repository':{'full_name':'boardx/workspacex'},'display_title':'cn-mvp-cloud-test-'+stage,'path':'.github/workflows/'+workflow,'head_sha':'b'*40,'head_branch':'main','event':'workflow_dispatch','run_attempt':1,'status':'completed','conclusion':'success','created_at':'2026-10-14T02:01:00Z','updated_at':'2026-10-14T02:02:00Z'}
   return {'workflow_runs':[value]}if '/workflows/'in path else value
  self.github=github
 def publication(self):return m.publication(self.p,self.selector,self.files,self.objects)
 def patches(self):
  actual_load=m.load
  class Preparer:
   def derive_from_policy(inner,*args,**kwargs):return self.files,{}
  class Entry:
   class e:
    directory=staticmethod(lambda p:None)
    read=staticmethod(lambda p,*args:Path(p).read_bytes())
  def load(name):return Preparer()if name=='mvp-approval-prepare'else Entry()if name=='fixed-driver'else actual_load(name)
  return (patch.object(m,'POLICIES',self.policyroot),patch.object(m,'APPROVALS',self.approvals),patch.object(m,'INPUTS',self.inputs),patch.object(m,'JOURNALS',self.journals),patch.object(m.E,'ROOT',self.portal),patch.object(m,'load',side_effect=load))
 def publish(self):
  from contextlib import ExitStack
  with ExitStack()as stack:
   for p in self.patches():stack.enter_context(p)
   return m.execute(self.pin,reader=lambda p:Path(p).read_bytes(),github=self.github,clock=lambda:self.now)
 def test_actual_files_approval_and_selector_published_last(self):
  events=[];save=m.save
  with patch.object(m,'save',side_effect=lambda p,data:(events.append(p),save(p,data))[1]):result=self.publish()
  self.assertTrue(result['installed']);self.assertFalse(result['productionStarted'])
  release=result['releaseSha256'];self.assertEqual((self.approvals/(release+'.json')).read_bytes(),self.files['approval.json'])
  for name,h in self.pins.items():self.assertEqual(m.E.sha((self.inputs/release/name).read_bytes()),h);self.assertEqual((self.inputs/release/name).stat().st_mode&0o777,0o600)
  approval_index=events.index(self.approvals/(release+'.json'));selector_index=events.index(self.portal/'selectors'/(result['selectorSha256']+'.json'))
  self.assertLess(approval_index,selector_index);self.assertNotIn('approvedInput',json.dumps(result))
 def test_preparation_only_copies_references_and_never_resolves_private_target(self):
  actual=m.load
  private=actual('mvp-private-input')
  with patch.object(private,'resolve_ref',side_effect=AssertionError('secret target read forbidden')):
   with patch.object(m,'load',side_effect=lambda name:private if name=='mvp-private-input' else actual(name)):
    result=self.publish()
  for name in ('mvp-existing-environment.json','mvp-nonmodel-credentials.json'):
   raw=(self.inputs/result['releaseSha256']/name).read_bytes()
   self.assertEqual(raw,self.objects[self.pins[name]])
   self.assertEqual(json.loads(raw)['kind'],'cn-mvp-existing-private-input-ref-v1')
 def test_literal_credentials_rejected_before_publication(self):
  for name,payload in (('mvp-existing-environment.json',{'MIGRATION_DB_PASSWORD':'synthetic-never-copy'}),('mvp-nonmodel-credentials.json',{'primary':{'email':'synthetic@example.invalid','password':'synthetic-never-copy'}})):
   with self.subTest(name=name):
    objects=dict(self.objects);policy=dict(self.p);policy['rootInputPins']=dict(self.pins)
    raw=m.E.encode(payload);pin=m.E.sha(raw);objects[pin]=raw;policy['rootInputPins'][name]=pin
    # Keep all authenticated metadata consistent so rejection is the ref schema.
    files=dict(self.files);approval=json.loads(files['approval.json'])
    if name=='mvp-nonmodel-credentials.json':approval['mvp']['stageInputs']['nonmodelCredentialsSha256']=pin
    files['approval.json']=m.E.encode(approval)
    with self.assertRaises(ValueError):m.publication(policy,self.selector,files,objects)
    self.assertEqual(list(self.inputs.iterdir()),[])
 def test_same_policy_never_replays_publication(self):
  self.publish()
  with self.assertRaises(FileExistsError):self.publish()
 def test_static_input_mismatch_before_any_writes(self):
  a=json.loads(self.files['approval.json']);a['runtime']['staticInputHashes']['migrationDiff']='0'*64;self.files['approval.json']=m.E.encode(a)
  with self.assertRaisesRegex(ValueError,'APPROVAL_STATIC_INPUT_HASHES'):self.publish()
  self.assertEqual(list(self.journals.iterdir()),[]);self.assertEqual(list(self.approvals.iterdir()),[])
 def test_expired_policy_before_provider_and_intent(self):
  self.now=m.S.instant('2026-10-14T02:30:00Z')
  with self.assertRaisesRegex(ValueError,'ORIGINAL_POLICY_WINDOW'):self.publish()
  self.assertEqual(self.provider_calls,[]);self.assertEqual(list(self.journals.iterdir()),[])
 def test_partial_publication_preserves_intent_and_never_retries(self):
  save=m.save
  def failure(path,data):
   if path.parent.parent==self.inputs:raise OSError('fixture storage failed')
   save(path,data)
  with patch.object(m,'save',side_effect=failure),self.assertRaises(OSError):self.publish()
  self.assertTrue((self.journals/self.pin/'intent.json').exists());self.assertEqual(list(self.approvals.iterdir()),[])
  with self.assertRaises(FileExistsError):self.publish()
 def test_deadline_crossing_before_approval_preserves_intent(self):
  save=m.save
  def crossing(path,data):
   save(path,data)
   if path.parent.parent==self.inputs:self.now=m.S.instant('2026-10-14T02:30:00Z')
  with patch.object(m,'save',side_effect=crossing),self.assertRaisesRegex(ValueError,'ORIGINAL_POLICY_WINDOW'):self.publish()
  self.assertTrue((self.journals/self.pin/'intent.json').exists());self.assertEqual(list(self.approvals.iterdir()),[])
 def test_ambiguous_provider_runs_cannot_select_another_release(self):
  def duplicate(path):
   value=self.github(path)
   if 'workflow_runs'in value:value['workflow_runs']*=2
   return value
  with self.assertRaisesRegex(ValueError,'EXACT_UNIQUE_BUILD_RUN_REQUIRED'):m.discover(self.p,duplicate)

class TerminalPublication(unittest.TestCase):
 def setUp(self):
  import test_cn_mvp_collector_end_to_end as allstage
  self.f=allstage.SevenStageCollection(methodName='runTest');self.f.setUp();self.addCleanup(self.f.doCleanups)
  self.allstage=allstage
  self.temp=tempfile.TemporaryDirectory(prefix='.cloud-terminal-test-',dir=ROOT);self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  self.portal=self.root/'portal';self.journals=self.root/'journals'
  for path in (self.portal,self.portal/'objects',self.portal/'selectors',self.journals):path.mkdir(mode=0o700)
  self.p={'kind':'cn-mvp-cloud-preparation-policy-v1','action':'install-approved-control-data','identity':self.f.payload['identity'],
   'target':self.f.approval['target'],'requestedAt':self.f.start,'deadlineAt':self.f.end,'codeFiles':self.f.approval['codeFiles']}
  self.raw=m.E.encode(self.p);self.pin=m.E.sha(self.raw)
  self.f.write(m.POLICIES/(self.pin+'.json'),self.raw)
  (self.journals/self.pin).mkdir(mode=0o700)
  (self.journals/self.pin/'result.json').write_bytes(m.E.encode({'policySha256':self.pin,'releaseSha256':self.f.release,'installed':True,'productionStarted':False}))
 def reader(self,path):
  path=Path(path)
  if path.is_relative_to(self.root):return path.read_bytes()
  if path==ROOT/'scripts/cn-release-mvp-trusted-collector.py':return self.f.entry_read(path)
  return self.f.reader(path)
 def execute_terminal(self,ongoing=False):
  f=self.f;allstage=self.allstage;actual=m.load;calls=[]
  def github(path,target=None,limit=None):
   value=f.provider(path,target,limit)
   if ongoing and f'/runs/{f.production_id}/'in path:value.update(status='in_progress',conclusion=None)
   return value
  class Collector:
   def verify(inner,*args,**kwargs):
    calls.append(kwargs.get('completed',True))
    return allstage.C.verify(*args,**kwargs,advance=allstage.entryfixture.e,github=github)
  class Fixed:
   e=allstage.entryfixture.e
  def load(name):return Collector()if name=='mvp-trusted-collector'else Fixed()if name=='fixed-driver'else allstage.P if name=='mvp-original-producer'else actual(name)
  with patch.object(m,'JOURNALS',self.journals),patch.object(m.E,'ROOT',self.portal),patch.object(m,'load',side_effect=load),patch.object(allstage.entryfixture.e,'read',f.entry_read):
   result=m.terminal(self.pin,reader=self.reader,clock=lambda:dt.datetime.now(dt.timezone.utc))
  return result,calls
 def test_real_seventeen_admissions_seven_stage_terminal_portal_publication(self):
  result,calls=self.execute_terminal()
  self.assertEqual(calls,[True]);self.assertTrue(result['installed']);self.assertFalse(result['productionWrites']);self.assertFalse(result['fullBusinessAcceptance'])
  selector=self.portal/'selectors'/(result['selectorSha256']+'.json')
  self.assertEqual(json.loads(selector.read_bytes())['productionRunId'],self.f.production_id)
  self.assertEqual(selector.stat().st_mode&0o777,0o600)
  self.assertTrue((self.journals/self.pin/'terminal'/'result.json').exists())
 def test_in_progress_provider_cannot_publish_terminal_or_intent(self):
  with self.assertRaisesRegex(ValueError,'PRODUCTION_RUN_RESULT'):self.execute_terminal(ongoing=True)
  self.assertFalse((self.journals/self.pin/'terminal').exists());self.assertEqual(list((self.portal/'selectors').iterdir()),[])

if __name__=='__main__':unittest.main()
