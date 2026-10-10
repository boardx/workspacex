import hashlib,tempfile,unittest,time
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parent))
import clone_quiescence as q
import isolated_rehearsal_test as fixtures
class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(dir=Path('/tmp').resolve());self.root=Path(self.temp.name);self.b=fixtures.BindingTests().manifest();self.b['candidateSha']=q.SOURCE
  self.b['tls']={'sslmode':'disable','approvedException':'aliyun-postgresql-serverless-no-tls','providerSslEvidence':{'targetInstanceId':self.b['targetInstanceId'],'sslEnabled':False,'providerCreatedUtc':self.b['providerCreatedUtc']}}
  self.p=self.payload('check');self.gate=q.Admission(self.b,self.root);self.calls=[]
 def tearDown(self):self.temp.cleanup()
 def ref(self,n,v):
  raw=q.canonical(v);p=self.root/n;p.write_bytes(raw);p.chmod(0o600);return {'path':str(p),'sha256':hashlib.sha256(raw).hexdigest()}
 def payload(self,mode):
  refs={s:self.ref(s+'.json',dict(accepted=True,**{k:self.b[k] for k in ('targetInstanceId','attemptId','candidateSha')})) for s in q.STAGES};hs={k:v['sha256'] for k,v in refs.items()};bound={k:self.b[k] for k in q.KEYS}
  sealed=self.ref('sealed.json',{'kind':'isolated-original-evidence-sealed-v1','binding':bound,'receiptSha256':hs,'externalPreservationVerified':True})
  approval=self.ref('approval.json',{'kind':'clone-quiescence-approved-v1','binding':bound,'sqlSha256':q.SQL_SHA,'originalReceiptSha256':hs,'sealedEvidenceSha256':sealed['sha256'],'fixtureActor':'q-actor','allowedMode':mode});self.b['cloneQuiescenceApproval']=approval
  return {'binding':self.b,'mode':mode,'sql':{'path':str(Path(q.__file__).with_name('clone_quiescence.sql')),'sha256':q.SQL_SHA},'approval':approval,'originalReceipts':refs,'sealedEvidence':sealed,'secret':{},'fixtureActor':'q-actor'}
 def invoke(self,p):
  self.calls.append(p);return {'kind':'clone-quiescence-result-v1','binding':{k:self.b[k] for k in q.KEYS},'sqlSha256':q.SQL_SHA,'committed':p['mode']=='commit','rolledBack':p['mode']=='check','a3Accepted':False,'beforeCounts':[1]*11,'afterCounts':[0]*11}
 def test_default_check(self):
  self.p.pop('mode');self.assertTrue(q.run(self.p,self.gate,self.invoke)['rolledBack']);self.assertFalse((self.root/'clone-quiescence.intent.json').exists())
 def test_commit_once(self):
  self.p=self.payload('commit');self.assertTrue(q.run(self.p,self.gate,self.invoke)['committed'])
  with self.assertRaises(FileExistsError):q.run(self.p,self.gate,self.invoke)
  self.assertEqual(len(self.calls),1)
 def test_unknown_no_retry(self):
  self.p=self.payload('commit')
  with self.assertRaises(TimeoutError):q.run(self.p,self.gate,lambda p:(_ for _ in ()).throw(TimeoutError()))
  with self.assertRaises(FileExistsError):q.run(self.p,self.gate,self.invoke)
  self.assertFalse(self.calls)
 def test_closed(self):
  self.gate.close()
  with self.assertRaises(ValueError):q.run(self.p,self.gate,self.invoke)
  self.assertFalse(self.calls)
 def test_missing_original(self):
  self.p['originalReceipts'].pop('before')
  with self.assertRaises(ValueError):q.run(self.p,self.gate,self.invoke)
 def test_wrong_sql(self):
  self.p['sql']['sha256']='0'*64
  with self.assertRaises(ValueError):q.run(self.p,self.gate,self.invoke)
 def test_unapproved_commit(self):
  self.p['mode']='commit'
  with self.assertRaises(ValueError):q.run(self.p,self.gate,self.invoke)
 def test_boolean_or_bad_counts_rejected(self):
  for fn in [lambda p:True,lambda p:dict(self.invoke(p),afterCounts=[1]*11),lambda p:dict(self.invoke(p),a3Accepted=True)]:
   with self.assertRaises(ValueError):q.run(self.p,self.gate,fn)
 def test_original_deadlines_propagated(self):
  q.run(self.p,self.gate,self.invoke)
  self.assertEqual(self.calls[0]['deadlineEpoch'],self.gate.deadline);self.assertEqual(self.calls[0]['monotonicDeadline'],self.gate.end)
 def test_expired_after_commit_ack_preserved(self):
  self.p=self.payload('commit')
  def expire(p):
   result=self.invoke(p);self.gate.end=time.monotonic()-1;return result
  with self.assertRaisesRegex(ValueError,'CLEANUP_RESERVE'):q.run(self.p,self.gate,expire)
  self.assertTrue((self.root/'clone-quiescence.receipt.json').exists())
  with self.assertRaises(ValueError):q.run(self.p,self.gate,self.invoke)
 def test_wrong_host(self):
  self.b['host']='production.invalid'
  with self.assertRaises(ValueError):q.run(self.p,self.gate,self.invoke)
if __name__=='__main__':unittest.main()
