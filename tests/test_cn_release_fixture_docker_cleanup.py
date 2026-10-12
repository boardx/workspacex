"""Offline Docker daemon protocol fixtures; never invoke a Docker daemon."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('owned_docker',ROOT/'scripts/cn-release-fixture-docker-cleanup.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DockerCleanupTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.owner=m.Owner.__new__(m.Owner);self.owner.directory=self.root;self.owner.identity=(self.root.stat().st_dev,self.root.stat().st_ino);self.owner.token='a'*32;self.owner.docker='/fixture/docker'
  self.cid='b'*64;self.intent=dict(token=self.owner.token,containerName='wsx-cn-api-'+'c'*16,imageId='sha256:'+'d'*64);self.receipt={**self.intent,'containerId':self.cid}
 def close(self,intent,receipt,lists,inspect=None):
  calls=[]
  def command(argv):
   calls.append(argv)
   if argv[1]=='ps':return lists.pop(0)
   if argv[1]=='inspect':return inspect or ' '.join([self.cid,self.owner.token,self.intent['imageId'],'/'+self.intent['containerName']])
   if argv[1]=='rm':return self.cid
   raise AssertionError(argv)
  with patch.object(self.owner,'read',side_effect=lambda name:intent if name=='api-create-intent.json'else receipt),patch.object(m,'command',command):value=self.owner.close()
  return value,calls
 def test_exact_owned_container_removed_and_empty_rechecked(self):
  value,calls=self.close(self.intent,self.receipt,[self.cid,'']);self.assertTrue(value['verified']);self.assertEqual([v for v in calls if v[1]=='rm'],[['/fixture/docker','rm','--force',self.cid]])
  self.assertEqual(len([v for v in calls if v[1]=='ps']),2)
 def test_lost_create_ack_is_not_green_even_after_owned_cleanup(self):
  value,_=self.close(self.intent,None,[self.cid,'']);self.assertFalse(value['verified']);self.assertTrue(value['unacknowledgedCreate'])
 def test_no_intent_and_empty_means_no_creation_submitted(self):
  value,_=self.close(None,None,['','']);self.assertTrue(value['verified']);self.assertFalse(value['unacknowledgedCreate'])
 def test_foreign_label_or_image_never_deleted(self):
  with self.assertRaisesRegex(RuntimeError,'IDENTITY_MISMATCH'):self.close(self.intent,self.receipt,[self.cid],inspect=self.cid+' foreign wrong /name')
 def test_daemon_failure_never_proves_cleanup(self):
  with patch.object(self.owner,'read',return_value=None),patch.object(m,'command',side_effect=RuntimeError('unknown')):
   with self.assertRaises(RuntimeError):self.owner.close()
 def test_bounded_real_subprocess_output(self):
  with self.assertRaisesRegex(RuntimeError,'RESPONSE_LIMIT'):m.command([sys.executable,'-I','-B','-c','print("x"*20000)'])
 def test_actual_runner_rejects_unproven_docker_cleanup(self):
  spec=importlib.util.spec_from_file_location('runner',ROOT/'scripts/cn-release-simulation.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
  sys.path.insert(0,str(ROOT/'tests'))
  try:from test_cn_release_simulation import FixtureDomain
  finally:sys.path.pop(0)
  class FakeOwner:
   environment={}
   def close(self):return {'verified':False,'unacknowledgedCreate':True}
  stats=dict(tests=1,failures=0,errors=0,skipped=0,expectedFailures=0,unexpectedSuccesses=0)
  code='from pathlib import Path;Path('+repr(str(self.root/'linux-api-startup.tests.json'))+').write_text('+repr(json.dumps(stats))+')'
  with patch.object(runner,'docker_owner_factory',return_value=FakeOwner()),patch.object(runner,'domain_factory',return_value=FixtureDomain()):
   value=runner.execute('linux-api-startup',[sys.executable,'-I','-B','-c',code],self.root,runner.environment(self.root),2)
  self.assertEqual(value['status'],'failed');self.assertEqual(value['reason'],'docker-cleanup-unproven')

if __name__=='__main__':unittest.main()
