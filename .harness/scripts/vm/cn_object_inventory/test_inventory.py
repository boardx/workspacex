import hashlib
import unittest
from inventory import SOURCES, EXTRA_SOURCES, JSON_SOURCES, HISTORICAL_REFERENCES, Evidence, InventoryError, merge, observe_stream, produce

SHA = hashlib.sha256(b'fixture').hexdigest()
KEY = 'protected-fixture-object'

class Cursor:
    def __init__(self, rows=None, extra=None, fail=None):
        self.commands = []
        self.rows = rows or {}
        self.extra = extra or []
        self.fail = fail
        self.batch = []
        self.closed = False
    def execute(self, sql):
        self.commands.append(sql)
        if self.fail and self.fail in sql:
            raise RuntimeError('password=secret provider-error protected-fixture-object')
        if sql.startswith('SELECT "'):
            table = sql.split(' FROM "public"."')[1].split('"')[0]
            field = sql.split('SELECT "')[1].split('"')[0]
            self.batch = list(self.rows.get(table + '.' + field, self.rows.get(table, [])))
    def fetchone(self):
        return ('on', 'repeatable read')
    def fetchall(self):
        return [('public', table, col) for table, spec in list(SOURCES.items()) + EXTRA_SOURCES
                for col in spec if col] + [('public',t,c) for t,c in JSON_SOURCES] + self.extra
    def fetchmany(self, count):
        result, self.batch = self.batch[:count], self.batch[count:]
        return result
    def close(self):
        self.closed = True

class Connection:
    def __init__(self, cursor): self.the_cursor = cursor
    def cursor(self): return self.the_cursor

class InventoryTests(unittest.TestCase):
    def test_all_sources_snapshot_rollback_no_public_keys(self):
        c = Cursor({'artifact_versions': [(KEY, SHA, 7)],
                    'org_avatar_artifacts': [(KEY, 'sha256:'+SHA, 7)]})
        result = produce(Connection(c))
        self.assertEqual(result.tables_scanned, len(SOURCES) + len(EXTRA_SOURCES) + len(JSON_SOURCES))
        self.assertEqual(len(result.objects), 1)
        self.assertEqual(len(result.objects[KEY]['sources']), 2)
        self.assertEqual(c.commands[0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        self.assertEqual(c.commands[-1], 'ROLLBACK')
        self.assertTrue(c.closed)
        self.assertFalse(result.public_summary()['ready'])
        self.assertNotIn(KEY, str(result.public_summary()))
        self.assertNotIn(KEY, repr(result))
        self.assertFalse(any('manifest_sha256' in sql for sql in c.commands))

    def test_extracted_markdown_is_inventory_reference(self):
        result = produce(Connection(Cursor({'chat_message_attachments.extracted_ref': [(KEY, None, None)]})))
        self.assertIn(KEY, result.objects)
        self.assertIn('CONTENT_METADATA_MISSING_REQUIRES_STREAM', result.gaps)

    def test_agent_pending_outputs_not_only_message_attachments(self):
        entry={'name':'report.pdf','mime':'application/pdf','sizeBytes':7,'objectKey':KEY}
        c=Cursor({'agent_runs.model_output_files': [([entry],)]})
        result=produce(Connection(c))
        self.assertEqual(result.objects[KEY]['bytes'],7)
        self.assertIsNone(result.objects[KEY]['sha256'])
        self.assertIn('agent_runs.model_output_files',result.objects[KEY]['sources'])
        self.assertFalse(result.public_summary()['complete'])
        self.assertNotIn(KEY,str(result.public_summary()))
        self.assertTrue(any('"model_output_files"' in s and 'status' not in s for s in c.commands))

    def test_agent_output_json_invalid_conflict_and_bound_rollback(self):
        entry={'name':'report.pdf','mime':'application/pdf','sizeBytes':7,'objectKey':KEY}
        for value,code in [('{secret:bad}', 'JSON_REFERENCE_INVALID'),(None,'JSON_REFERENCE_INVALID'),
                           ([{**entry,'sizeBytes':True}],'BYTE_COUNT_INVALID'),
                           ([{**entry,'sizeBytes':None}],'BYTE_COUNT_INVALID'),
                           ([{**entry,'sizeBytes':-1}],'BYTE_COUNT_INVALID'),
                           ([{**entry,'objectKey':'\x00'}],'OBJECT_REFERENCE_INVALID'),
                           ([entry]*3,'INVENTORY_ROW_BOUND_EXCEEDED')]:
            c=Cursor({'agent_runs.model_output_files':[(value,)]})
            with self.assertRaisesRegex(InventoryError,'^'+code+'$'):
                produce(Connection(c),max_rows=3)
            self.assertEqual(c.commands[-1],'ROLLBACK')
        c=Cursor({'artifact_versions':[(KEY,SHA,8)],'agent_runs.model_output_files':[([entry],)]})
        with self.assertRaisesRegex(InventoryError,'^DUPLICATE_OBJECT_CONFLICT$'):
            produce(Connection(c))
        self.assertEqual(c.commands[-1],'ROLLBACK')

    def test_gc_history_excluded_and_live_root_predicates(self):
        c = Cursor({'whiteboard_object_gc_audit': [(KEY, 'bad-hash', 7)]},
                   extra=list(HISTORICAL_REFERENCES))
        result = produce(Connection(c))
        self.assertNotIn(KEY, result.objects)
        self.assertNotIn('UNMAPPED_CATALOG_REFERENCE', result.gaps)
        selects = [sql for sql in c.commands if sql.startswith('SELECT "')]
        self.assertFalse(any('whiteboard_object_gc_audit' in sql for sql in selects))
        self.assertTrue(any('lease_expires_at>now()' in sql for sql in selects))
        self.assertTrue(any('whiteboard_backup_pins' in sql and 'released_at IS NULL' in sql for sql in selects))

    def test_unknown_catalog_reference_is_gap(self):
        result = produce(Connection(Cursor(extra=[('public', 'new_table', 'blob_key')])))
        self.assertIn('UNMAPPED_CATALOG_REFERENCE', result.gaps)
        self.assertFalse(result.public_summary()['complete'])

    def test_duplicate_conflicts_rollback_hash_and_bytes(self):
        for digest, size in [('0'*64, 7), (SHA, 8)]:
            c = Cursor({'artifact_versions': [(KEY, SHA, 7)],
                        'org_avatar_artifacts': [(KEY, digest, size)]})
            with self.assertRaisesRegex(InventoryError, '^DUPLICATE_OBJECT_CONFLICT$'):
                produce(Connection(c))
            self.assertEqual(c.commands[-1], 'ROLLBACK')

    def test_db_error_never_leaks_and_rollback_failure_overrides(self):
        for stage, code in [('artifact_versions', 'DATABASE_PROBE_FAILED'),
                            ('ROLLBACK', 'ROLLBACK_UNPROVEN')]:
            c = Cursor(fail=stage)
            with self.assertRaisesRegex(InventoryError, '^'+code+'$'):
                produce(Connection(c))
            self.assertEqual(c.commands[-1], 'ROLLBACK')

    def test_bound_fails_instead_of_truncating(self):
        c = Cursor({'artifact_versions': [(KEY, SHA, 7)]*2})
        with self.assertRaisesRegex(InventoryError, '^INVENTORY_ROW_BOUND_EXCEEDED$'):
            produce(Connection(c), max_rows=1)
        self.assertEqual(c.commands[-1], 'ROLLBACK')

    def test_missing_sha_stream_is_separate_fact(self):
        e = produce(Connection(Cursor({'export_jobs': [(KEY, None, None)]})))
        self.assertIn('CONTENT_METADATA_MISSING_REQUIRES_STREAM', e.gaps)
        observed = observe_stream(e, KEY, iter([b'fi', b'xture']))
        self.assertEqual(observed, {'sha256': SHA, 'bytes': 7})
        self.assertIsNone(e.objects[KEY]['sha256'])
        self.assertIsNone(e.objects[KEY]['bytes'])
        self.assertFalse(e.public_summary()['ready'])

    def test_failed_stream_not_published_and_errors_sanitized(self):
        for chunks, bound, code in [([b'wrong'], 99, 'STREAM_CONTENT_MISMATCH'),
                                     ([b'fixture'], 1, 'STREAM_BOUND_EXCEEDED'),
                                     (['secret-content'], 99, 'STREAM_CHUNK_INVALID')]:
            e = Evidence()
            merge(e, KEY, SHA, 7, 'fixture')
            with self.assertRaisesRegex(InventoryError, '^'+code+'$'):
                observe_stream(e, KEY, chunks, max_bytes=bound)
            self.assertIsNone(e.objects[KEY]['streamObservation'])
        def failed():
            yield b'fi'
            raise RuntimeError('secret-provider-error')
        with self.assertRaisesRegex(InventoryError, '^STREAM_READ_FAILED$'):
            observe_stream(e, KEY, failed())

    def test_cursor_open_error_sanitized(self):
        class BadConnection:
            def cursor(self):
                raise RuntimeError('secret-provider-error')
        with self.assertRaisesRegex(InventoryError, '^DATABASE_CURSOR_OPEN_FAILED$'):
            produce(BadConnection())

    def test_empty_inventory_still_unproven(self):
        result = produce(Connection(Cursor()))
        self.assertFalse(result.public_summary()['complete'])
        self.assertIn('SEMANTIC_OBJECT_CLOSURE_UNPROVEN', result.gaps)

    def test_invalid_metadata_not_coerced(self):
        for digest, count, code in [('etag', 7, 'CONTENT_HASH_INVALID'),
                                    (SHA, '7', 'BYTE_COUNT_INVALID'),
                                    (SHA, True, 'BYTE_COUNT_INVALID')]:
            with self.assertRaisesRegex(InventoryError, '^'+code+'$'):
                merge(Evidence(), KEY, digest, count, 'fixture')

if __name__ == '__main__': unittest.main()
