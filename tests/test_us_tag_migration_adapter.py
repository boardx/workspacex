import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch,Mock
ROOT=Path(__file__).resolve().parents[1]
def load(n,p):
 s=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=load('adapter',ROOT/'scripts/us-tag-migration-adapter.py');core=load('core',ROOT/'scripts/schema-restore-rehearsal.py')
class Tests(unittest.TestCase):
 def test_fixed_local_psql_has_no_environment_redirect(self):
  args=m.psql_args('a'*64);self.assertIn('--host=/var/run/postgresql',args);self.assertIn('-i',args);self.assertIn('/usr/bin/env',args);self.assertIn('--dbname=workspacex',args)
  with self.assertRaises(ValueError):m.psql_args('foreign')
 def test_exact_sql_and_ledger_share_single_transaction(self):
  files={n:(ROOT/'apps/api/migrations'/n).read_bytes() for n in core.MIGRATIONS};text=m.transaction_sql({'old.sql':'a'*64},files,core)
  self.assertEqual(text.count('COMMIT;'),1);self.assertTrue(text.startswith('BEGIN;'));self.assertIn('pg_try_advisory_xact_lock',text);self.assertIn('pg_stat_activity',text);self.assertIn('pg_prepared_xacts',text)
  self.assertEqual(text.count('INSERT INTO public._kernel_migrations'),3);self.assertLess(text.index('LEDGER_DRIFT'),text.index(files[next(iter(files))].decode()))
  with self.assertRaises(ValueError):m.transaction_sql({}, {'other.sql':b'SELECT 1'},core)
 def test_reconcile_is_read_only_and_never_replays_apply(self):
  a=object.__new__(m.Adapter);a.base={'old.sql':'a'*64};a.core=core;a.read=Mock(return_value={**a.base,**core.MIGRATIONS});a.execute=Mock()
  self.assertEqual(a.run('reconcile')['status'],'COMPLETE');a.execute.assert_not_called()
 def test_read_mode_rolls_back(self):
  a=object.__new__(m.Adapter);a.execute=Mock(return_value=Mock(returncode=0,stdout=b'{}'))
  a.read();text=a.execute.call_args.args[0];self.assertTrue(text.startswith('BEGIN READ ONLY;'));self.assertTrue(text.endswith('ROLLBACK;'))
 def test_commit_response_loss_retains_intent_and_blocks_replay(self):
  with tempfile.TemporaryDirectory() as directory:
   a=object.__new__(m.Adapter);a.attempt=Path(directory);a.core=core;a.base={'old.sql':'a'*64}
   a.stopped=Mock();a.require_backup=Mock();a.read=Mock(return_value=a.base)
   a.sql_files=Mock(return_value={n:(ROOT/'apps/api/migrations'/n).read_bytes() for n in core.MIGRATIONS})
   a.execute=Mock(side_effect=TimeoutError())
   self.assertEqual(a.run('apply')['status'],'COMMIT_UNKNOWN_RECONCILE_REQUIRED')
   self.assertTrue((a.attempt/'database-transaction-intent.json').exists())
   with self.assertRaises(FileExistsError):a.run('apply')
   self.assertEqual(a.execute.call_count,1)
 def test_apply_requires_original_stopped_backup_qualification(self):
  a=object.__new__(m.Adapter);a.base={'old.sql':'a'*64};a.core=core;a.require_backup=Mock(side_effect=ValueError('BACKUP_REQUIRED'));a.stopped=Mock();a.read=Mock();a.sql_files=Mock()
  with self.assertRaisesRegex(ValueError,'BACKUP_REQUIRED'):a.run('apply')
  a.sql_files.assert_not_called()
 def test_backup_missing_expired_tampered_identity_refused(self):
  import json
  with tempfile.TemporaryDirectory() as directory:
   d=Path(directory)/'stopped-backup';d.mkdir();proof=d/'qualification.json'
   trust=lambda path,**kw:Path(path)
   with self.assertRaises(FileNotFoundError):m.validate_backup(Path(directory),{},core,trust,now=2000)
   proof.write_text(json.dumps({'identity':{},'preparedAt':0,'files':{}}))
   with self.assertRaisesRegex(ValueError,'BACKUP_EXPIRED'):m.validate_backup(Path(directory),{},core,trust,now=2000)
   proof.write_text(json.dumps({'identity':{'environment':'cn'},'preparedAt':1999,'files':{}}))
   with self.assertRaisesRegex(ValueError,'BACKUP_SOURCE_BINDING'):m.validate_backup(Path(directory),{},core,trust,now=2000)
   proof.write_text(json.dumps({'identity':{},'preparedAt':1999,'files':{}}))
   with self.assertRaisesRegex(ValueError,'BACKUP_PROOF_SET'):m.validate_backup(Path(directory),{},core,trust,now=2000)
 def test_bootstrap_validates_before_import(self):
  text=(ROOT/'scripts/us-tag-migration-adapter.py').read_text();self.assertLess(text.index("trusted_closure(HERE/name)"),text.index("self.prep=load"))
 def test_nonheld_descriptor_rejected(self):
  with self.assertRaisesRegex(ValueError,'INHERITED_LOCK_REQUIRED'):m.inherited_lock(-1)
if __name__=='__main__':unittest.main()
