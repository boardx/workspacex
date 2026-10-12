"""Actual installed Next resolution; no server, Docker, browser or download."""
import os
from pathlib import Path
import shutil
import subprocess
import unittest
ROOT=Path(__file__).resolve().parents[1]
class NextLaunch(unittest.TestCase):
 def test_actual_web_workspace_next_resolution_without_inherited_bin(self):
  node=os.environ.get('CN_API_STARTUP_NODE')or shutil.which('node')
  self.assertTrue(node,'Installed Node required')
  result=subprocess.run([node,'--import','tsx','--test',str(ROOT/'tests/fixtures/cn-six-business/next-launch.test.ts')],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
  self.assertLess(len(result.stdout),65536)
  self.assertEqual(result.returncode,0,result.stdout.decode(errors='replace'))
  self.assertIn(b'# pass 1',result.stdout);self.assertIn(b'# fail 0',result.stdout);self.assertIn(b'# skipped 0',result.stdout)
if __name__=='__main__':unittest.main()
