import importlib.util
from pathlib import Path
import unittest
import tempfile
import os
ROOT=Path(__file__).resolve().parents[1]
def module():
    spec=importlib.util.spec_from_file_location('schema_restore',ROOT/'scripts/schema-restore-rehearsal.py')
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
class ReviewPolicy(unittest.TestCase):
    def test_readiness_excludes_unix_only_temporary_init_server(self):
        args=module().clone_psql('/usr/bin/docker','a'*64,'SELECT 1')
        self.assertIn('--host=127.0.0.1',args)
        self.assertIn('--port=5432',args)
        self.assertEqual(args[-1],'SELECT 1')

    def test_only_exact_three_reviewed_sql_bytes_are_rehearsed(self):
        m=module();files={name:(ROOT/'apps/api/migrations'/name).read_bytes() for name in m.MIGRATIONS}
        self.assertEqual(len(m.reviewed_sql(files)),3)
        for bad in [{}, {**files,'other.sql':b'DROP TABLE users;'}, {**files,next(iter(files)):b'SELECT 1;'}]:
            with self.assertRaises(ValueError):m.reviewed_sql(bad)
    def test_clone_role_names_are_quoted_as_data(self):
        m=module();self.assertEqual(m.quote_ident('role";drop database main;--'),'"role"";drop database main;--"')
        for value in ['', 'bad\x00role',42]:
            with self.assertRaises(ValueError):m.quote_ident(value)
    def test_backup_inputs_are_private_regular_bounded_files(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);archive=root/'archive';key=root/'key'
            archive.write_bytes(b'x'*2048);key.write_bytes(b'a'*64)
            archive.chmod(0o600);key.chmod(0o600)
            m.private_backup_files(archive,key)
            key.chmod(0o644)
            with self.assertRaises(ValueError):m.private_backup_files(archive,key)
            key.chmod(0o600);link=root/'link';link.symlink_to(key)
            with self.assertRaises(ValueError):m.private_backup_files(archive,link)
            key.write_bytes(b'bad')
            with self.assertRaises(ValueError):m.private_backup_files(archive,key)

    def test_migration_ledger_must_be_nonempty_and_not_contain_new_files(self):
        m=module()
        for ledger in [{}, {'x.sql':'bad'}, {next(iter(m.MIGRATIONS)):'a'*64}]:
            with self.assertRaises(ValueError):m.check_ledger(ledger)
if __name__=='__main__':unittest.main()
