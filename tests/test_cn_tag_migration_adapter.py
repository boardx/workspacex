import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
P=Path(__file__).resolve().parents[1]/'scripts/cn-tag-migration-adapter.py';s=importlib.util.spec_from_file_location('cn_adapter',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Transaction(unittest.TestCase):
 def adapter(self):
  a=object.__new__(m.Adapter);a.attempt=Path('/private/attempt');a.core=Mock();a.stopped=Mock();a.execute=Mock();a.require_backup=Mock();return a
 def test_lost_commit_never_retries(self):
  a=self.adapter();a.execute.side_effect=[{'status':'BASELINE'},TimeoutError()];self.assertEqual(a.run('apply')['status'],'COMMIT_UNKNOWN_RECONCILE_REQUIRED');self.assertEqual([c.args[0] for c in a.execute.call_args_list],['preflight','apply']);a.stopped.assert_called_once();a.core.save.assert_called_once()
 def test_durable_intent_failure_never_starts_writer(self):
  a=self.adapter();a.execute.return_value={'status':'BASELINE'};a.core.save.side_effect=FileExistsError()
  with self.assertRaises(FileExistsError):a.run('apply')
  a.execute.assert_called_once_with('preflight')
 def test_read_only_reconcile_does_not_stop_or_write(self):
  a=self.adapter();a.execute.return_value={'status':'COMPLETE'};self.assertEqual(a.run('reconcile')['status'],'COMPLETE');a.stopped.assert_not_called();a.core.save.assert_not_called()
if __name__=='__main__':unittest.main()

class BackupGate(unittest.TestCase):
 def test_missing_qualification_prevents_any_database_operation(self):
  a=object.__new__(m.Adapter);a.require_backup=Mock(side_effect=ValueError('BACKUP_MISSING'));a.execute=Mock();a.stopped=Mock();a.core=Mock()
  with self.assertRaisesRegex(ValueError,'BACKUP_MISSING'):a.run('apply')
  a.execute.assert_not_called();a.core.save.assert_not_called()

class ImportBoundary(unittest.TestCase):
 def test_closure_rejected_before_dynamic_load(self):
  from unittest.mock import patch
  with patch.object(m,'trusted',side_effect=ValueError('CODE_TRUST')),patch.object(m,'load') as loader:
   with self.assertRaisesRegex(ValueError,'CODE_TRUST'):m.Adapter('/private/attempt',3)
   loader.assert_not_called()

class CompleteDrain(unittest.TestCase):
 def test_complete_schema_is_valid_for_unknown_commit_recovery_drain(self):
  self.assertEqual(m.drained({'status':'COMPLETE','readOnly':True}),{'status':'DRAINED','ledgerStatus':'COMPLETE','readOnly':True})
  self.assertEqual(m.drained({'status':'BASELINE'})['ledgerStatus'],'BASELINE')
  with self.assertRaises(ValueError):m.drained({'status':'DRIFT'})
