"""Repository-only test against exact Git objects; no DB/cloud contact."""
import json
import re
import unittest
from pathlib import Path
from inventory import SOURCES, EXTRA_SOURCES, SOURCE_SHA
from source_audit import audit, git_read

class FrozenSchemaTests(unittest.TestCase):
    def test_frozen_source_evidence_and_fields(self):
        saved = json.loads(Path(__file__).with_name('frozen-source-evidence.json').read_text())
        self.assertEqual(saved, audit())
        # Limit claim: token presence in table CREATE/ALTER statements. Does not
        # interpret later DROP, ALTER types, functions or dynamic SQL.
        all_sql = '\n'.join(git_read('show', SOURCE_SHA+':'+item['path'])
                            for item in saved['sourceReferenceFiles'])
        all_sql = re.sub(r'--[^\n]*', '', all_sql)
        for table, columns in list(SOURCES.items()) + EXTRA_SOURCES:
            statements = re.findall(
                r'(?:CREATE TABLE (?:IF NOT EXISTS )?|ALTER TABLE )'+re.escape(table)+r'\b[^;]*;',
                all_sql, re.I)
            self.assertTrue(statements, table)
            for col in columns:
                if col:
                    self.assertRegex('\n'.join(statements), r'\b'+col+r'\b', table+'.'+col)
        self.assertFalse(saved['complete'])
        self.assertFalse(saved['ready'])

if __name__ == '__main__': unittest.main()
