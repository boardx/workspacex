"""Real Playwright worker config reload; no browser/server/cloud calls."""
import os
from pathlib import Path
import shutil
import subprocess
import unittest
ROOT=Path(__file__).resolve().parents[1]
class SixOutputAdmission(unittest.TestCase):
 def test_actual_playwright_worker_reload_and_stale_symlink_negatives(self):
  node=os.environ.get('CN_API_STARTUP_NODE')or shutil.which('node')
  self.assertTrue(node,'Installed Node required')
  result=subprocess.run([node,'--import','tsx','--test',str(ROOT/'tests/fixtures/cn-six-business/output-admission.test.ts')],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=45)
  self.assertLess(len(result.stdout),65536)
  self.assertEqual(result.returncode,0,result.stdout.decode(errors='replace'))
  self.assertIn(b'# pass 3',result.stdout);self.assertIn(b'# fail 0',result.stdout);self.assertIn(b'# skipped 0',result.stdout)
if __name__=='__main__':unittest.main()
