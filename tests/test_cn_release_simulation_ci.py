"""CI bootstrap contract; live root-owned clone execution requires Linux CI."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('simulation_ci',ROOT/'scripts/cn-release-simulation-ci.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class CiBootstrap(unittest.TestCase):
 def test_exact_sha_rejects_refs_and_shell_before_any_directory(self):
  with patch.object(m.tempfile,'mkdtemp')as create:
   for value in ('main','HEAD','a'*39,'A'*40,'a'*40+';touch /tmp/no'):
    with self.assertRaisesRegex(ValueError,'EXACT_SHA'):m.execute(value,1,0)
   create.assert_not_called()
 def test_nonroot_or_nonlinux_rejects_before_clone(self):
  with patch.object(m.sys,'platform','darwin'),patch.object(m.tempfile,'mkdtemp')as create:
   with self.assertRaisesRegex(ValueError,'LINUX_ROOT'):m.execute('a'*40,1,0)
   create.assert_not_called()
  with patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=1001):
   with self.assertRaisesRegex(ValueError,'LINUX_ROOT'):m.execute('a'*40,1,0)
 def test_directory_rejects_relative_and_symlink(self):
  with tempfile.TemporaryDirectory()as td:
   root=Path(td).resolve();(root/'directory').mkdir();(root/'link').symlink_to(root/'directory',target_is_directory=True)
   self.assertEqual(m.absolute_directory(str(root/'directory')),root/'directory')
   with self.assertRaises(ValueError):m.absolute_directory(str(root/'link'))
   with self.assertRaises(ValueError):m.absolute_directory('.')
 def test_cli_rejects_arbitrary_ref(self):
  result=subprocess.run([sys.executable,'-I','-B',str(ROOT/'scripts/cn-release-simulation-ci.py'),'--sha','main'],capture_output=True,timeout=5)
  self.assertNotEqual(result.returncode,0);self.assertIn(b'CI_EXACT_SHA_REQUIRED',result.stderr)
 def test_workflow_passes_fixed_sha_without_production_identity(self):
  workflow=(ROOT/'.github/workflows/cn-release-simulation.yml').read_text()
  self.assertIn('scripts/cn-release-simulation-ci.py --sha "$GITHUB_SHA"',workflow)
  self.assertIn('GITHUB_WORKSPACE="$GITHUB_WORKSPACE" RUNNER_TEMP="$RUNNER_TEMP"',workflow)
  self.assertNotIn('secrets.',workflow);self.assertNotIn('id-token:',workflow)
 def test_setup_outer_timeout_closes_domain_and_preserves_failure(self):
  class Domain:
   def __init__(self):self.process=None;self.closed=False
   def spawn(self,command,**kwargs):self.process=subprocess.Popen(command,**kwargs);return self.process
   def close(self,process):
    self.closed=True
    if process is not None and process.poll()is None:process.kill()
    if process is not None:process.wait(timeout=2)
    return {'verified':True,'fixtureOnly':True}
  with tempfile.TemporaryDirectory()as td:
   domain=Domain();receipt=Path(td)/'cleanup.json'
   with patch.object(m,'setup_domain',return_value=domain):
    with self.assertRaises(subprocess.TimeoutExpired):m.run_owned_setup([sys.executable,'-I','-B','-c','import time;time.sleep(3)'],ROOT,{},timeout=.05,receipt_path=receipt)
   self.assertTrue(domain.closed);self.assertIsNotNone(domain.process.returncode);self.assertTrue(receipt.is_file())
 def test_setup_missing_cleanup_proof_is_distinct_blocker(self):
  class Domain:
   def spawn(self,*args,**kw):raise ValueError('fixture spawn failed')
   def close(self,process):return {'verified':False}
  with patch.object(m,'setup_domain',return_value=Domain()):
   with self.assertRaises(m.SetupCleanupUnproven):m.run_owned_setup([],ROOT,{})
  text=(ROOT/'scripts/cn-release-simulation-ci.py').read_text();self.assertIn('if owned_cleanup_verified:shutil.rmtree(owned)',text)
 def test_simulation_recovery_attempts_every_registry_after_domain_empty(self):
  import types
  events=[]
  class Domain:
   def spawn(self,command,**kwargs):return subprocess.Popen(command,**kwargs)
   def close(self,process):
    if process.poll()is None:process.kill()
    process.wait(timeout=2);events.append('domain-empty')
    return {'verified':True,'populated':0,'removed':True}
  def recover(path,*args):
   events.append(path.name)
   if path.name=='target':raise RuntimeError('fixture unknown')
   return {'verified':True}
  fake=types.SimpleNamespace(recover_all=recover)
  with tempfile.TemporaryDirectory()as td:
   root=Path(td)
   with patch.object(m,'setup_domain',return_value=Domain()),patch.object(m.importlib.util,'module_from_spec',return_value=fake),patch.object(m.importlib.util,'spec_from_file_location',return_value=types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda module:None))):
    with self.assertRaises(m.SetupCleanupUnproven):m.run_owned_simulation([sys.executable,'-I','-B','-c','import time;time.sleep(3)'],ROOT,{},dict(target=root/'target',control=root/'control'),'a'*40,'123',root,timeout=.05)
   self.assertEqual(events,['domain-empty','target','control','api-owners'])
   import json
   receipt=json.loads((root/'six-recovery.json').read_text());self.assertFalse(receipt['verified']);self.assertTrue(receipt['registries']['control']['verified'])
 def test_unproven_outer_domain_never_runs_daemon_recovery(self):
  class Domain:
   def spawn(self,*args,**kwargs):raise RuntimeError('fixture')
   def close(self,process):return {'verified':False,'populated':1}
  with tempfile.TemporaryDirectory()as td,patch.object(m,'setup_domain',return_value=Domain()),patch.object(m.importlib.util,'spec_from_file_location')as load:
   with self.assertRaises(m.SetupCleanupUnproven):m.run_owned_simulation([],ROOT,{}, {},'a'*40,'123',Path(td))
   load.assert_not_called()
 def test_local_copy_has_no_shared_objects_or_global_config(self):
  text=(ROOT/'scripts/cn-release-simulation-ci.py').read_text()
  self.assertIn("'GIT_ALLOW_PROTOCOL':'file'",text);self.assertIn("'--no-hardlinks'",text)
  self.assertIn("'GIT_CONFIG_GLOBAL':'/dev/null'",text);self.assertIn("'--detach',sha",text)
  self.assertNotIn('os.chown',text);self.assertNotIn('safe.directory=*',text)

if __name__=='__main__':unittest.main()
