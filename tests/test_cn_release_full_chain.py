"""17-stage OFFLINE integration; never a cloud/production E2E claim.

Real driver/router, immutable entry journal, canonical acquire/publication and
runtime/finalize materializers. External execution and live admission are an
explicit deterministic provider fixture; original commands/verifiers are pinned
but not executed against a host. Linux cgroup/browser suites remain separate.
"""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import shlex
import tempfile
import unittest
from unittest.mock import patch
import test_cn_release_acquire_delegation as af
import test_cn_release_continuation_bind as bf
import test_cn_release_rds_backup as rf

ROOT=Path(__file__).resolve().parents[1]
def load(name):
 s=importlib.util.spec_from_file_location('full_'+name,ROOT/'scripts'/('cn-release-'+name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
r=load('stage-router');d=load('fixed-driver')

class FullChain(unittest.TestCase):
 @classmethod
 def setUpClass(cls):af.DelegationTests.setUpClass()
 @classmethod
 def tearDownClass(cls):af.DelegationTests.tearDownClass()
 def setUp(self):
  self.f=af.DelegationTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
  self.b=bf.ReviewedPackageIntegration();self.b.setUp();self.addCleanup(self.b.doCleanups)
  self.root=self.f.f.root;self.a=self.f.release;ident=self.a['identity'];self.identity=ident
  self.virtual={};self.calls=[];self.expected={};self.approved=False;self.fail=None
  self.inputs=self.root/'full-inputs';self.outputs=self.root/'full-generated';self.state=self.root/'full-state';self.requests=self.root/'full-requests'
  for p in (self.inputs,self.outputs,self.state,self.requests):p.mkdir(mode=0o700)
  self.remote='/var/lib/workspacex-cn/runtime/upgrade-f0eb-full-fixture'
  self.static={}
  for name in ('authorization','template','migrationDiff'):
   value=json.loads(self.b.inputs[name])
   for key in ('sourceRevision','baselineRevision','attemptId'):
    if key in value:value[key]=ident[key]
   if name=='authorization':value.update(issuedAt=self.a['issuedAt'],expiresAt=self.a['expiresAt'])
   self.static[name]=r.e.encode(value)
  names=set(r.MODULES.values())|set(self.a['codeFiles'])|{'scripts/cn-release-stage-contract.py','scripts/cn-release-generated-commands.py','scripts/cn-release-derived-approval.py','scripts/cn-release-continuation-bind.py'}
  self.a['codeFiles']={n:r.e.digest((ROOT/n).read_bytes())for n in names}
  self.a['runtime']={'templateFiles':self.b.approval['packageFiles'],'staticInputHashes':{k:r.e.digest(v)for k,v in self.static.items()},'stageVerifierSha256':{},'stageObserverSha256':{}}
  self.a['runtimeStage']={'remoteRoot':self.remote,'templateSha256':r.e.digest((ROOT/'.harness/scripts/vm/cn-runtime-continuation/stage-phase.py').read_bytes())}
  self.a['writerResume']={'remoteRoot':self.remote,'packageFiles':{n:r.e.digest((ROOT/'.harness/scripts/vm/cn-runtime-continuation/finalize'/n).read_bytes())for n in ('prepare.py','runtime.py')},'stageVerifierSha256':{}}
  realread=r.e.read
  def read(path,*args):
   path=Path(path)
   if str(path)in self.virtual:return self.virtual[str(path)]
   if path.is_relative_to(ROOT):return path.read_bytes()
   return realread(path,*args)
  for p in (patch.object(r,'INPUTS',self.inputs),patch.object(r,'OUTPUTS',self.outputs),patch.object(r,'CONTROL',self.f.f.repo),patch.object(r.e,'STATE',self.state),patch.object(r.e,'REQUESTS',self.requests),patch.object(r.e,'OWNER',os.getuid()),patch.object(r.e,'CGROUP_BASE',None),patch.object(r.e,'directory',lambda p:None),patch.object(r.e,'read',read),patch.object(d,'e',r.e)):
   p.start();self.addCleanup(p.stop)
  proto=r.Router(r.e.digest(r.e.encode(self.a)),self.a,r.e.encode(self.a))
  for stage in r.e.STAGES:
   ob,ve=proto.contract(stage);self.a['runtime']['stageObserverSha256'][stage]=r.e.digest(ob);self.a['runtime']['stageVerifierSha256'][stage]=r.e.digest(ve)
  self.a['writerResume']['stageVerifierSha256']=self.a['runtime']['stageVerifierSha256'].copy()
  self.a['acquire']['consumeEntryCode']={k:self.a['runtime'][key]['consume']for k,key in (('observerSha256','stageObserverSha256'),('verifierSha256','stageVerifierSha256'))}
  self.raw=r.e.encode(self.a);self.release=r.e.digest(self.raw);self.router=r.Router(self.release,self.a,self.raw)
  folder=self.inputs/self.release;folder.mkdir()
  for name,raw in {**self.f.f.inputs,**self.static,'writer-authorization':b'OFFLINE fixture explicit A5','test-data-scope':b'OFFLINE fixture tenant only'}.items():r.e.create(folder/(name+'.json'),raw)
  for name in ('consume-observer','publication-observer','runtime-observer'):
   m=self.router.load(name);m.APPROVALS=self.root/(name+'-records');m.APPROVALS.mkdir()
  p=patch.object(self.router.load('acquire'),'load_entry',return_value=r.e);p.start();self.addCleanup(p.stop)
  self.consume=self.f.receipt();self.virtual[str(af.d.receipt_path(self.a))]=self.consume
  self.rds=rf.Tests();self.rds.setUp();self.addCleanup(self.rds.doCleanups)
  self.hold={'schemaVersion':1,'state':'held','generation':'9'*32,'identity':{k:ident[k]for k in ('sourceRevision','baselineRevision','attemptId')}|{'migrationPlanSha256':r.e.digest(self.static['migrationDiff'])}}
  template=json.loads(self.static['template']);self.publication=r.e.encode({'receiptKind':'cn-candidate-published-v2','sourceRevision':ident['sourceRevision'],'controlRevision':ident['controlRevision'],'attemptId':ident['publicationAttemptId'],'images':{k:{'image':v}for k,v in template['rollbackImages'].items()if k!='sandbox-sessions'}})
  self.virtual[str(Path('/var/lib/workspacex-cn/archive-published')/ident['sourceRevision']/ident['publicationAttemptId']/'published.json')]=self.publication
  self.switch=r.e.encode({'exactFiveRunning':True,'holdRetained':True,'businessAcceptancePassed':False});self.virtual[self.remote+'/switch-result.json']=self.switch
  self.realrun=r.e.run_command
  for p in (patch.object(self.router,'preflight',self.provider_preflight),patch.object(self.router,'admission',self.admission),patch.object(r.e,'run_command',self.provider_command),patch.object(r.e,'verify',self.provider_verify)):
   p.start();self.addCleanup(p.stop)
 def provider_preflight(self,release):
  """Explicit fixture boundary, NOT proof installed production capability exists."""
  self.assertEqual(release,self.release)
  for name,pin in self.a['codeFiles'].items():self.assertEqual(r.e.digest((ROOT/name).read_bytes()),pin)
 def admission(self,release,stage):
  if stage=='clear-hold' and not self.approved:return 'WAITING_FOR_WRITER_APPROVAL'
  return None
 def response(self,stage,observing):
  value={'fixtureExternalProvider':True,'stage':stage}
  if stage=='consume':
   if not observing:
    # Real original ZIP extraction and full canonical tar verification. Only
    # provider bytes are synthetic; no fake proof admission or Mac images.
    config=r.e.decode((self.router.base/'acquire/consume/consumer-request.json').read_bytes())
    target=self.root/'full-consumer';cache=target/'original';cache.mkdir(parents=True)
    for name,item in config['objects'].items():
     raw=self.f.f.inputs[name]if name in ('proof','policy')else self.f.f.provider.blobs[item['artifactId']]
     (cache/(name+('.json'if name in ('proof','policy')else'.zip'))).write_bytes(raw)
    ns={'__name__':'offline_consumer','CONFIG':config}
    exec(compile((af.fixture.m.TEMPLATES/'consumer.py').read_bytes(),'actual-consumer','exec'),ns)
    result=ns['verify_downloaded'](config,target,lambda:None)
    self.assertEqual(result['images'],r.e.decode(self.consume)['images'])
    self.assertFalse(result['publicationExecuted'])
   return self.consume
  if stage=='publish':return r.e.encode({'kind':'cn-publication-readonly-observation-v1','phase':'publish','publishedReceiptSha256':r.e.digest(self.publication)})if observing else b'CN_CANDIDATE_PUBLISHED='+self.publication+b'\n'
  if stage=='hold':return r.e.encode(self.hold)if observing else r.e.encode({'actualHold':self.hold})
  if stage=='sessions':value={'knownFiveStopped':True,'otherDatabaseClientSessions':0,'holdGeneration':self.hold['generation'],'finishedAt':self.identity['requestedAt']}
  if stage=='backup':value={'holdGeneration':self.hold['generation']}
  if stage=='rds-backup':
   if not observing:
    self.rds.hold=self.hold;self.rds.stop=r.e.decode(self.router.evidence('sessions'))
    self.rds.a['identity']=dict(self.identity);self.rds.a['expiresAt']=self.a['expiresAt']
    for name,value in (('hold',self.hold),('stop',self.rds.stop)):self.rds.put('inputs/'+name+'.json',value)
    self.rds.put('rds-request.json',{'identity':self.identity,'inputHashes':{n:r.e.digest((self.rds.root/'inputs'/(n+'.json')).read_bytes())for n in ('stop','hold')}})
   return self.rds.runop('observe'if observing else'action')
  if stage in ('switch','acceptance'):
   binding=(self.router.base/'runtime/switch/binding.json').read_bytes()
   status={'kind':'f0eb-exact-five-status-v1','bindingSha256':r.e.digest(binding),'switchReceiptSha256':r.e.digest(self.switch),'hold':self.hold,'attemptId':self.identity['attemptId'],'sourceRevision':self.identity['sourceRevision'],'exactFiveVerified':True,'runtimeMutation':False,'observedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'containers':[]}
   # Preserve one observed byte stream across the fixture observer/verification.
   key=('held-status',)
   if key not in self.expected:self.expected[key]=r.e.encode(status)
   return self.expected[key] if observing or stage=='acceptance'else self.switch
  return r.e.encode(value)
 def provider_command(self,raw,timeout,started):
  matches=[]
  for folder in self.requests.iterdir():
   manifest=r.e.decode((folder/'manifest.json').read_bytes())
   for observing,file in ((False,'action.sh'),(True,'observe.sh')):
    if (folder/file).read_bytes()==raw:matches.append((manifest,observing))
  self.assertEqual(len(matches),1,'Only exact materialized command bytes may reach fixture transport')
  manifest,observing=matches[0];stage=manifest['stage'];key=(stage,observing)
  if not observing:self.calls.append(stage)
  if key not in self.expected:self.expected[key]=self.response(stage,observing)
  body=self.expected[key]
  if not observing:
   # Model a completed external side effect before a lost local response.
   # The persistent fixture record proves explicit reconcile did not reissue it.
   r.e.create(self.root/('provider-effect-'+stage+'.json'),body)
  command=('printf %s '+shlex.quote(body.decode())+'\n').encode()
  if not observing and self.fail==('lost-response',stage):command=b'exit 17\n'
  if not observing and self.fail==('timeout',stage):
   command=b'sleep 2\n';timeout=.05
   original_started=started
   def fault_started(pid,isolation):
    budget=original_started(pid,isolation)
    # Preserve the original durable PID and deadline observation while the
    # fixture deliberately substitutes a shorter execution budget.
    return None if budget is None else {**budget,'remainingSeconds':min(timeout,budget['remainingSeconds'])}
   started=fault_started
  return self.realrun(command,timeout,started)
 def provider_verify(self,code,raw,manifest,previous,mode):
  """Provider admission fixture; original generated verifier hash still pinned.
  This does NOT claim live stage-contract/browser/provider verification.
  """
  stage=manifest['stage'];self.assertEqual(r.e.digest(code),self.a['runtime']['stageVerifierSha256'][stage])
  observing=mode in ('terminal','reconcile');self.assertEqual(raw,self.expected[(stage,observing)])
  return {'externalWritesTerminal':True}if mode=='terminal'else True
 def coordinate(self,mode='run'):return d.coordinate(self.release,self.a,self.router,mode=mode,executor=r.e.entry)
 def approve(self):
  inputs=self.router.terminal_inputs();inputs.update(status=self.router.evidence('acceptance'),userAuthorization=(self.inputs/self.release/'writer-authorization.json').read_bytes(),testDataScope=(self.inputs/self.release/'test-data-scope.json').read_bytes())
  w={'kind':'cn-writer-resume-approval-v1','scope':'a5-resume-writers-and-a6-scoped-business-observation','releaseSha256':self.release,'identity':self.identity,'target':self.a['target'],'issuedAt':self.a['issuedAt'],'expiresAt':self.a['expiresAt'],'holdGeneration':self.hold['generation'],'publicOrigin':'https://app.boardx.com.cn/'}
  for name,key in [('binding','bindingSha256'),('hold','holdRawSha256'),('switchReceipt','switchReceiptSha256'),('status','heldHealthSha256'),('userAuthorization','userAuthorizationEvidenceSha256'),('testDataScope','testDataScopeSha256')]:w[key]=r.e.digest(inputs[name])
  raw=r.e.encode(w);pin=r.e.digest(raw);base='/etc/workspacex-cn/writer-resume-approvals/'
  self.virtual[base+'by-release/'+self.release+'.json']=r.e.encode({'approvalSha256':pin});self.virtual[base+pin+'.json']=raw;self.approved=True
 def test_real_materializers_and_entry_seventeen_stage_a5_pause_resume(self):
  result=self.coordinate();self.assertEqual(result['status'],'WAITING_FOR_WRITER_APPROVAL');self.assertEqual(self.calls,list(r.e.STAGES[:15]))
  self.assertFalse((self.state/self.identity['attemptId']/'15-clear-hold.intent.json').exists())
  self.approve();result=self.coordinate();self.assertEqual(result['status'],'CHAIN_COMPLETED');self.assertEqual(self.calls,list(r.e.STAGES))
  self.assertEqual(self.coordinate('status')['status'],'CHAIN_COMPLETED');self.assertEqual(self.calls,list(r.e.STAGES))
  for phase in ('hold','stop','backup','switch'):
   folder=self.router.base/'runtime'/phase;b=r.e.decode((folder/'binding.json').read_bytes());self.assertEqual(b['sourceRevision'],self.identity['sourceRevision']);self.assertEqual(b['deadlineAt'],self.identity['deadlineAt'])
   self.assertTrue((folder/'delegation.json').exists())
  self.assertTrue((self.router.base/'terminal/writer-resume/parameters.json').exists())
  self.assertEqual(sum(op=='CreateBackup'for op,_ in self.rds.p.calls),1)
  original=self.router.evidence('rds-backup');binding=r.e.decode((self.router.base/'runtime/switch/binding.json').read_bytes())
  self.assertEqual(binding['rdsBackupReceiptSha256'],r.e.digest(original))
  self.assertFalse(r.e.decode(original)['isolatedRestoreTested'])
 def test_lost_publish_response_never_reissues_mutation(self):
  self.fail=('lost-response','publish')
  with self.assertRaisesRegex(Exception,'EXECUTION_UNCERTAIN'):self.coordinate()
  self.assertEqual(self.coordinate()['status'],'UNKNOWN_RECONCILE_REQUIRED');self.assertEqual(self.calls.count('publish'),1)
  self.assertNotIn('hold',self.calls)
 def test_stop_timeout_retains_hold_and_never_starts_backup_or_switch(self):
  self.fail=('timeout','stop')
  with self.assertRaisesRegex(Exception,'EXECUTION_UNCERTAIN'):self.coordinate()
  self.assertEqual(self.coordinate()['status'],'UNKNOWN_RECONCILE_REQUIRED');self.assertEqual(self.calls.count('stop'),1)
  self.assertNotIn('backup',self.calls);self.assertNotIn('switch',self.calls)
 def test_rds_lost_response_reconciles_original_job_without_second_create(self):
  self.fail=('lost-response','rds-backup')
  with self.assertRaisesRegex(Exception,'EXECUTION_UNCERTAIN'):self.coordinate()
  self.assertTrue((self.root/'provider-effect-rds-backup.json').exists())
  self.assertEqual(sum(op=='CreateBackup'for op,_ in self.rds.p.calls),1)
  self.assertEqual(self.coordinate()['status'],'UNKNOWN_RECONCILE_REQUIRED')
  result=self.coordinate('reconcile');self.assertEqual(result['status'],'NOT_STARTED');self.assertEqual(result['stage'],'switch-stage')
  self.fail=None;self.assertEqual(self.coordinate()['status'],'WAITING_FOR_WRITER_APPROVAL')
  self.approve();self.assertEqual(self.coordinate()['status'],'CHAIN_COMPLETED')
  self.assertEqual(sum(op=='CreateBackup'for op,_ in self.rds.p.calls),1)
  self.assertEqual(self.calls.count('rds-backup'),1)
 def test_a5_wrong_generation_blocks_before_clear_or_business(self):
  self.assertEqual(self.coordinate()['status'],'WAITING_FOR_WRITER_APPROVAL');self.approve()
  base='/etc/workspacex-cn/writer-resume-approvals/'
  pointer=base+'by-release/'+self.release+'.json';old=r.e.decode(self.virtual[pointer])['approvalSha256']
  value=r.e.decode(self.virtual[base+old+'.json']);value['holdGeneration']='wrong-generation'
  raw=r.e.encode(value);pin=r.e.digest(raw);self.virtual[base+pin+'.json']=raw;self.virtual[pointer]=r.e.encode({'approvalSha256':pin})
  with self.assertRaisesRegex(ValueError,'A5_HOLD_GENERATION'):self.coordinate()
  self.assertNotIn('clear-hold',self.calls);self.assertNotIn('observe',self.calls)
 def test_a5_wait_does_not_reset_original_release_clock(self):
  self.assertEqual(self.coordinate()['status'],'WAITING_FOR_WRITER_APPROVAL');self.approve()
  expired=r.e.instant(self.identity['deadlineAt'])+dt.timedelta(seconds=1)
  with self.assertRaisesRegex(Exception,'RELEASE_DEADLINE'):
   d.coordinate(self.release,self.a,self.router,executor=r.e.entry,clock=lambda:expired)
  self.assertEqual(self.calls,list(r.e.STAGES[:15]))

if __name__=='__main__':unittest.main()
