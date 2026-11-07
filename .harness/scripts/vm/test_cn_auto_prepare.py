import datetime,hashlib,importlib.util,json,os,pathlib,sys,tempfile,unittest
spec=importlib.util.spec_from_file_location('cn_auto_prepare',pathlib.Path(__file__).with_name('cn_auto_prepare.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class DispatcherTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);self.root.chmod(0o700)
  self.request={'identity':{'sourceRevision':'a'*40,'baselineSourceRevision':'b'*40,'baselineSha256':'c'*64,'release':'v1.0.0','attemptId':'gha-test'},'images':{k:'sha256:'+'d'*64 for k in ('api','web','agent','sandbox')},'migrationPlanSha256':'e'*64,'dependencies':{'manifest':'f'*64}}
  self.policy={'schemaVersion':1,'kind':'cn-auto-preparation-host-policy','toolRevision':'a'*40,'provider':{'path':m.PROVIDER,'sha256':hashlib.sha256(b'controlled provider bytes').hexdigest()},'environment':{'testOnly':True},'timeouts':{k:10 for k in m.STAGES}}
  self.calls=[]
 def read(self,path,mode=0o600):return b'controlled provider bytes' if path==m.PROVIDER else json.dumps(self.policy).encode()
 def provider_run(self,argv,payload,timeout):
  self.calls.append((argv,payload,timeout));now=datetime.datetime.now(datetime.timezone.utc)
  p=self.root/('a'*40)/'gha-test'/'raw.json';p.write_bytes(b'controlled actual artifact');p.chmod(0o600)
  return json.dumps({'schemaVersion':1,'kind':'cn-auto-preparation-stage','stage':'backup',**self.request,'issuedAt':now.isoformat(),'expiresAt':(now+datetime.timedelta(minutes=10)).isoformat(),'facts':{'controlledTestOutput':True},'refs':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}]}).encode()
 def dispatch(self,**kwargs):return m.dispatch(self.request,'backup',read=self.read,run=kwargs.pop('run',self.provider_run),root=str(self.root),**kwargs)
 def test_records_exact_raw_bytes_as_private_receipt_and_intent(self):
  result=self.dispatch();p=pathlib.Path(result['path']);self.assertEqual(p.stat().st_mode&0o777,0o600);self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),result['sha256']);self.assertTrue(p.with_name('backup.intent.json').is_file());self.assertEqual(self.calls[0][0],['/usr/bin/python3','-I','-S','-B',m.PROVIDER,'--stage','backup'])
 def test_no_policy_never_runs_provider(self):
  def missing(*args):raise FileNotFoundError()
  with self.assertRaises(FileNotFoundError):m.dispatch(self.request,'backup',read=missing,run=self.provider_run,root=str(self.root))
  self.assertFalse(self.calls)
 def test_code_drift_never_runs_provider(self):
  self.policy['provider']['sha256']='0'*64
  with self.assertRaisesRegex(m.NotReady,'PROVIDER_SOURCE'):self.dispatch()
  self.assertFalse(self.calls)
 def test_caller_commands_and_invalid_identity_refused(self):
  self.request['command']='echo passed'
  with self.assertRaisesRegex(m.NotReady,'REQUEST'):self.dispatch()
  self.assertFalse(self.calls)
 def test_existing_stage_is_not_reexecuted(self):
  self.dispatch()
  with self.assertRaisesRegex(m.NotReady,'EXISTING_STAGE'):self.dispatch()
  self.assertEqual(len(self.calls),1)
 def test_unknown_outcome_requires_reconciliation(self):
  def lost(*args):self.calls.append('lost');raise m.NotReady('PROVIDER_TIMEOUT_JOINED')
  with self.assertRaisesRegex(m.NotReady,'TIMEOUT'):self.dispatch(run=lost)
  with self.assertRaisesRegex(m.NotReady,'EXISTING_INTENT'):self.dispatch()
  self.assertEqual(self.calls,['lost'])
 def test_literal_passed_and_cross_attempt_are_not_evidence(self):
  with self.assertRaises((ValueError,m.NotReady)):self.dispatch(run=lambda *args:b'"passed"')
  self.assertFalse((self.root/('a'*40)/'gha-test'/'backup.json').exists())
 def test_cross_attempt_output_is_refused(self):
  def changed(*args):
   value=json.loads(self.provider_run(*args));value['identity']['attemptId']='another';return json.dumps(value).encode()
  with self.assertRaisesRegex(m.NotReady,'PROVIDER_IDENTITY'):self.dispatch(run=changed)
  self.assertFalse((self.root/('a'*40)/'gha-test'/'backup.json').exists())
 def test_rehashes_actual_artifact_and_refuses_post_producer_tampering(self):
  def changed(*args):
   raw=self.provider_run(*args);p=pathlib.Path(json.loads(raw)['refs'][0]['path']);p.write_bytes(b'tampered after producer');return raw
  with self.assertRaisesRegex(m.NotReady,'RAW_REFERENCE_HASH'):self.dispatch(run=changed)
  self.assertFalse((self.root/('a'*40)/'gha-test'/'backup.json').exists())
 def test_stream_hashes_large_ciphertext_and_rejects_symlink_and_cross_attempt(self):
  p=self.root/'large.dump.cms';p.write_bytes(b'x'*(18*1024*1024));p.chmod(0o600);ref={'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
  m.verify_stage_refs([ref],self.root)
  link=self.root/'symlink.dump.cms';link.symlink_to(p)
  with self.assertRaises(OSError):m.verify_stage_refs([{**ref,'path':str(link)}],self.root)
  with self.assertRaisesRegex(m.NotReady,'RAW_REFERENCE_SCOPE'):m.verify_stage_refs([ref],self.root/'another-attempt')
 def with_fd9(self,action):
  fd=os.open(self.root/'lock',os.O_CREAT|os.O_RDWR,0o600)
  try:
   try:saved=os.dup(9)
   except OSError:saved=None
   os.dup2(fd,9)
   try:return action()
   finally:
    if saved is None:os.close(9)
    else:os.dup2(saved,9);os.close(saved)
  finally:os.close(fd)
 def test_actual_process_timeout_is_killed_and_joined(self):
  # A real owned child process, not a simulated timeout result.
  def action():
   with self.assertRaisesRegex(m.NotReady,'PROVIDER_TIMEOUT_JOINED'):m.bounded([sys.executable,'-c','import time;time.sleep(10)'],{},0.05)
   self.assertIsNotNone(m.ACTIVE.returncode)
  self.with_fd9(action)
 def test_actual_backup_artifact_can_exceed_seventeen_megabytes(self):
  target=self.root/'ciphertext-sized-fixture.bin'
  script="import sys;f=open(sys.argv[1],'wb');f.write(b'x'*(18*1024*1024));f.close();print('artifact-written')"
  output=self.with_fd9(lambda:m.bounded([sys.executable,'-c',script,str(target)],{},5))
  self.assertEqual(output,b'artifact-written\n');self.assertEqual(target.stat().st_size,18*1024*1024)
 def test_actual_stdout_flood_is_still_bounded(self):
  def action():
   with self.assertRaisesRegex(m.NotReady,'PROVIDER_OUTPUT_BOUND'):m.bounded([sys.executable,'-c',"import sys;sys.stdout.buffer.write(b'x'*(20*1024*1024));sys.stdout.buffer.flush()"],{},5)
  self.with_fd9(action)
 def test_output_directory_symlink_is_rejected_before_provider(self):
  (self.root/('a'*40)).symlink_to(self.root,target_is_directory=True)
  with self.assertRaisesRegex(m.NotReady,'OUTPUT_DIRECTORY'):self.dispatch()
  self.assertFalse(self.calls)
if __name__=='__main__':unittest.main()
