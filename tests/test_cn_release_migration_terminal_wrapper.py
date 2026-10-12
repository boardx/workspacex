import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('terminal_wrapper',ROOT/'tests/cn_release_migration_terminal_linux.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class TerminalWrapperTests(unittest.TestCase):
    def tap(self):
        names=json.loads(m.CASE_MANIFEST.read_bytes())['nodeCaseNames']
        return ('TAP version 13\n'+''.join(f'ok {i+1} - {n}\n'for i,n in enumerate(names))+'1..68\n# tests 68\n# pass 68\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n').encode()
    def test_exact_cases(self):
        self.assertEqual(m.validate_tap(self.tap())['counts']['pass'],68)
    def test_skip_missing_duplicate_and_case_substitution_fail(self):
        raw=self.tap()
        for bad in (b'',raw.replace(b'# skipped 0',b'# skipped 1'),raw.replace(b'# todo 0',b'# todo 1'),raw+b'# pass 68\n',raw.replace(b'ok 1 - ',b'ok 1 - substituted '),raw.replace(b'ok 2 - ',b'ok 1 - '),raw.replace(b'# pass 68',b'# pass 67')):
            with self.subTest(bad=bad[-50:]),self.assertRaises(ValueError):m.validate_tap(bad)
    def test_native_incomplete_or_expected_failure_is_not_green(self):
        good={'tests':19,'failures':0,'errors':0,'skipped':0,'expectedFailures':0,'unexpectedSuccesses':0}
        self.assertEqual(m.validate_python(('NATIVE_RESULT='+json.dumps(good)).encode()),good)
        for key in good:
            bad={**good,key:18 if key=='tests'else 1}
            with self.assertRaises(ValueError):m.validate_python(('NATIVE_RESULT='+json.dumps(bad)).encode())
        with self.assertRaises(ValueError):m.validate_python(b'')
    def test_elapsed_budget_never_spawns(self):
        with patch.object(m.subprocess,'Popen')as spawn:
            with self.assertRaises(TimeoutError):m.run_command(['forbidden'],0)
            spawn.assert_not_called()
    def test_nonlinux_is_failure_not_skip(self):
        with patch.object(m.sys,'platform','darwin'),patch.object(m.subprocess,'Popen')as spawn:
            with self.assertRaisesRegex(RuntimeError,'LINUX_REQUIRED'):m.main()
            spawn.assert_not_called()
    def test_fixed_distinct_five_files(self):
        self.assertEqual(len(m.TEST_FILES),5)
        self.assertNotIn('packages/cloud-deploy/src/cn-maintenance-host/a_route_factory_test.ts',m.TEST_FILES)
        self.assertEqual(m.BUDGET_SECONDS,180)
    def test_contradictory_failure_or_bailout_is_never_green(self):
        for extra in (b'not ok 999 - unexpected failure\n',b'Bail out! failure\n',b'  not ok 1 - nested failure\n',b'  bail out! nested failure\n'):
            with self.subTest(extra=extra),self.assertRaisesRegex(ValueError,'TAP_FAILURE_OR_BAILOUT'):m.validate_tap(self.tap()+extra)
if __name__=='__main__':unittest.main()
