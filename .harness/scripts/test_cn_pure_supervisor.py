import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).parent

class SupervisorTests(unittest.TestCase):
    def run_fixture(self, body, timeout=1):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'test_fixture.py'
            path.write_text(body)
            return subprocess.run([sys.executable, '-B', str(HERE / 'cn-pure-test-supervisor.py'),
                                   '--directory', directory, '--timeout', str(timeout)],
                                  capture_output=True, text=True, timeout=8)

    def test_success_reports_test_identity_and_elapsed(self):
        result = self.run_fixture('import unittest\nclass Tests(unittest.TestCase):\n def test_ok(self): self.assertEqual(2+2,4)\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('test_fixture.Tests.test_ok', result.stderr)
        self.assertIn('elapsed=', result.stderr)

    def test_failure_retains_assertion_and_nonzero_exit(self):
        result = self.run_fixture('import unittest\nclass Tests(unittest.TestCase):\n def test_bad(self): self.assertEqual(2+2,5)\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('4 != 5', result.stderr)

    @unittest.skipUnless(sys.platform == 'linux', 'Linux /proc ownership')
    def test_timeout_reports_stack_and_reaps_detached_descendant(self):
        result = self.run_fixture('import unittest,subprocess,sys,time\nclass Tests(unittest.TestCase):\n def test_hang(self):\n  child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"],start_new_session=True)\n  print(child.pid,flush=True)\n  time.sleep(60)\n', .5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('test_fixture.Tests.test_hang', result.stderr)
        self.assertIn('test_hang', result.stderr)
        self.assertIn('deadline exceeded', result.stderr)
        self.assertRegex(result.stderr, r'cleanup owned=\d+ remaining=0')
        with self.assertRaises(ProcessLookupError):
            os.kill(int(result.stdout.strip()), 0)

if __name__ == '__main__':
    unittest.main()
