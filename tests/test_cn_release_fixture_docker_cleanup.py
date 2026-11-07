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
 def test_complete_recovery_has_independent_fixed_owner_and_shared_deadline(self):
  import types,time
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);names=('api-container-owner','application-recovery-owner','application-recovery-complete-owner')
   self.assertEqual(m.REGISTRY_NAMES,names)
   for name in names:(root/'round-01'/name).mkdir(parents=True)
   calls=[];end=time.monotonic()+30
   def restore(path,*args):
    def close(receipt,deadline):
     calls.append((path.name,deadline));return {'verified':path.name!='application-recovery-owner'}
    return types.SimpleNamespace(close=close)
   with patch.object(m,'restore',side_effect=restore):result=m.recover_all(root,'123',{'verified':True,'populated':0,'removed':True},deadline=end)
   self.assertFalse(result['verified']);self.assertEqual([x[0]for x in calls],list(names));self.assertTrue(all(x[1]==end for x in calls))
   self.assertTrue(result['owners']['round-01/application-recovery-complete-owner']['verified'])
 def test_complete_owner_reaches_child_and_unknown_cleanup_fails_closed(self):
  import os
  spec=importlib.util.spec_from_file_location('complete_runner',ROOT/'scripts/cn-release-simulation.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
  events=[]
  class Domain:
   def spawn(self,command,**kwargs):
    import subprocess
    self.p=subprocess.Popen(command,**kwargs);return self.p
   def close(self,p):p.wait(timeout=2);events.append('domain-empty');return {'verified':True,'populated':0}
  class Owner:
   environment={'CN_API_STARTUP_OWNER_TOKEN':'synthetic-complete-only'}
   def close(self):events.append('owner-close');return {'verified':False,'unacknowledgedCreate':True}
  with tempfile.TemporaryDirectory()as td:
   output=Path(td);name='linux-application-recovery-complete';stats=dict(tests=1,failures=0,errors=0,skipped=0,expectedFailures=0,unexpectedSuccesses=0)
   code='import os;from pathlib import Path;assert os.environ["CN_API_STARTUP_OWNER_TOKEN"]=="synthetic-complete-only";Path('+repr(str(output/(name+'.tests.json')))+').write_text('+repr(json.dumps(stats))+')'
   with patch.object(runner,'docker_owner_factory',return_value=Owner())as create,patch.object(runner,'domain_factory',return_value=Domain()):
    result=runner.execute(name,[sys.executable,'-I','-B','-c',code],output,runner.environment(output),2)
   create.assert_called_once_with(output,'application-recovery-complete-owner')
   self.assertEqual(events,['domain-empty','owner-close']);self.assertEqual(result['status'],'failed');self.assertEqual(result['reason'],'docker-cleanup-unproven')
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
  with patch.object(self.owner,'read',side_effect=lambda name:intent if name=='api-create-intent.json'else receipt if name=='api-create-receipt.json'else None),patch.object(m,'command',command):value=self.owner.close()
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
 def test_recovery_continues_after_unknown_owner_and_requires_outer_proof(self):
  import types
  for name in m.REGISTRY_NAMES:(self.root/'round-01'/name).mkdir(parents=True)
  calls=[]
  def restore(path,*args):
   calls.append(path.name)
   if path.name=='api-container-owner':raise RuntimeError('unknown')
   return types.SimpleNamespace(close=lambda name,**kw:{'verified':True})
  with patch.object(m,'restore',side_effect=restore):
   with self.assertRaises(ValueError):m.recover_all(self.root,'123',{'verified':False})
   self.assertFalse(calls)
   value=m.recover_all(self.root,'123',{'verified':True,'populated':0,'removed':True})
  self.assertEqual(calls,list(m.REGISTRY_NAMES));self.assertFalse(value['verified'])
 def test_repeated_unknown_cleanup_remains_false_after_live_readback(self):
  prior={'kind':'cn-api-fixture-daemon-cleanup-v1','ownerToken':self.owner.token,'verified':False}
  records={'api-create-intent.json':self.intent,'api-create-receipt.json':None,'recovery-cleanup.json':prior}
  with patch.object(self.owner,'read',side_effect=lambda n:records.get(n)),patch.object(m,'command',return_value='')as daemon,patch.object(m,'durable')as write:
   value=self.owner.close('recovery-cleanup.json')
  self.assertFalse(value['verified']);self.assertEqual(daemon.call_count,2);write.assert_not_called()
 def test_real_untrusted_ancestry_is_rejected_before_daemon_access(self):
  # A real temporary path has a writable or non-root ancestor on both Mac and Linux.
  with patch.object(m.shutil,'which')as lookup:
   with self.assertRaisesRegex(ValueError,'ANCESTRY|PRIVATE'):m.trusted_directory(self.root.resolve())
   lookup.assert_not_called()
 def test_runner_owner_factory_uses_ci_private_root_not_report_directory(self):
  import types
  spec=importlib.util.spec_from_file_location('runner_owner_path',ROOT/'scripts/cn-release-simulation.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
  trusted=self.root/'api-owners';trusted.mkdir();calls=[]
  fake=types.SimpleNamespace(trusted_directory=lambda path:calls.append(path),Owner=lambda *args:args)
  with patch.dict(runner.os.environ,{'CN_API_OWNER_ROOT':str(trusted),'GITHUB_RUN_ID':'123'}),patch.object(runner.importlib.util,'module_from_spec',return_value=fake),patch.object(runner.importlib.util,'spec_from_file_location',return_value=types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda module:None))):
   value=runner.docker_owner_factory(Path('/untrusted/report/round-01'),'application-recovery-owner')
  self.assertEqual(value,(trusted/'round-01','123','round-01','application-recovery-owner'))
  self.assertEqual(calls,[trusted,trusted/'round-01'])
 def test_real_command_shared_deadline_is_enforced(self):
  import time
  began=time.monotonic()
  with self.assertRaisesRegex(RuntimeError,'RESPONSE_UNKNOWN'):m.command([sys.executable,'-I','-B','-c','import time;time.sleep(5)'],deadline=began+.1)
  self.assertLess(time.monotonic()-began,2)
 def test_bounded_real_subprocess_output(self):
  with self.assertRaisesRegex(RuntimeError,'RESPONSE_LIMIT'):m.command([sys.executable,'-I','-B','-c','print("x"*20000)'])
 def test_actual_runner_rejects_unproven_docker_cleanup(self):
  spec=importlib.util.spec_from_file_location('runner',ROOT/'scripts/cn-release-simulation.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
  sys.path.insert(0,str(ROOT/'tests'))
  try:from test_cn_release_simulation import FixtureDomain
  finally:sys.path.pop(0)
  class ProvenFixtureDomain(FixtureDomain):
   def close(self,process):
    value=super().close(process);return {**value,'populated':0}
  class FakeOwner:
   environment={}
   def close(self):return {'verified':False,'unacknowledgedCreate':True}
  stats=dict(tests=1,failures=0,errors=0,skipped=0,expectedFailures=0,unexpectedSuccesses=0)
  code='from pathlib import Path;Path('+repr(str(self.root/'linux-api-startup.tests.json'))+').write_text('+repr(json.dumps(stats))+')'
  with patch.object(runner,'docker_owner_factory',return_value=FakeOwner()),patch.object(runner,'domain_factory',return_value=ProvenFixtureDomain()):
   value=runner.execute('linux-api-startup',[sys.executable,'-I','-B','-c',code],self.root,runner.environment(self.root),2)
  self.assertEqual(value['status'],'failed');self.assertEqual(value['reason'],'docker-cleanup-unproven')

if __name__=='__main__':unittest.main()
