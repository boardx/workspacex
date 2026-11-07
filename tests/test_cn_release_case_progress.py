"""Timeout diagnostics retain executed case identities without claiming completion."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('case_progress_simulation', ROOT / 'scripts/cn-release-simulation.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class CaseProgress(unittest.TestCase):
    def test_progress_records_monotonic_start_and_terminal_status(self):
        class Cases(unittest.TestCase):
            def test_pass(self): pass
            @unittest.skip('fixture')
            def test_skip(self): pass
            def test_failure(self): self.fail('private-error-must-not-be-in-progress')
        with tempfile.TemporaryDirectory() as folder:
            result = Path(folder) / 'release.tests.json'
            with patch.object(m.unittest.TestLoader, 'discover', return_value=unittest.defaultTestLoader.loadTestsFromTestCase(Cases)), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(m.child('release', result), 1)
            rows = [json.loads(line) for line in result.with_suffix('.progress.jsonl').read_text().splitlines()]
            self.assertEqual(len(rows), 6)
            self.assertEqual([r['event'] for r in rows], ['started', 'finished'] * 3)
            self.assertEqual({r['status'] for r in rows if r['event'] == 'finished'}, {'pass', 'fail', 'skip'})
            self.assertEqual(sorted(r['elapsedSeconds'] for r in rows), [r['elapsedSeconds'] for r in rows])
            for start, finish in zip(rows[::2], rows[1::2]):
                self.assertEqual(start['caseId'], finish['caseId'])
                self.assertGreaterEqual(finish['durationSeconds'], 0)
            self.assertNotIn('private-error', json.dumps(rows))

    def test_manual_release_measurement_keeps_original_budget_and_linux_bound(self):
        text = (ROOT / '.github/workflows/cn-release-simulation.yml').read_text()
        self.assertEqual(m.workflow_plan('release',1,'acceptance'),dict(suites=['release'],split=False))
        self.assertIn("if: matrix.suite == 'release'", text)
        self.assertIn('timeout --signal=TERM --kill-after=2s 25s', text)
        self.assertIn('faulthandler.dump_traceback_later(15)', text)
        self.assertIn('test_cn_release_terminal_delegation.TerminalTests', text)
        self.assertIn('round-*/*.jsonl', text)
        ci = (ROOT / 'scripts/cn-release-simulation-ci.py').read_text()
        self.assertIn("'--timeout-seconds','300'", ci)

    def test_export_preserves_timeout_progress_without_final_verdict(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); source = root / 'cn-simulation' / 'round-01'
            source.mkdir(parents=True); target = root / 'cn-simulation-artifacts'
            target.mkdir(mode=0o700)
            name = 'release.tests.progress.jsonl'
            raw = b'{"caseId":"fixture","event":"started"}\n'
            (source / name).write_bytes(raw)
            m.export_reports(root)
            self.assertEqual((target / 'round-01' / name).read_bytes(), raw)
            self.assertFalse((target / 'round-01/release.tests.json').exists())

    def test_killed_child_preserves_completed_and_inflight_case(self):
        with tempfile.TemporaryDirectory() as folder:
            result = Path(folder) / 'release.tests.json'
            code = """
import importlib.util, pathlib, sys, time, unittest
from unittest.mock import patch
s=importlib.util.spec_from_file_location('sim',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Cases(unittest.TestCase):
 def test_a_pass(self): pass
 def test_b_wait(self): time.sleep(30)
with patch.object(m.unittest.TestLoader,'discover',return_value=unittest.defaultTestLoader.loadTestsFromTestCase(Cases)):
 m.child('release',pathlib.Path(sys.argv[2]))
"""
            process = subprocess.Popen([sys.executable, '-I', '-B', '-c', code, str(ROOT / 'scripts/cn-release-simulation.py'), str(result)], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                progress = result.with_suffix('.progress.jsonl')
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if progress.exists() and len(progress.read_text().splitlines()) >= 3: break
                    if process.poll() is not None: self.fail('child exited before blocking fixture')
                    time.sleep(.01)
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=3)
                rows = [json.loads(line) for line in progress.read_text().splitlines()]
                self.assertEqual([r['event'] for r in rows], ['started', 'finished', 'started'])
                self.assertTrue(rows[-1]['caseId'].endswith('test_b_wait'))
                self.assertFalse(result.exists())
                self.assertFalse(result.with_suffix('.cases.json').exists())
            finally:
                if process.poll() is None: os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=3)


if __name__ == '__main__': unittest.main()
