"""Actual installed Next resolution; no server, Docker, browser or download."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import shlex
import unittest
ROOT=Path(__file__).resolve().parents[1]
class NextLaunch(unittest.TestCase):
 def test_production_build_and_runtime_artifact_contract(self):
  node=os.environ.get('CN_API_STARTUP_NODE')or shutil.which('node');self.assertTrue(node)
  result=subprocess.run([node,'--import','tsx','--test',str(ROOT/'tests/fixtures/cn-six-business/next-production.test.ts')],cwd=ROOT,capture_output=True,text=True,timeout=30)
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertIn('# pass 2',result.stdout);self.assertIn('# fail 0',result.stdout);self.assertIn('# skipped 0',result.stdout)
 def test_actual_web_workspace_next_resolution_without_inherited_bin(self):
  node=os.environ.get('CN_API_STARTUP_NODE')or shutil.which('node')
  self.assertTrue(node,'Installed Node required')
  result=subprocess.run([node,'--import','tsx','--test',str(ROOT/'tests/fixtures/cn-six-business/next-launch.test.ts')],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
  self.assertLess(len(result.stdout),65536)
  self.assertEqual(result.returncode,0,result.stdout.decode(errors='replace'))
  self.assertIn(b'# pass 2',result.stdout);self.assertIn(b'# fail 0',result.stdout);self.assertIn(b'# skipped 0',result.stdout)
  self.assertIn(b'fixed supervisor records real child exit and forwards output without retry',result.stdout)
 def test_real_server_worker_exit_observations(self):
  node=os.environ.get('CN_API_STARTUP_NODE')or shutil.which('node');self.assertTrue(node)
  result=subprocess.run([node,'--import','tsx','--test',str(ROOT/'tests/fixtures/cn-six-business/next-worker-observer.test.ts')],cwd=ROOT,capture_output=True,text=True,timeout=20)
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertIn('# pass 5',result.stdout);self.assertIn('# fail 0',result.stdout);self.assertIn('# skipped 0',result.stdout)
 def test_github_pnpm_in_separate_node_modules_bin_survives_test_path_sanitization(self):
  node=os.environ.get('CN_API_STARTUP_NODE')or shutil.which('node');pnpm=shutil.which('pnpm')
  self.assertTrue(node and pnpm,'Installed Node and pnpm required')
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);package_bin=root/'setup-pnpm/node_modules/.bin';package_bin.mkdir(parents=True)
   launcher=package_bin/'pnpm';launcher.write_text('#!/bin/sh\nexec '+shlex.quote(pnpm)+' "$@"\n');launcher.chmod(0o700)
   node_bin=root/'node-only';node_bin.mkdir();(node_bin/'node').symlink_to(node)
   env={**os.environ,'PATH':str(package_bin)+':'+str(node_bin)+':/usr/bin:/bin'}
   old={**env,'PATH':':'.join(v for v in env['PATH'].split(':')if 'node_modules/.bin'not in v)}
   self.assertIsNone(shutil.which('pnpm',path=old['PATH']))
   result=subprocess.run([node,'--import','tsx','--test',str(ROOT/'tests/fixtures/cn-six-business/next-launch.test.ts')],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
   self.assertLess(len(result.stdout),65536);self.assertEqual(result.returncode,0,result.stdout.decode(errors='replace'))
   self.assertIn(b'# pass 2',result.stdout);self.assertIn(b'# skipped 0',result.stdout)
if __name__=='__main__':unittest.main()
