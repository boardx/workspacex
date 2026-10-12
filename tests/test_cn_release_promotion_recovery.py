"""Actual no-replace rename/crash and canonical readback; no cloud or Docker.

Fixture ownership/ancestry is adapted to a developer Mac. On Darwin only the
Linux syscall name is mapped to the actual kernel renameatx_np NOREPLACE flag.
Original seven ZIPs/five tars and the canonical verifier subprocess are real.
"""
import copy,ctypes,datetime as dt,importlib.util,json,os,stat,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
import test_cn_release_acquire_observer as base
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('recovery_delegation',ROOT/'scripts/cn-release-acquire-delegation.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)

class RecoveryTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):base.ObserverTests.setUpClass()
 @classmethod
 def tearDownClass(cls):base.ObserverTests.tearDownClass()
 setUp=base.ObserverTests.setUp

 def prepared(self):
  self.original.joinpath('promoted-receipt.json').unlink()
  os.rename(self.inbox,self.original/'bundle')
  ns={'__name__':'fixture','CONFIG':self.config};exec(compile((ROOT/'.harness/scripts/vm/cn-runtime-continuation/acquire/consumer.py').read_bytes(),'consumer','exec'),ns)
  ns.update(INBOX=self.state/'candidate-inbox',RUNTIME=self.state/'runtime');self.consumer=ns
  result=dict(kind='cn-hk-consumed-revalidated-bundle-v1',root=str(self.original),bundle=str(self.original/'bundle'),originalZipsPreserved=True,proofGenerated=False,proofSha256=self.f.r['inputs']['proof'],policySha256=self.f.r['inputs']['policy'],expiresAt=json.loads(self.f.inputs['proof'])['expiresAt'],sourceRevision=self.f.r['sourceRevision'],controlRevision=self.f.r['controlRevision'],images=json.loads(self.f.inputs['set'])['images'],cloudWrites=0,publicationExecuted=False,productionReady=False,finishedAt=dt.datetime.now(dt.timezone.utc).isoformat())
  ns['write_receipt'](self.original/'receipt.json',result)
  result['storageAdmission']={'admitted':True};self.result=result
  self.expected=(json.dumps({**result,'bundle':str(self.inbox),'promotedToExactPublisherInbox':True},sort_keys=True)+'\n').encode()
  real_lstat=Path.lstat
  def owner(path,*args,**kwargs):
   s=real_lstat(path,*args,**kwargs);values={k:getattr(s,k)for k in dir(s)if k.startswith('st_')};values.update(st_uid=0,st_gid=0)
   if path!=self.root and self.root not in path.parents:values['st_mode']=stat.S_IFDIR|0o755
   return types.SimpleNamespace(**values)
  p=patch.object(Path,'lstat',owner);p.start();self.addCleanup(p.stop)
  libc=ctypes.CDLL(None,use_errno=True)
  native=libc.renameat2 if sys.platform=='linux' else libc.renameatx_np
  native.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];native.restype=ctypes.c_int
  class Rename:
   def __call__(self,*args):
    return native(*args[:-1],1 if sys.platform=='linux' else 4)
  p=patch.object(ctypes,'CDLL',return_value=types.SimpleNamespace(renameat2=Rename()));p.start();self.addCleanup(p.stop)

 def promote(self):return self.consumer['promote_verified'](self.original,self.result,lambda:None)
 def crash(self,cut=None):
  self.prepared();pid=os.fork()
  if pid==0:
   try:
    self.promote()
    if cut is not None:
     data=b''if cut=='empty'else self.expected[:-1]if cut=='newline'else self.expected[:len(self.expected)//2]
     fd=os.open(self.original/'promoted-receipt.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
     try:
      if data:assert os.write(fd,data)==len(data)
      os.fsync(fd)
     finally:os.close(fd)
     fd=os.open(self.original,os.O_RDONLY|os.O_DIRECTORY)
     try:os.fsync(fd)
     finally:os.close(fd)
    os._exit(73)  # After rename/fsync and interrupted original receipt write.
   except BaseException:os._exit(74)
  done,status=os.waitpid(pid,0);self.assertEqual(done,pid);self.assertEqual(os.WEXITSTATUS(status),73)
  self.assertTrue(self.inbox.exists());self.assertFalse((self.original/'bundle').exists());self.assertEqual((self.original/'promoted-receipt.json').exists(),cut is not None)

 def test_actual_process_exit_after_rename_recovers_exact_bytes_readonly(self):
  self.crash();before={str(p):p.read_bytes()for p in self.state.rglob('*')if p.is_file()}
  observed=base.o.parse(base.o.observe(self.request_sha));recovered=base.o.recover_receipt(self.request_sha)
  self.assertEqual(recovered,self.expected);self.assertTrue(observed['runtimeReceiptRecovered']);self.assertEqual(observed['runtimeReceiptSha256'],base.o.sha(self.expected));self.assertTrue(base.o.verify(base.o.observe(self.request_sha),self.manifest,None,'reconcile',self.request_sha))
  self.assertEqual(before,{str(p):p.read_bytes()for p in self.state.rglob('*')if p.is_file()});self.assertFalse((self.original/'promoted-receipt.json').exists())
  self.assertEqual(base.o.recover_receipt(self.request_sha),recovered)

 def test_no_repromotion_or_download_on_existing_inbox(self):
  self.crash()
  with self.assertRaises((AssertionError,FileNotFoundError)):self.promote()
  self.assertEqual(base.o.recover_receipt(self.request_sha),self.expected)

 def test_actual_lock_contention_creates_no_intent_or_rename(self):
  import fcntl
  self.prepared();fd=os.open(self.state/'runtime/release.lock',os.O_RDONLY)
  try:
   fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(BlockingIOError):self.promote()
   self.assertFalse((self.original/'promotion-intent.json').exists());self.assertFalse(self.inbox.exists());self.assertTrue((self.original/'bundle').exists())
  finally:os.close(fd)

 def test_prepare_without_rename_is_never_success(self):
  self.prepared();self.consumer['ctypes']=None
  class RejectRename:
   def __call__(self,*args):return -1
  with patch.object(ctypes,'CDLL',return_value=types.SimpleNamespace(renameat2=RejectRename())),self.assertRaises(AssertionError):self.promote()
  self.assertTrue((self.original/'promotion-intent.json').exists());self.assertFalse(self.inbox.exists())
  with self.assertRaises(FileNotFoundError):base.o.recover_receipt(self.request_sha)

 def test_wrong_intent_original_receipt_tar_and_ttl_reject(self):
  self.crash();intent=self.original/'promotion-intent.json';original=intent.read_bytes();v=json.loads(original)
  for key,value in (('target','/tmp/unapproved'),('finalReceiptSha256','0'*64),('prePromotionReceiptSha256','0'*64),('kind','other')):
   with self.subTest(key=key):
    intent.write_bytes(base.o.encode({**v,key:value}))
    with self.assertRaises(ValueError):base.o.recover_receipt(self.request_sha)
    intent.write_bytes(original)
  for path in (self.original/'receipt.json',self.inbox/'api.tar',self.inbox/'revalidation.json'):
   raw=path.read_bytes();path.write_bytes(raw+b'x')
   with self.assertRaises(ValueError):base.o.recover_receipt(self.request_sha)
   path.write_bytes(raw)
  changed=copy.deepcopy(v);changed['receipt']['expiresAt']='2000-01-01T00:00:00Z'
  before=(json.dumps({k:x for k,x in changed['receipt'].items()if k!='storageAdmission'},sort_keys=True)+'\n').encode();(self.original/'receipt.json').write_bytes(before);changed['prePromotionReceiptSha256']=base.o.sha(before)
  intent.write_bytes(base.o.encode(changed))
  with self.assertRaisesRegex(ValueError,'PROMOTION_RECOVERY_EXPIRED'):base.o.recover_receipt(self.request_sha)

 def test_recovery_retains_request_deadline_and_observer_pin(self):
  self.crash();approved=self.approvals/self.request_sha/'request.json';raw=approved.read_bytes();approved.write_bytes(raw+b' ')
  with self.assertRaises(ValueError):base.o.recover_receipt(self.request_sha)
  approved.write_bytes(raw);future=dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)
  class Clock:
   @staticmethod
   def now(zone):return future
   fromisoformat=dt.datetime.fromisoformat
  with patch.object(base.o.dt,'datetime',Clock),self.assertRaisesRegex(ValueError,'OBSERVATION_DEADLINE'):base.o.recover_receipt(self.request_sha)

 def test_final_receipt_normal_path_matches_prepared_recovery(self):
  self.prepared();self.promote();(self.original/'promoted-receipt.json').write_bytes(self.expected);(self.original/'promoted-receipt.json').chmod(0o600)
  self.assertEqual(base.o.recover_receipt(self.request_sha),self.expected);self.assertNotIn('runtimeReceiptRecovered',base.o.parse(base.o.observe(self.request_sha)))

 def test_delegation_pinned_recovery_calls_complete_observer_without_writes(self):
  self.crash();control=self.root/'recover-control';(control/'scripts').mkdir(parents=True)
  # Pinned fixture bridge adapts module constants only; all reads and canonical
  # validation run in the actual observer. Production uses its exact root script.
  code=b'from test_cn_release_acquire_observer import o\ndef recover_receipt(request_sha):return o.recover_receipt(request_sha)\n'
  (control/'scripts/cn-release-acquire-observer.py').write_bytes(code)
  release={'acquire':{'requests':{'consume':self.f.r}},'codeFiles':{'scripts/cn-release-acquire-observer.py':d.sha(code)}}
  with patch.object(d,'STATE',self.state):
   result=d.consume_receipt(release,control,reader=lambda p,maximum:p.read_bytes());self.assertEqual(result,self.expected)
   release['codeFiles']['scripts/cn-release-acquire-observer.py']='0'*64
   with self.assertRaisesRegex(ValueError,'CONSUME_RECOVERY_OBSERVER_HASH'):d.consume_receipt(release,control,reader=lambda p,maximum:p.read_bytes())
  self.assertFalse((self.original/'promoted-receipt.json').exists())

 def test_legacy_partial_state_never_selects_a_new_consumer(self):
  release={'acquire':{'requests':{'consume':self.f.r}}};(self.original/'promoted-receipt.json').unlink()
  with patch.object(d,'STATE',self.state),self.assertRaisesRegex(ValueError,'CONSUME_PARTIAL_RECONCILE_NO_RETRY'):d.consume_receipt(release,self.root,reader=lambda p,maximum:p.read_bytes())

 def test_source_bundle_presence_and_intent_mutation_during_validation_reject(self):
  self.crash();(self.original/'bundle').mkdir()
  with self.assertRaisesRegex(ValueError,'PROMOTION_SOURCE_STILL_PRESENT'):base.o.recover_receipt(self.request_sha)
  (self.original/'bundle').rmdir();original=base.o.subprocess.run
  def changed(*args,**kwargs):
   result=original(*args,**kwargs);path=self.original/'promotion-intent.json';path.write_bytes(path.read_bytes()+b' ');return result
  with patch.object(base.o.subprocess,'run',side_effect=changed),self.assertRaisesRegex(ValueError,'FILE_CHANGED_DURING_OBSERVATION'):base.o.recover_receipt(self.request_sha)

 def test_intent_cannot_extend_original_canonical_expiry(self):
  self.crash();path=self.original/'promotion-intent.json';v=json.loads(path.read_bytes());v['receipt']['expiresAt']=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=2)).isoformat()
  before=(json.dumps({k:x for k,x in v['receipt'].items()if k!='storageAdmission'},sort_keys=True)+'\n').encode();(self.original/'receipt.json').write_bytes(before);v['prePromotionReceiptSha256']=base.o.sha(before)
  final={**v['receipt'],'bundle':str(self.inbox),'promotedToExactPublisherInbox':True};v['finalReceiptSha256']=base.o.sha((json.dumps(final,sort_keys=True)+'\n').encode());path.write_bytes(base.o.encode(v))
  with self.assertRaisesRegex(ValueError,'PROMOTION_RECOVERY_PROOF_EXPIRY'):base.o.recover_receipt(self.request_sha)

 def router_recovery(self,cut=None):
  self.crash(cut);partial_before=(self.original/'promoted-receipt.json').read_bytes()if cut is not None else None;control=self.root/'route-control';(control/'scripts').mkdir(parents=True)
  code=b'from test_cn_release_acquire_observer import o\ndef recover_receipt(request_sha):return o.recover_receipt(request_sha)\n';(control/'scripts/cn-release-acquire-observer.py').write_bytes(code)
  spec=importlib.util.spec_from_file_location('recovery_router',ROOT/'scripts/cn-release-stage-router.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
  request={'inputs':{'proof':self.f.r['inputs']['proof']}};release={'acquire':{'requests':{'consume':self.f.r,'publication':request}},'codeFiles':{'scripts/cn-release-acquire-observer.py':d.sha(code)}}
  router=object.__new__(r.Router);router.base=self.root/'route-generated';router.release='a'*64;router.a=release;router.attempt='runtime-attempt';router.raw=b'approved';router.modules={'acquire':d}
  inputs=self.root/'route-inputs'/router.release;inputs.mkdir(parents=True);(inputs/'proof.json').write_bytes(self.f.inputs['proof'])
  journal=self.state/router.attempt;journal.mkdir();request_sha='b'*64;packages=self.root/'route-packages';(packages/request_sha).mkdir(parents=True)
  for suffix,value in [('receipt',{'requestSha256':request_sha}),('evidence',{'runtimeReceiptSha256':d.sha(self.expected)}),('terminal-observation',{})]:(journal/('00-consume.'+suffix+'.json')).write_bytes(d.encode(value))
  (packages/request_sha/'manifest.json').write_bytes(b'{}');consume=router.base/'acquire/consume';consume.mkdir(parents=True);(consume/'parameters.json').write_bytes(b'{}');(consume/'delegation.json').write_bytes(b'{}')
  captured=[]
  def generation(raw,phase,inputs,root,repo,out,receipt,**kwargs):
   captured.append((phase,receipt));self.assertEqual(receipt,self.expected);self.assertEqual(set(kwargs['consume_completion']),{'manifest','receipt','evidence','terminalObservation','parameters','delegation'});return {'interfaceReached':True}
  # Only generation after routing is intercepted. Actual Router.acquire,
  # pinned recovery module, all ZIP/tar hashes and canonical child run unchanged.
  with patch.object(d,'STATE',self.state),patch.object(r,'ROOT',control),patch.object(r,'INPUTS',inputs.parent),patch.object(r.e,'STATE',self.state),patch.object(r.e,'REQUESTS',packages),patch.object(r.e,'read',lambda p,*args:p.read_bytes()),patch.object(d,'derive',side_effect=generation):
   folder,result=router.acquire('publication')
  self.assertEqual(captured,[('publication',self.expected)]);self.assertTrue(result['interfaceReached']);self.assertEqual((self.original/'promoted-receipt.json').exists(),cut is not None)
  if cut is not None:self.assertEqual((self.original/'promoted-receipt.json').read_bytes(),partial_before)
 def check_partial_recovery(self,cut):
  self.crash(cut);path=self.original/'promoted-receipt.json';before=path.read_bytes();signature=base.o.signature(path.stat())
  result=base.o.recover_receipt(self.request_sha);self.assertEqual(result,self.expected)
  observed=base.o.parse(base.o.observe(self.request_sha));self.assertTrue(observed['runtimeReceiptRecovered']);self.assertEqual(observed['runtimeReceiptSha256'],base.o.sha(self.expected))
  self.assertEqual(path.read_bytes(),before);self.assertEqual(base.o.signature(path.stat()),signature);self.assertFalse(observed['writesPerformed'])

 def test_actual_child_exit_with_empty_receipt_recovers_no_overwrite(self):
  self.check_partial_recovery('empty')

 def test_actual_child_exit_with_half_receipt_recovers_no_overwrite(self):
  self.check_partial_recovery('middle')

 def test_actual_child_exit_with_final_newline_missing_recovers_exact_bytes(self):
  self.check_partial_recovery('newline')

 def test_nonprefix_trailing_bytes_or_different_valid_receipt_reject(self):
  self.crash('middle');path=self.original/'promoted-receipt.json';different=json.loads(self.expected);different['images']={}
  for raw in (b'x'+self.expected[1:100],self.expected+b'x',base.o.encode(different),base.o.encode(json.loads(self.expected))):
   with self.subTest(raw=raw[:30]):
    path.write_bytes(raw);before=path.read_bytes()
    with self.assertRaisesRegex(ValueError,'PROMOTION_PARTIAL_RECEIPT_MISMATCH'):base.o.recover_receipt(self.request_sha)
    self.assertEqual(path.read_bytes(),before)

 def test_partial_prefix_requires_intent_and_actual_lock(self):
  import fcntl
  self.crash('empty');fd=os.open(self.state/'runtime/release.lock',os.O_RDONLY)
  try:
   fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(BlockingIOError):base.o.recover_receipt(self.request_sha)
  finally:os.close(fd)
  (self.original/'promotion-intent.json').unlink()
  with self.assertRaises(ValueError):base.o.recover_receipt(self.request_sha)

 def test_partial_file_changed_during_canonical_read_is_not_admitted(self):
  self.crash('middle');original=base.o.subprocess.run
  def changed(*args,**kwargs):
   result=original(*args,**kwargs);path=self.original/'promoted-receipt.json';path.write_bytes(b'wrong');return result
  with patch.object(base.o.subprocess,'run',side_effect=changed),self.assertRaisesRegex(ValueError,'FILE_CHANGED_DURING_OBSERVATION'):base.o.recover_receipt(self.request_sha)

 def test_partial_prefix_cannot_extend_request_deadline(self):
  self.crash('middle');future=dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)
  class Clock:
   @staticmethod
   def now(zone):return future
   fromisoformat=dt.datetime.fromisoformat
  with patch.object(base.o.dt,'datetime',Clock),self.assertRaisesRegex(ValueError,'OBSERVATION_DEADLINE'):base.o.recover_receipt(self.request_sha)
 def test_actual_router_publication_route_uses_physical_recovery_not_redownload(self):
  self.router_recovery()

 def test_actual_router_empty_receipt_calls_full_recovery(self):
  self.router_recovery('empty')

 def test_actual_router_partial_receipt_calls_full_recovery(self):
  self.router_recovery('middle')

 def baseline_rejection(self,cut,code):
  import subprocess
  self.crash(cut)
  original=subprocess.check_output(['git','show','8c5d4eac8dd9d44b9837fc38a0e754b54ddda6cc:scripts/cn-release-acquire-observer.py'],cwd=ROOT)
  script=self.root/'baseline-observer.py';script.write_bytes(original);script.chmod(0o700)
  ns={'__name__':'baseline_observer','__file__':str(script)};exec(compile(original,str(script),'exec'),ns)
  ns.update(STATE=self.state,CODE=self.code,APPROVALS=self.approvals,directory=base.o.directory)
  approval_path=self.approvals/self.request_sha/'approval.json';approval=json.loads(approval_path.read_bytes());approval['observerSha256']=base.o.sha(original);approval_path.write_bytes(base.o.encode(approval))
  with self.assertRaisesRegex(ValueError,code):ns['observe'](self.request_sha)

 def test_original_exact_base_rejects_actual_empty_receipt(self):
  self.baseline_rejection('empty','UNTRUSTED_FILE')

 def test_original_exact_base_rejects_actual_partial_receipt(self):
  self.baseline_rejection('middle','Unterminated|Expecting')
if __name__=='__main__':unittest.main()
