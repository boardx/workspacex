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
 def test_local_copy_has_no_shared_objects_or_global_config(self):
  text=(ROOT/'scripts/cn-release-simulation-ci.py').read_text()
  self.assertIn("'GIT_ALLOW_PROTOCOL':'file'",text);self.assertIn("'--no-hardlinks'",text)
  self.assertIn("'GIT_CONFIG_GLOBAL':'/dev/null'",text);self.assertIn("'--detach',sha",text)
  self.assertNotIn('os.chown',text);self.assertNotIn('safe.directory=*',text)

if __name__=='__main__':unittest.main()
