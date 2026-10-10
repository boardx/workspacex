import os
import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).parent

class SupervisorTests(unittest.TestCase):
    def test_unsupported_pidfd_fails_before_spawning_worker(self):
        spec = importlib.util.spec_from_file_location('cn_supervisor', HERE / 'cn-pure-test-supervisor.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with patch.object(module.sys, 'platform', 'linux'), \
             patch.object(module.sys, 'argv', ['supervisor', '--directory', '/tmp']), \
             patch.object(module.os, 'pidfd_open', side_effect=OSError(38, 'pidfd unavailable'), create=True), \
             patch.object(module.signal, 'pidfd_send_signal', create=True), \
             patch.object(module.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
            with self.assertRaises(OSError):
                module.main()

    def test_cleanup_identity_race_signals_only_open_pidfd(self):
        spec = importlib.util.spec_from_file_location('cn_supervisor', HERE / 'cn-pure-test-supervisor.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(hasattr(module, 'kill_owned'), 'cleanup must bind signals to an opened pidfd')
        events = []
        identity = {'pid': 'old-start', 'fd': 'old-start'}
        def opened(pid):
            events.append(('open', pid))
            return 91
        def checked():
            events.append(('check', 123))
            identity['pid'] = 'replacement-process'
            return {123: 'old-start'}
        def sent(fd, sig):
            # The numeric PID is now assigned to another process. The opened fd
            # still denotes the original process and must be the only signal target.
            self.assertEqual(identity['pid'], 'replacement-process')
            self.assertEqual(identity['fd'], 'old-start')
            events.append(('signal-fd', fd))
        with patch.object(module.os, 'pidfd_open', side_effect=opened, create=True), \
             patch.object(module, 'descendants', side_effect=checked), \
             patch.object(module.signal, 'pidfd_send_signal', side_effect=sent, create=True), \
             patch.object(module.os, 'close', side_effect=lambda fd: events.append(('close', fd))), \
             patch.object(module.os, 'kill', side_effect=AssertionError('bare PID signal forbidden')):
            self.assertTrue(module.kill_owned(123, 'old-start'))
        self.assertEqual(events, [('open', 123), ('check', 123), ('signal-fd', 91), ('close', 91)])

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
        result = self.run_fixture('import unittest,subprocess,sys,time\nclass Tests(unittest.TestCase):\n def test_hang(self):\n  child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"],start_new_session=True)\n  print(child.pid,flush=True)\n  time.sleep(60)\n', 2)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('test_fixture.Tests.test_hang', result.stderr)
        self.assertIn('test_hang', result.stderr)
        self.assertIn('deadline exceeded', result.stderr)
        self.assertRegex(result.stderr, r'cleanup owned=\d+ remaining=0')
        with self.assertRaises(ProcessLookupError):
            os.kill(int(result.stdout.strip()), 0)

if __name__ == '__main__':
    unittest.main()
