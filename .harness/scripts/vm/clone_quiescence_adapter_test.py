import hashlib,json,sys,unittest,time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parent))
import clone_quiescence_adapter as a
import isolated_rehearsal_test as f
class Adapter(unittest.TestCase):
 def setUp(self):
  self.b=f.BindingTests().manifest();self.image='sha256:'+'a'*64;self.network='b'*64
  engine=Path(__file__).with_name('clone_quiescence_engine.py');self.b['quiescenceRuntime']={'imageId':self.image,'engine':{'path':str(engine),'sha256':hashlib.sha256(engine.read_bytes()).hexdigest()}};self.b['restore']={'isolatedNetwork':self.network}
  self.meta={'Id':self.image,'Os':'linux','Architecture':'amd64','Config':{'Labels':{'org.opencontainers.image.revision':self.b['candidateSha']},'Env':[]}}
  self.calls=[]
 def capture(self,args,check=True):
  self.calls.append(args)
  if args[0]=='image':v=[self.meta]
  elif args[0]=='network':v=[{'Id':self.network,'Driver':'bridge','Labels':{'wsx.rehearsal.owner':self.b['attemptId']}}]
  elif args[0]=='inspect':return SimpleNamespace(returncode=1,stdout=b'')
  else:return SimpleNamespace(returncode=0,stdout=b'')
  return SimpleNamespace(returncode=0,stdout=json.dumps(v).encode())
 def test_exact_private_invocation(self):
  proc=SimpleNamespace(returncode=0,communicate=lambda raw,timeout:(b'{"localFake":true}',b''),poll=lambda:0)
  with patch.object(a,'capture',self.capture),patch.object(a.subprocess,'Popen',return_value=proc) as pop:
   self.assertEqual(a.invoke({'binding':self.b,'secret':{'password':'never-in-argv'},'deadlineEpoch':time.time()+60,'monotonicDeadline':time.monotonic()+60}),{'localFake':True})
   args=pop.call_args.args[0];self.assertIn('--pull=never',args);self.assertIn('--read-only',args);self.assertNotIn('never-in-argv',' '.join(args));self.assertIn('--network',args)
 def test_wrong_image_rejected_before_process(self):
  self.meta['Id']='sha256:'+'c'*64
  with patch.object(a,'capture',self.capture),patch.object(a.subprocess,'Popen') as pop:
   with self.assertRaises(ValueError):a.invoke({'binding':self.b,'deadlineEpoch':time.time()+60,'monotonicDeadline':time.monotonic()+60})
   pop.assert_not_called()
 def test_expired_before_process(self):
  with patch.object(a.subprocess,'Popen') as pop:
   with self.assertRaisesRegex(ValueError,'EXPIRED'):a.invoke({'deadlineEpoch':time.time()-1,'monotonicDeadline':time.monotonic()+60})
   pop.assert_not_called()
 def test_timeout_bounded_by_original_deadline(self):
  seen=[]
  proc=SimpleNamespace(returncode=0,communicate=lambda raw,timeout:(seen.append(timeout) or b'{}',b''),poll=lambda:0)
  with patch.object(a,'capture',self.capture),patch.object(a.subprocess,'Popen',return_value=proc):a.invoke({'binding':self.b,'deadlineEpoch':time.time()+2,'monotonicDeadline':time.monotonic()+2})
  self.assertTrue(0<seen[0]<=2)
 def test_baked_secret_rejected(self):
  self.meta['Config']['Env']=['API_KEY=opaque']
  with patch.object(a,'capture',self.capture),patch.object(a.subprocess,'Popen') as pop:
   with self.assertRaises(ValueError):a.invoke({'binding':self.b,'deadlineEpoch':time.time()+60,'monotonicDeadline':time.monotonic()+60})
   pop.assert_not_called()
if __name__=='__main__':unittest.main()
