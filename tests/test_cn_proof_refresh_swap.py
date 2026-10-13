import base64,datetime as dt,importlib.util,json,os,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('swap',HERE/'swap-approval.py' if (HERE/'swap-approval.py').exists() else HERE.parent/'scripts/swap-cn-proof-approval.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Swap(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory(dir=HERE);self.addCleanup(self.t.cleanup);self.base=Path(self.t.name);self.lock=self.base/'release.lock';m.put(self.lock,b'lock')
  self.root=self.base/('a'*40)/'attempt';self.root.mkdir(parents=True,mode=0o700);(self.root/'canonical-source').mkdir(mode=0o700)
  now=dt.datetime.now(dt.timezone.utc);old={'sourceRevision':'a'*40,'attemptId':'attempt','publishAuthorized':True,'issuedAt':now.isoformat(),'expiresAt':(now+dt.timedelta(minutes=20)).isoformat(),'revalidationRawSha256':'old'}
  for name in m.SIX:m.put(self.root/name,json.dumps(old).encode()if name=='approval.json'else name.encode())
  m.put(self.root/'canonical-source/module.js',b'unchanged');m.put(self.root/'node',b'binary',0o700)
  data={n:m.read(self.root/n,os.getuid())[0]for n in m.SIX};data['approval.json']=json.dumps({**old,'revalidationRawSha256':'new'}).encode();data['candidate-revalidation.json']=b'newproof'
  self.c={'source':'a'*40,'attempt':'attempt','generation':'new','oldTree':m.inventory(self.root,os.getuid()),'newFiles':{k:{'sha256':m.sha(v),'base64':base64.b64encode(v).decode()}for k,v in data.items()}}
 def swap(self,exchange=None,admit=lambda *x:None):
  def fake(a,b):
   tmp=a.with_name('test-temp');os.rename(a,tmp);os.rename(b,a);os.rename(tmp,b)
  return m.swap(self.c,base=self.base,lockpath=self.lock,owner=os.getuid(),exchanger=exchange or fake,admit=admit)
 def test_preserves_old_tree_and_no_canonical_changes(self):
  v=self.swap();self.assertTrue(v['exchanged']);history=self.root.with_name('attempt.history-new')
  self.assertEqual(m.inventory(history,os.getuid()),self.c['oldTree']);self.assertEqual((self.root/'canonical-source/module.js').read_bytes(),b'unchanged')
  with self.assertRaises(ValueError):self.swap()
 def test_post_exchange_failure_is_observable_no_retry(self):
  def completed_then_lost(a,b):
   tmp=a.with_name('fixture-temp');os.rename(a,tmp);os.rename(b,a);os.rename(tmp,b);raise TimeoutError()
  with self.assertRaises(TimeoutError):self.swap(exchange=completed_then_lost)
  self.assertEqual(m.inventory(self.root.with_name('attempt.history-new'),os.getuid()),self.c['oldTree'])
  self.assertTrue(self.root.with_name('attempt.swap-new.json').exists())
  with self.assertRaisesRegex(ValueError,'OLD_TREE_CAS'):self.swap()
 def test_cas_drift_rejects_before_history(self):
  (self.root/'node').write_bytes(b'drift')
  with self.assertRaisesRegex(ValueError,'OLD_TREE_CAS'):self.swap()
  self.assertFalse(self.root.with_name('attempt.history-new').exists())
 def test_admission_failure_prevents_swap(self):
  def reject(*x):raise ValueError('TAR_HASH')
  with self.assertRaisesRegex(ValueError,'TAR_HASH'):self.swap(admit=reject)
  self.assertEqual(m.inventory(self.root,os.getuid()),self.c['oldTree'])
 def test_unknown_exchange_preserves_journal_and_blocks_retry(self):
  def unknown(a,b):raise TimeoutError()
  with self.assertRaises(TimeoutError):self.swap(exchange=unknown)
  self.assertTrue(self.root.with_name('attempt.swap-new.json').exists())
  with self.assertRaisesRegex(ValueError,'GENERATION_EXISTS'):self.swap()
if __name__=='__main__':unittest.main()
