import sys,unittest,hashlib,json,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import clone_fresh_memory as m
import clone_quiescence_test as qfixtures
class Memory(unittest.TestCase):
 ref=qfixtures.Tests.ref
 payload=qfixtures.Tests.payload
 tearDown=qfixtures.Tests.tearDown
 def setUp(self):
  qfixtures.Tests.setUp(self);self.p=self.memory_payload('check')
 def memory_payload(self,mode):
  bound={k:self.b[k] for k in m.KEYS};schema='wsx_fixture_'+self.b['attemptId'].replace('-','')
  receipt=self.ref('clone-quiescence.receipt.json',{'kind':'clone-quiescence-result-v1','binding':bound,'committed':True,'a3Accepted':False,'afterCounts':[0]*11})
  approval=self.ref('memory-approval.json',{'kind':'clone-fresh-memory-approved-v1','binding':bound,'quiescenceReceiptSha256':receipt['sha256'],'schema':schema,'mode':mode,'originalSchema':'workspacex_memory','runtimeRole':'memory_rw','ownerRole':'memory_owner'});self.b['freshMemoryApproval']=approval
  return {'binding':self.b,'mode':mode,'approval':approval,'quiescenceReceipt':receipt,'secret':{}}
 def memory_invoke(self,p):
  self.calls.append(p);return {'kind':'clone-fresh-memory-result-v1','binding':{k:self.b[k] for k in m.KEYS},'schema':p['schema'],'prepared':p['mode']=='prepare','a3Accepted':False,'originalRows':1,'originalSha256':'a'*64,'freshRows':0 if p['mode']=='prepare' else None}
 def test_memory_default_check(self):
  self.p.pop('mode');self.assertFalse(m.run(self.p,self.gate,self.memory_invoke)['prepared']);self.assertFalse((self.root/'clone-fresh-memory.intent.json').exists())
 def test_memory_once(self):
  self.p=self.memory_payload('prepare');self.assertTrue(m.run(self.p,self.gate,self.memory_invoke)['prepared'])
  with self.assertRaises(FileExistsError):m.run(self.p,self.gate,self.memory_invoke)
  self.assertEqual(len(self.calls),1)
 def test_memory_unknown_no_retry(self):
  self.p=self.memory_payload('prepare')
  with self.assertRaises(TimeoutError):m.run(self.p,self.gate,lambda p:(_ for _ in ()).throw(TimeoutError()))
  with self.assertRaises(FileExistsError):m.run(self.p,self.gate,self.memory_invoke)
 def test_memory_approval_not_flag(self):
  self.p['mode']='prepare'
  with self.assertRaises(ValueError):m.run(self.p,self.gate,self.memory_invoke)
 def test_memory_requires_exact_receipt(self):
  self.p['quiescenceReceipt']=self.ref('other.json',json.loads((self.root/'clone-quiescence.receipt.json').read_bytes()))
  with self.assertRaises(ValueError):m.run(self.p,self.gate,self.memory_invoke)
 def test_memory_bad_result(self):
  for fn in [lambda p:True,lambda p:dict(self.memory_invoke(p),a3Accepted=True),lambda p:dict(self.memory_invoke(p),freshRows=0)]:
   with self.assertRaises(ValueError):m.run(self.p,self.gate,fn)
 def test_memory_closed(self):
  self.gate.close()
  with self.assertRaises(ValueError):m.run(self.p,self.gate,self.memory_invoke)
 def test_memory_exact_deadlines(self):
  m.run(self.p,self.gate,self.memory_invoke);self.assertEqual(self.calls[0]['deadlineEpoch'],self.gate.deadline);self.assertEqual(self.calls[0]['monotonicDeadline'],self.gate.end)
if __name__=='__main__':
 suite=unittest.TestSuite(Memory(n) for n in sorted(x for x in dir(Memory) if x.startswith('test_memory_')));r=unittest.TextTestRunner().run(suite);sys.exit(not r.wasSuccessful())
