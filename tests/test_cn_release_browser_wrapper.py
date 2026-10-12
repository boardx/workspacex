"""Wrapper admission tests; these do not claim Chromium executed locally."""
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('browser_contract',ROOT/'tests/cn_release_browser_linux.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class BrowserWrapperTests(unittest.TestCase):
 def tap(self):
  return ('TAP version 13\n'+''.join('ok %d - %s\n'%(i,n)for i,n in enumerate(m.REQUIRED_JOURNEYS,1))+'1..2\n# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n').encode()
 def test_two_real_journey_labels_and_exact_summary_are_required(self):
  self.assertEqual(m.validate_tap(self.tap())['tests'],2)
 def test_skip_todo_cancel_fail_empty_duplicate_and_missing_journey_reject(self):
  raw=self.tap()
  samples=[b'',raw.replace(b'# skipped 0',b'# skipped 1'),raw.replace(b'# todo 0',b'# todo 1'),raw.replace(b'# cancelled 0',b'# cancelled 1'),raw.replace(b'# fail 0',b'# fail 1'),raw.replace(b'1..2',b'1..0'),raw+b'# tests 2\n',raw.replace(b'ok 2',b'ok 1'),raw.replace(b': candidate',b': missing'),raw.replace(b': candidate',b': candidate # SKIP missing')]
  for sample in samples:
   with self.subTest(sample=sample):
    with self.assertRaises(ValueError):m.validate_tap(sample)
 def test_real_subprocess_output_limit_and_timeout_are_failures(self):
  with self.assertRaisesRegex(ValueError,'BROWSER_OUTPUT_LIMIT'):m.run_node([sys.executable,'-I','-B','-c','print("x"*10000)'],limit=100)
  with self.assertRaisesRegex(TimeoutError,'BROWSER_DEADLINE'):m.run_node([sys.executable,'-I','-B','-c','import time;time.sleep(3)'],seconds=.05)
 def test_readiness_requires_all_ten_actual_cases_without_skips(self):
  spec=importlib.util.spec_from_file_location('readiness_contract',ROOT/'tests/cn_release_readiness_linux.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
  value=dict(success=True,numTotalTests=10,numPassedTests=10,numFailedTests=0,numPendingTests=0,testResults=[dict(name=str(ROOT/'packages/cloud-deploy/test/cn-release-readiness-dispatch.test.ts'),assertionResults=[dict(fullName='fixture-'+str(i),status='passed')for i in range(10)])])
  self.assertEqual(len(r.validate(value)),10)
  value['testResults'][0]['assertionResults'][0]['status']='pending'
  with self.assertRaises(ValueError):r.validate(value)
  value['testResults'][0]['assertionResults'][0]['status']='passed';value['numTotalTests']=0
  with self.assertRaises(ValueError):r.validate(value)
 def test_fixed_inventory_has_no_duplicate_source_files(self):
  spec=importlib.util.spec_from_file_location('simulation_inventory',ROOT/'scripts/cn-release-simulation.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
  seen={}
  for suite,patterns in runner.SUITES.items():
   for pattern in patterns:
    for source in (ROOT/'tests').glob(pattern):
     self.assertNotIn(source,seen,(suite,seen.get(source),source.name));seen[source]=suite
  self.assertEqual(len(runner.SUITES),16)
  for name in ('cn_release_browser_linux.py','cn_release_cgroup_linux.py','test_cn_formal_budget_profile.py','test_aliyun_release_auth.py'):
   self.assertIn(ROOT/'tests'/name,seen)

if __name__=='__main__':unittest.main()
