import importlib.util,json,pathlib,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('probe',pathlib.Path(__file__).parents[1]/'asr-accounting-probe.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Probe(unittest.TestCase):
 def test_mount_must_be_persistent_rw_and_most_specific(self):
  self.assertFalse(m.persistent_mount({},'/private'))
  row={'Mounts':[{'Destination':'/data','Type':'volume','RW':True}]}
  self.assertTrue(m.persistent_mount(row,'/data/receipts'))
  self.assertFalse(m.persistent_mount(row,'/database'))
  row['Mounts'].append({'Destination':'/data/receipts','Type':'tmpfs','RW':True})
  self.assertFalse(m.persistent_mount(row,'/data/receipts'))
 def test_sql_literal_cannot_change_fixed_query(self):
  self.assertEqual(m.literal("a'b"),"'a''b'")
 def test_errors_never_expose_command_output(self):
  result=type('Result',(),{'returncode':1,'stdout':'secret'})()
  with patch.object(m.subprocess,'run',return_value=result):
   with self.assertRaisesRegex(ValueError,'^probe_command_unavailable$'):m.call(['docker'])
 def test_diagnostic_dispatch_skips_legacy_private_output(self):
  text=(pathlib.Path(__file__).parents[4]/'.github/workflows/devapp-probe.yml').read_text()
  self.assertIn('if: ${{ !inputs.asr_accounting }}',text)
  self.assertIn('if: ${{ inputs.asr_accounting }}',text)
  self.assertNotIn('readFile',m.STORAGE)
  self.assertNotIn('write',m.STORAGE)
