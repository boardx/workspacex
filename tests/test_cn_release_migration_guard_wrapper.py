import importlib.util
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('migration_guard_wrapper',ROOT/'tests/cn_release_migration_guard_linux.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MigrationGuardWrapper(unittest.TestCase):
 def tap(self):
  names=json.loads(m.CASE_MANIFEST.read_bytes())['nodeCaseNames']
  return ('TAP version 13\n'+''.join('ok %d - %s\n'%(i+1,n)for i,n in enumerate(names))+'1..51\n# tests 51\n# pass 51\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n').encode()
 def test_exact_51_cases_preserve_real_names(self):
  result=m.validate_tap(self.tap());self.assertEqual(result['counts']['tests'],51);self.assertIn(m.REQUIRED_CASE,result['caseNames'])
 def test_no_empty_skipped_or_changed_count_can_pass(self):
  for raw in (b'',self.tap().replace(b'# skipped 0',b'# skipped 1'),self.tap().replace(b'# todo 0',b'# todo 1'),self.tap().replace(b'# fail 0',b'# fail 1'),self.tap().replace(b'# tests 51',b'# tests 49'),self.tap().replace(m.REQUIRED_CASE.encode(),m.REQUIRED_CASE.encode()+b' # SKIP')):
   with self.assertRaises(ValueError):m.validate_tap(raw)
 def test_duplicate_missing_and_wrong_epoch_counterexample_rejected(self):
  for raw in (self.tap().replace(json.loads(m.CASE_MANIFEST.read_bytes())['nodeCaseNames'][1].encode(),json.loads(m.CASE_MANIFEST.read_bytes())['nodeCaseNames'][0].encode()),self.tap().replace(m.REQUIRED_CASE.encode(),b'different case'),self.tap().replace(b'ok 2 -',b'ok 1 -'),self.tap()+b'# pass 51\n'):
   with self.assertRaises(ValueError):m.validate_tap(raw)
 def test_fixed_source_files_and_budget(self):
  self.assertEqual(len(m.TEST_FILES),3);self.assertEqual(m.BUDGET_SECONDS,180)
  self.assertEqual([Path(p).name for p in m.TEST_FILES],['migration_scope_adapter_test.ts','a_route_factory_test.ts','source_production_consumers_test.ts'])
 def test_contradictory_failure_or_bailout_is_never_green(self):
  for extra in (b'not ok 999 - unexpected failure\n',b'Bail out! failure\n',b'  not ok 1 - nested failure\n',b'  bail out! nested failure\n'):
   with self.subTest(extra=extra),self.assertRaisesRegex(ValueError,'TAP_FAILURE_OR_BAILOUT'):m.validate_tap(self.tap()+extra)
if __name__=='__main__':unittest.main()
