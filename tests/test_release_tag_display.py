"""Actual planner output is copyable; rerun metadata cannot impersonate an image tag."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]

class TagDisplay(unittest.TestCase):
    def test_title_does_not_derive_image_tag_from_current_attempt(self):
        title=(ROOT/'.github/workflows/image-release.yml').read_text().splitlines()[1]
        self.assertNotIn('github.run_attempt',title)
        self.assertIn('inputs.tag',title)

    def test_summary_reports_planner_tag_for_build_and_reuse(self):
        for existing,attempt,expected in [('', '1','123-1'),('', '2','123-2'),('123-1','2','123-1')]:
            with self.subTest(existing=existing,attempt=attempt),tempfile.TemporaryDirectory() as d:
                out=Path(d)/'output';summary=Path(d)/'summary'
                env={**os.environ,'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF_NAME':'main','TARGET_ENVIRONMENT':'cn',
                     'EXISTING_TAG':existing,'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':attempt,'GITHUB_OUTPUT':str(out),'GITHUB_STEP_SUMMARY':str(summary)}
                p=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'plan','--source','a'*40],env=env,capture_output=True,text=True)
                self.assertEqual(0,p.returncode,p.stderr)
                self.assertTrue(summary.exists(),'Actual planner tag must be shown in Actions Summary')
                self.assertIn('`'+expected+'`',summary.read_text())
                self.assertIn('tag='+expected+'\n',out.read_text())
                if existing:self.assertIn('build=false\n',out.read_text())

if __name__=='__main__':unittest.main()
