"""Durable real-files/real-subprocess recovery orchestration, no cloud or Docker."""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
def load(path,name):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
d=load('scripts/cn-release-recovery-driver.py','recovery_driver');e=load('.harness/scripts/vm/cn-release-advance.py','recovery_test_entry')
class Ops:
 def __init__(self,root):self.root=root;self.writer=False;self.fail=None;self.expired=False;self.clock_checks=0
 def window(self):
  self.clock_checks+=1
  if self.expired:raise ValueError('RECOVERY_EXPIRED')
 def remaining(self):return 5
 def writer_available(self):return self.writer
 def prepare(self,stage):pass
 def command(self,stage):
  code="from pathlib import Path;p=Path("+repr(str(self.root/(stage+'.called')))+");p.open('x').write('actual subprocess')"
  if self.fail==stage:code+=";raise SystemExit(3)"
  import shlex
  return ('#!/bin/bash\nexec '+shlex.join([sys.executable,'-I','-c',code])+'\n').encode()
 def observe(self,stage):
  if self.fail==stage:raise ValueError('REMOTE_TERMINAL_UNKNOWN')
  if not (self.root/(stage+'.called')).exists():raise ValueError('ACTUAL_ACTION_MISSING')
  return d.enc({'stage':stage,'actualMarker':(self.root/(stage+'.called')).read_text()})
 def final(self):
  for stage in d.STAGES:self.observe(stage)
  return {'kind':'fixture-final','baselineBusinessAccepted':True,'holdCleared':True,'externalWritesTerminal':True,'dataRestored':False}
class Durable(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.addCleanup(self.t.cleanup);self.root=Path(self.t.name);self.root.chmod(0o700)
  self.ops=Ops(self.root);self.authority={'releaseSha256':'a'*64,'recoveryApprovalSha256':'b'*64,'identity':{'requestedAt':'original','deadlineAt':'unchanged'}}
  self.addCleanup(patch.stopall);patch.object(e,'OWNER',os.getuid()).start();patch.object(e,'CGROUP_BASE',None).start()
  # Mac parent /var is a symlink; only the fixture trust root is admitted.
  def directory(path):
   p=Path(path);d.need(p==self.root or self.root in p.parents,'FIXTURE_ROOT');info=p.lstat();d.need(info.st_uid==os.getuid()and not info.st_mode&0o077,'FIXTURE_PRIVATE')
  patch.object(e,'directory',directory).start()
 def go(self,mode='run'):return d.coordinate(self.root,self.authority,self.ops,e,mode)
 def test_wait_before_clear_intent_then_resume_without_second_runtime(self):
  self.assertEqual(self.go()['status'],'WAITING_FOR_BASELINE_WRITER_APPROVAL');self.assertFalse((self.root/'01-clear.intent.json').exists())
  self.ops.writer=True;result=self.go();self.assertEqual(result['status'],'RECOVERY_VERIFIED');self.assertTrue((self.root/'business.called').exists());self.assertFalse(result['result']['dataRestored'])
  self.assertEqual(self.go()['finalSha256'],result['finalSha256'])
 def test_unknown_action_never_retries_then_explicit_readonly_reconcile(self):
  self.ops.fail='runtime'
  with self.assertRaisesRegex(ValueError,'UNKNOWN_NO_RETRY'):self.go()
  self.assertEqual(self.go()['status'],'UNKNOWN_RECONCILE_REQUIRED')
  self.ops.fail=None;result=self.go('reconcile');self.assertEqual(result['status'],'RECONCILED');self.assertFalse((self.root/'clear.called').exists())
  self.assertEqual(self.go()['status'],'WAITING_FOR_BASELINE_WRITER_APPROVAL')
 def test_unknown_clear_not_resent_and_no_business_run(self):
  self.ops.writer=True;self.ops.fail='clear'
  with self.assertRaises(ValueError):self.go()
  self.assertEqual(self.go()['stage'],'clear');self.assertFalse((self.root/'business.called').exists())
 def test_business_failure_not_repeated_even_with_fresh_process(self):
  self.ops.writer=True;self.ops.fail='business'
  with self.assertRaises(ValueError):self.go()
  self.ops=Ops(self.root);self.ops.writer=True
  self.assertEqual(self.go()['status'],'UNKNOWN_RECONCILE_REQUIRED')
  self.assertEqual(self.go('reconcile')['stage'],'business')
  self.assertEqual(self.go()['status'],'RECOVERY_VERIFIED')
 def test_missing_pid_journal_is_unknown(self):
  self.ops.fail='runtime'
  with self.assertRaises(ValueError):self.go()
  (self.root/'00-runtime.process.json').unlink()
  with self.assertRaisesRegex(ValueError,'PROCESS_UNPROVEN'):self.go('reconcile')
 def test_modified_checkpoint_or_authority_rejected(self):
  self.go();(self.root/'00-runtime.evidence.json').write_bytes(b'changed')
  with self.assertRaisesRegex(ValueError,'CHECKPOINT_CHANGED'):self.go()
 def test_expiry_cannot_retime_or_clear(self):
  self.go();self.ops.writer=True;self.ops.expired=True
  with self.assertRaisesRegex(ValueError,'EXPIRED'):self.go()
  self.assertFalse((self.root/'01-clear.intent.json').exists());self.assertEqual(self.authority['identity']['deadlineAt'],'unchanged')
 def test_preparation_consuming_deadline_never_creates_intent(self):
  self.ops.prepare=lambda stage:setattr(self.ops,'expired',True)
  with self.assertRaisesRegex(ValueError,'EXPIRED'):self.go()
  self.assertFalse((self.root/'00-runtime.intent.json').exists())
 def test_status_never_creates_intent(self):
  self.assertEqual(self.go('status')['status'],'NOT_STARTED');self.assertEqual(list(self.root.iterdir()),[])
 def test_final_readonly_requires_all_checkpoint_hashes(self):
  self.ops.writer=True;self.go();self.assertTrue(d.sealed_result(self.root,self.authority,self.ops,e)['holdCleared'])
  (self.root/'01-clear.evidence.json').write_bytes(b'{}')
  with self.assertRaisesRegex(ValueError,'CHECKPOINT_CHANGED'):d.sealed_result(self.root,self.authority,self.ops,e)

class SealIntegration(unittest.TestCase):
 def test_real_entry_failed_action_then_readonly_recovery_seal(self):
  import shlex
  with tempfile.TemporaryDirectory(dir=ROOT)as td:
   root=Path(td);root.chmod(0o700);requests=root/'requests';requests.mkdir(mode=0o700);state=root/'state';state.mkdir(mode=0o700);attempt='fixture-recovery';journal=state/attempt;journal.mkdir(mode=0o700)
   clock=dt.datetime.now(dt.timezone.utc);identity={'sourceRevision':'1'*40,'baselineRevision':'2'*40,'controlRevision':'3'*40,'attemptId':attempt,'requestedAt':(clock-dt.timedelta(minutes=5)).isoformat(),'deadlineAt':(clock+dt.timedelta(minutes=20)).isoformat()}
   authority=d.enc({'kind':'fixture-root-authority'});release=d.sha(authority);fresh='b'*64;previous=d.enc({'fixture':'previous stopped-stage admission'});(journal/'06-stop-stage.receipt.json').write_bytes(previous);(journal/'06-stop-stage.receipt.json').chmod(0o600)
   action=b'exit 3\n';observer=b'echo {}\n';verifier=b'def verify(*args): return False\n'
   original={'schemaVersion':1,**identity,'scope':'runtime-only-reviewed-continuation','stage':'stop','previousReceiptSha256':d.sha(previous),'issuedAt':identity['requestedAt'],'expiresAt':identity['deadlineAt'],'timeoutSeconds':3,'actionSha256':d.sha(action),'observerSha256':d.sha(observer),'verifierSha256':d.sha(verifier),'authorizationEvidenceSha256':release};request=d.sha(d.enc(original));pkg=requests/request;pkg.mkdir(mode=0o700)
   def put(p,raw):p.write_bytes(raw);p.chmod(0o600)
   for n,raw in [('manifest.json',d.enc(original)),('action.sh',action),('observe.sh',observer),('verify.py',verifier),('authorization.json',authority)]:put(pkg/n,raw)
   # Dedicated read-only contract fixture. Actual production contract has its
   # independent test below; this runs the real immutable entry package path.
   contract=root/d.CONTRACT;contract.parent.mkdir(mode=0o700)
   result={'baselineBusinessAccepted':True,'holdCleared':True,'externalWritesTerminal':True};resultfile=root/'proven-result.json';put(resultfile,d.enc(result))
   code=('import json,sys\nfrom pathlib import Path\np=Path('+repr(str(resultfile))+')\ndef verify(raw,manifest,previous,mode,*args):\n assert raw==p.read_bytes()\n return {"externalWritesTerminal":True,"safeToRecover":True} if mode=="pre-recovery" else json.loads(raw)\nif __name__=="__main__":sys.stdout.buffer.write(p.read_bytes())\n').encode();put(contract,code)
   a={'identity':identity,'codeFiles':{d.CONTRACT:d.sha(code)}};f={'failedRequestSha256':request,'failedStage':'stop','issuedAt':clock.isoformat(),'expiresAt':(clock+dt.timedelta(minutes=10)).isoformat()}
   with patch.object(e,'REQUESTS',requests),patch.object(e,'STATE',state),patch.object(e,'OWNER',os.getuid()),patch.object(e,'CGROUP_BASE',None),patch.object(d,'ROOT',root):
    with self.assertRaises(e.Rejected):e.entry('advance',request,attempt)
    package=d.prepare_seal(release,fresh,authority,a,f,e);m,files=e.load_package(package['requestSha256'],attempt)
    self.assertEqual(m['recoveryOf'],request);self.assertEqual(m['requestedAt'],identity['requestedAt']);self.assertEqual(files['action.sh'],files['observe.sh'])
    final=e.entry('recover',package['requestSha256'],attempt);self.assertEqual(final['status'],'COMPLETED');self.assertTrue(e.completed_attempt(journal));self.assertFalse(e.entry('recover',package['requestSha256'],attempt)['mutationExecuted'])
 def test_production_contract_final_flags_require_exact_live_readback(self):
  c=load('scripts/cn-release-recovery-contract.py','contract_test');release='a'*64;fresh='b'*64
  identity={'sourceRevision':'1'*40,'baselineRevision':'2'*40,'controlRevision':'3'*40,'attemptId':'fixture','requestedAt':'old','deadlineAt':'unchanged'};f={'failedRequestSha256':'c'*64,'failedStage':'stop','issuedAt':'fresh','expiresAt':'fresh-end'}
  m={**identity,'scope':'runtime-only-reviewed-recovery','recoveryOf':f['failedRequestSha256'],'stage':'stop','authorizationEvidenceSha256':release,'issuedAt':'fresh','expiresAt':'fresh-end','previousReceiptSha256':None}
  raw=d.enc({'fixture':'actual independently checked old business and clear'})
  class D:
   ENTRY='entry';need=staticmethod(d.need);enc=staticmethod(d.enc);sha=staticmethod(d.sha)
   @staticmethod
   def load(*args):return b'',{'identity':identity},b'',f
   @staticmethod
   def seal_payload(*args):return m,{}
   @staticmethod
   def module(*args):
    class E:
     @staticmethod
     def load_package(*args):return {'previousReceiptSha256':None},{}
    return E
  with patch.object(c,'driver',return_value=D),patch.object(c,'observe',return_value=raw):
   self.assertEqual(c.verify(raw,m,None,'recover',release,fresh),{'baselineBusinessAccepted':True,'holdCleared':True,'externalWritesTerminal':True})
   with self.assertRaisesRegex(ValueError,'FINAL_BYTES'):c.verify(b'{}',m,None,'recover',release,fresh)

class ActualAdapterInterface(unittest.TestCase):
 def test_real_writer_output_is_consumed_by_driver_clear_observer(self):
  sys.path.insert(0,str(ROOT/'tests'));import test_cn_release_recovery_writer as fixture
  fixture_case=fixture.RecoveryWriter();fixture_case.setUp()
  try:
   result=fixture_case.run_clear();f=fixture_case.f;s=fixture_case.s;r=fixture_case.r
   f.prepared['recoveryPlan']={'deploymentMarker':'baseline'}
   f.put(s.ETC/'release-recovery-approvals'/(s.sha(f.fraw)+'.json'),f.fraw)
   f.put(s.ETC/'recovery-writer-resume-approvals'/(s.sha(fixture_case.raw)+'.json'),fixture_case.raw)
   f.put(s.VAR/'runtime'/'release.lock',b'')
   class Business:
    @staticmethod
    def state_module(a):return s
    @staticmethod
    def preflight(a):return f.prepared
    @staticmethod
    def recovery_module(a):return r
   ops=d.Operations(f.release,s.sha(f.fraw),f.a,f.f,e)
   with patch.object(d,'VAR',s.VAR),patch.object(d,'ETC',s.ETC),patch.object(d,'module',return_value=Business),patch.object(d,'private',side_effect=f.reader.file),patch.object(s,'Reader',return_value=f.reader),patch.object(s,'invoke',side_effect=f.call):
    raw=ops.observe('clear');self.assertEqual(raw,(fixture_case.out/'recovery-clear-result.json').read_bytes());self.assertEqual(d.parse(raw),result)
  finally:fixture_case.doCleanups()
 def test_production_fixed_argv_matches_existing_runtime_writer_and_business(self):
  import shlex
  release='a'*64;fresh='b'*64;f={'runtimeRoot':'/var/lib/workspacex-cn/runtime/upgrade-f0eb-fixture','originalBindingSha256':'c'*64,'operation':'rollback'};ops=d.Operations(release,fresh,{},f,e);recovery=b'fixed staged recovery'
  with patch.object(d,'private',return_value=recovery):argv=shlex.split(ops.command('runtime').decode().splitlines()[-1])[1:]
  self.assertEqual(argv[-4:],[f['runtimeRoot'],'c'*64,'rollback',d.sha(recovery)])
  self.assertEqual(shlex.split(ops.command('clear').decode().splitlines()[-1])[-4:],['--release-sha256',release,'--recovery-approval-sha256',fresh])
  self.assertEqual(shlex.split(ops.command('business').decode().splitlines()[-1])[-3:],['rollback',release,fresh])

class CliHandoff(unittest.TestCase):
 def test_seal_releases_real_flock_before_original_entry_and_propagates_race(self):
  import fcntl,io,types
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);state=root/'continuation';state.mkdir(mode=0o700);release='a'*64;fresh='b'*64;identity={'attemptId':'fixture'}
   (state/'active-attempt.json').write_bytes(d.enc('fixture'));(state/'active-attempt.json').chmod(0o600)
   generated=root/'release-generated'/release;generated.mkdir(parents=True,mode=0o700)
   called=[];race=[False]
   def entry(mode,request,attempt):
    fd=os.open(state/'entry.lock',os.O_RDWR)
    try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);called.append((mode,request,attempt))
    finally:os.close(fd)
    if race[0]:raise ValueError('ACTUAL_ENTRY_OWNER_CHANGED')
    return {'status':'COMPLETED','fixtureOriginalEntry':True}
   engine=types.SimpleNamespace(STATE=state,directory=lambda p:None,read=lambda p:p.read_bytes(),entry=entry)
   ops=types.SimpleNamespace(window=lambda:None)
   # Actual POSIX uid remains unchanged; use synthetic fstat ownership only for
   # the root CLI bootstrap. Lock acquisition/release is the real OS operation.
   real_fstat=os.fstat
   def rootstat(fd):
    x=real_fstat(fd);return types.SimpleNamespace(st_mode=x.st_mode,st_uid=0,st_nlink=x.st_nlink)
   output=io.TextIOWrapper(io.BytesIO())
   with patch.object(d,'VAR',root),patch.object(d,'load',return_value=(b'authority',{'identity':identity},b'fresh',{})),patch.object(d,'module',return_value=engine),patch.object(d,'Operations',return_value=ops),patch.object(d,'sealed_result',return_value={'proven':True}),patch.object(d,'prepare_seal',return_value={'requestSha256':'c'*64}),patch.object(d.os,'geteuid',return_value=0),patch.object(d.os,'fstat',side_effect=rootstat),patch.object(sys,'argv',['driver','seal',release,fresh]),patch.object(sys,'stdout',output):
    d.main();self.assertEqual(called,[('recover','c'*64,'fixture')]);race[0]=True
    with self.assertRaisesRegex(ValueError,'OWNER_CHANGED'):d.main()

CLI_FIXTURE = r"""
import argparse,inspect,runpy,types
from unittest.mock import patch
import sys,os,tempfile
from pathlib import Path
source=Path(sys.argv[1]);mode=sys.argv[2];scenario=sys.argv[3]
sys.path.insert(0,str(source.parents[1]/'tests'))
import test_cn_release_recovery_driver as fixture
with tempfile.TemporaryDirectory() as td:
 root=Path(td);state=root/'state';state.mkdir(mode=0o700)
 release='a'*64;fresh='b'*64;identity={'attemptId':'fixture'}
 generated=root/'release-generated'/release;generated.mkdir(parents=True,mode=0o700)
 recovery=generated/('recovery-driver-'+fresh)
 if scenario!='ABSENT':recovery.mkdir(mode=0o700)
 (state/'active-attempt.json').write_bytes(fixture.d.enc('fixture'));(state/'active-attempt.json').chmod(0o600)
 ops=fixture.Ops(recovery);ops.writer=scenario=='COMPLETE'
 engine=fixture.e;engine.STATE=state;engine.OWNER=0;engine.CGROUP_BASE=None
 engine.directory=lambda p:None
 if scenario in ('UNKNOWN','RECONCILED'):
  authority={'releaseSha256':release,'recoveryApprovalSha256':fresh,'identity':identity}
  engine.create(recovery/'00-runtime.intent.json',fixture.d.enc({'authority':authority,'stage':'runtime'}))
  if scenario=='RECONCILED':
   engine.create(recovery/'00-runtime.process.json',fixture.d.enc({'authority':authority,'stage':'runtime'}))
   engine.execution_terminal=lambda p:True
   (recovery/'runtime.called').write_text('fixture previously completed action')
 original_fstat=os.fstat
 def rootstat(fd):
  x=original_fstat(fd);values={k:getattr(x,k) for k in dir(x) if k.startswith('st_')};values['st_uid']=0;return types.SimpleNamespace(**values)
 def arguments(parser,*args,**kwargs):
  g=inspect.currentframe().f_back.f_globals
  g.update(VAR=root,load=lambda *a:(b'',{'identity':identity},b'',{}),module=lambda *a:engine,Operations=lambda *a:ops)
  return types.SimpleNamespace(mode=mode,release=release,fresh=fresh)
 with patch.object(argparse.ArgumentParser,'parse_args',arguments),patch.object(os,'geteuid',lambda:0),patch.object(os,'fstat',rootstat):
  runpy.run_path(str(source),run_name='__main__')
"""

class RecoveryActualCli(unittest.TestCase):
 def cli(self,mode,scenario):
  import subprocess
  result=subprocess.run([sys.executable,'-I','-B','-c',CLI_FIXTURE,str(ROOT/'scripts/cn-release-recovery-driver.py'),mode,scenario],capture_output=True,text=True,timeout=15)
  self.assertEqual(result.stderr,'',result.stderr)
  return result.returncode,json.loads(result.stdout)
 def test_nonterminal_run_and_reconcile_are_not_success(self):
  for mode,scenario,status in [('run','WAITING','WAITING_FOR_BASELINE_WRITER_APPROVAL'),('run','UNKNOWN','UNKNOWN_RECONCILE_REQUIRED'),('reconcile','NOT_STARTED','NOT_STARTED'),('reconcile','ABSENT','NOT_STARTED'),('reconcile','RECONCILED','RECONCILED')]:
   with self.subTest(mode=mode,scenario=scenario):
    code,result=self.cli(mode,scenario);self.assertEqual(result['status'],status);self.assertNotEqual(code,0)
    self.assertNotIn('result',result)
 def test_status_incomplete_is_success(self):
  for scenario in ('ABSENT','NOT_STARTED','UNKNOWN'):
   with self.subTest(scenario=scenario):
    code,result=self.cli('status',scenario);self.assertEqual(code,0);self.assertNotIn('result',result)
 def test_verified_recovery_is_success_with_actual_fixture_actions(self):
  code,result=self.cli('run','COMPLETE');self.assertEqual(code,0);self.assertEqual(result['status'],'RECOVERY_VERIFIED');self.assertFalse(result['result']['dataRestored'])

if __name__=='__main__':unittest.main()
