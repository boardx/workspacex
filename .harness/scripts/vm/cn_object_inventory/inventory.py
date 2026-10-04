"""Bounded, injected DB-API inventory probe. No network/CLI entry point or logging.
Protected object keys exist only in the returned in-memory evidence; public_summary
is the only public representation. Never asserts release readiness/completeness.
"""
import hashlib
import json
import re
from dataclasses import dataclass, field

SOURCE_SHA = '9b25bfa65662b96c0826fe67506b562ea46aa6d0'

# (key, content hash, byte count). None explicitly means the schema has no
# proven content metadata; never substitute manifest_sha256 or an ETag.
SOURCES = {
    'artifact_versions': ('object_storage_key', 'content_hash', 'size_bytes'),
    'derived_representations': ('object_storage_key', None, None),
    'export_jobs': ('object_key', None, None),
    'org_avatar_artifacts': ('object_key', 'sha256', 'size_bytes'),
    'user_avatars': ('object_key', 'sha256', 'size_bytes'),
    'org_home_banner_artifacts': ('object_key', 'sha256', 'size_bytes'),
    'feedback_attachments': ('object_key', 'sha256', 'size_bytes'),
    'design_project_ref_images': ('object_key', 'sha256', 'size_bytes'),
    'survey_attachments': ('object_key', 'sha256', 'size_bytes'),
    'chat_thread_files': ('object_key', 'sha256', 'size_bytes'),
    'chat_message_attachments': ('storage_ref', None, 'bytes'),
    'interview_markdown_attachments': ('storage_ref', 'sha256', 'bytes'),
    'agent_artifact_versions': ('storage_key', None, 'size_bytes'),
    'download_grants': ('object_key', None, None),
    'whiteboard_documents': ('object_key', 'content_hash', 'byte_size'),
    'whiteboard_updates': ('update_object_key', 'update_hash', 'update_size'),
    'whiteboard_checkpoints': ('object_key', 'content_hash', 'byte_size'),
    'whiteboard_imports': ('source_object_key', 'sha256', 'size_bytes'),
    'whiteboard_asset_refs': ('object_key', 'content_hash', 'byte_size'),
    'whiteboard_exports': ('object_key', 'sha256', 'size_bytes'),
    'whiteboard_operation_undo': ('object_key', 'content_hash', 'byte_size'),
    'whiteboard_ai_proposals': ('object_key', 'content_hash', 'byte_size'),
    'whiteboard_comment_threads': ('body_object_key', 'body_hash', 'body_bytes'),
    'whiteboard_comment_requests': ('response_object_key', 'response_hash', 'response_bytes'),
    'whiteboard_image_assets': ('object_key', None, None),
    'whiteboard_backup_pins': ('object_key', None, None),
}

# GC records describe already-deleted/unrooted generations, not restore obligations.
HISTORICAL_REFERENCES = {
    ('public', 'whiteboard_object_tombstones', 'object_key'),
    ('public', 'whiteboard_object_purge_receipts', 'object_key'),
    ('public', 'whiteboard_object_gc_audit', 'object_key'),
}
EXTRA_SOURCES = [('chat_message_attachments', ('extracted_ref', None, None))]
JSON_SOURCES = [('agent_runs', 'model_output_files')]
PREDICATES = {
    'whiteboard_asset_refs': "released_at IS NULL AND (state='active' OR lease_expires_at>now())",
    'whiteboard_backup_pins': 'released_at IS NULL',
    'whiteboard_image_assets': "EXISTS(SELECT 1 FROM public.whiteboard_asset_refs r WHERE r.org_id=whiteboard_image_assets.org_id AND r.board_id=whiteboard_image_assets.board_id AND r.object_key=whiteboard_image_assets.object_key AND r.released_at IS NULL AND r.state='active')",
}

CATALOG_SQL = """SELECT n.nspname, c.relname, a.attname
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p')
AND n.nspname NOT IN ('pg_catalog','information_schema')
AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY n.nspname,c.relname,a.attnum"""

class InventoryError(Exception):
    """Only fixed codes, never database/provider text or object keys."""

@dataclass(repr=False)
class Evidence:
    objects: dict = field(default_factory=dict, repr=False)
    gaps: set = field(default_factory=set)
    observed_rows: int = 0
    tables_scanned: int = 0
    rolled_back: bool = False

    def __repr__(self):
        return '<ProtectedInventoryEvidence>'

    def public_summary(self):
        return {'sourceSha': SOURCE_SHA, 'ready': False, 'complete': False,
                'objectCount': len(self.objects), 'observedRows': self.observed_rows,
                'tablesScanned': self.tables_scanned, 'rolledBack': self.rolled_back,
                'gapCodes': sorted(self.gaps)}


def identifier(value):
    if not re.fullmatch(r'[a-z_][a-z0-9_]*', value):
        raise InventoryError('SCHEMA_IDENTIFIER_INVALID')
    return '"' + value + '"'


def content_hash(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise InventoryError('CONTENT_HASH_INVALID')
    value = value.removeprefix('sha256:')
    if not re.fullmatch('[a-f0-9]{64}', value):
        raise InventoryError('CONTENT_HASH_INVALID')
    return value


def byte_count(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise InventoryError('BYTE_COUNT_INVALID')
    return value


def merge(evidence, key, digest, size, origin):
    if not isinstance(key, str) or not key or '\x00' in key or len(key)>4096:
        raise InventoryError('OBJECT_REFERENCE_INVALID')
    digest, size = content_hash(digest), byte_count(size)
    previous = evidence.objects.get(key)
    if previous:
        for name, value in [('sha256', digest), ('bytes', size)]:
            if previous[name] is not None and value is not None and previous[name] != value:
                raise InventoryError('DUPLICATE_OBJECT_CONFLICT')
            if value is not None:
                previous[name] = value
        previous['sources'].add(origin)
    else:
        evidence.objects[key] = {'sha256': digest, 'bytes': size,
                                 'sources': {origin}, 'streamObservation': None}


def produce(connection, *, max_rows=100000):
    """Requires a dedicated idle connection. Caller owns closing it.
    DB transaction is enforced READ ONLY, REPEATABLE READ, row_security=off
    (a non-bypass role fails closed instead of silently returning tenant subsets).
    Scans direct rows plus extracted Markdown refs. GC history is excluded;
    released whiteboard refs use runtime root predicates. DB references alone
    cannot establish live object existence or snapshot closure.
    """
    if type(max_rows) is not int or max_rows < 1:
        raise InventoryError('ROW_BOUND_INVALID')
    evidence = Evidence(gaps={'SEMANTIC_OBJECT_CLOSURE_UNPROVEN',
                              'JSON_AND_INDIRECT_REFERENCES_UNAUDITED',
                              'OBJECT_STORE_EXISTENCE_UNVERIFIED'})
    try:
        cursor = connection.cursor()
    except Exception:
        raise InventoryError('DATABASE_CURSOR_OPEN_FAILED') from None
    failure = None
    try:
        cursor.execute('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        cursor.execute('SET LOCAL row_security = off')
        cursor.execute("SELECT current_setting('transaction_read_only'), current_setting('transaction_isolation')")
        if cursor.fetchone() != ('on', 'repeatable read'):
            raise InventoryError('READONLY_SNAPSHOT_UNPROVEN')
        cursor.execute(CATALOG_SQL)
        columns = {}
        for schema, table, column in cursor.fetchall():
            columns.setdefault((schema, table), set()).add(column)
        source_specs = list(SOURCES.items()) + EXTRA_SOURCES
        recognized = {('public', table, spec[0]) for table, spec in source_specs} | HISTORICAL_REFERENCES
        for (schema, table), names in columns.items():
            for name in names:
                if re.search(r'(object.*key|storage.*(?:key|ref)|blob.*(?:key|ref)|r2.*key|oss.*key|extracted_ref)', name):
                    if (schema, table, name) not in recognized:
                        evidence.gaps.add('UNMAPPED_CATALOG_REFERENCE')
        for table, (key, digest, size) in source_specs:
            names = columns.get(('public', table), set())
            if not {col for col in (key, digest, size) if col}.issubset(names):
                evidence.gaps.add('EXPECTED_SCHEMA_REFERENCE_MISSING')
                continue
            expressions = [identifier(key), identifier(digest) if digest else 'NULL',
                           identifier(size) if size else 'NULL']
            cursor.execute('SELECT ' + ','.join(expressions) + ' FROM "public".' + identifier(table)
                           + ' WHERE ' + identifier(key) + ' IS NOT NULL'
                           + (' AND (' + PREDICATES[table] + ')' if table in PREDICATES else ''))
            evidence.tables_scanned += 1
            while True:
                rows = cursor.fetchmany(1000)
                if not rows:
                    break
                for object_key, sha256, byte_size in rows:
                    evidence.observed_rows += 1
                    if evidence.observed_rows > max_rows:
                        raise InventoryError('INVENTORY_ROW_BOUND_EXCEEDED')
                    merge(evidence, object_key, sha256, byte_size, table)
        # Frozen #1624 persists outputs before an assistant attachment exists.
        # Scan every run status: queued writeback/failed runs may retain objects.
        for table, column in JSON_SOURCES:
            if column not in columns.get(('public', table), set()):
                evidence.gaps.add('EXPECTED_JSON_REFERENCE_MISSING')
                continue
            cursor.execute('SELECT '+identifier(column)+' FROM "public".'+identifier(table))
            evidence.tables_scanned += 1
            while True:
                rows = cursor.fetchmany(1000)
                if not rows:
                    break
                for (value,) in rows:
                    evidence.observed_rows += 1
                    if evidence.observed_rows > max_rows:
                        raise InventoryError('INVENTORY_ROW_BOUND_EXCEEDED')
                    if isinstance(value, str):
                        if len(value) > 4*1024*1024:
                            raise InventoryError('JSON_REFERENCE_BOUND_EXCEEDED')
                        try:
                            value = json.loads(value)
                        except Exception:
                            raise InventoryError('JSON_REFERENCE_INVALID') from None
                    if type(value) is not list:
                        raise InventoryError('JSON_REFERENCE_INVALID')
                    if len(value) > max_rows-evidence.observed_rows:
                        raise InventoryError('INVENTORY_ROW_BOUND_EXCEEDED')
                    for entry in value:
                        evidence.observed_rows += 1
                        if type(entry) is not dict or set(entry) != {'name','mime','sizeBytes','objectKey'} or not all(isinstance(entry[k],str) and entry[k] for k in ('name','mime')):
                            raise InventoryError('JSON_REFERENCE_INVALID')
                        if type(entry['sizeBytes']) is not int or entry['sizeBytes'] < 0:
                            raise InventoryError('BYTE_COUNT_INVALID')
                        merge(evidence, entry['objectKey'], None, entry['sizeBytes'], table+'.'+column)
        if any(row['sha256'] is None or row['bytes'] is None for row in evidence.objects.values()):
            evidence.gaps.add('CONTENT_METADATA_MISSING_REQUIRES_STREAM')
    except InventoryError as exc:
        failure = exc.args[0]
    except Exception:
        failure = 'DATABASE_PROBE_FAILED'
    finally:
        try:
            cursor.execute('ROLLBACK')
            evidence.rolled_back = True
        except Exception:
            failure = 'ROLLBACK_UNPROVEN'
        try:
            cursor.close()
        except Exception:
            failure = failure or 'CURSOR_CLOSE_FAILED'
    if failure:
        raise InventoryError(failure) from None
    return evidence


def observe_stream(evidence, key, chunks, *, max_bytes=1024*1024*1024):
    """Separate actual content observation, never repairs/rewrites DB expectations.
    Adapter must supply bytes from actual object GET; no HEAD/ETag substitution.
    No cloud adapter is provided or executed here.
    """
    if key not in evidence.objects:
        raise InventoryError('STREAM_REFERENCE_UNKNOWN')
    if type(max_bytes) is not int or max_bytes<0:
        raise InventoryError('STREAM_BOUND_INVALID')
    digest, total = hashlib.sha256(), 0
    try:
        for chunk in chunks:
            if not isinstance(chunk, bytes):
                raise InventoryError('STREAM_CHUNK_INVALID')
            total += len(chunk)
            if total > max_bytes:
                raise InventoryError('STREAM_BOUND_EXCEEDED')
            digest.update(chunk)
    except InventoryError:
        raise
    except Exception:
        raise InventoryError('STREAM_READ_FAILED') from None
    observation = {'sha256': digest.hexdigest(), 'bytes': total}
    expected = evidence.objects[key]
    if (expected['sha256'] is not None and expected['sha256'] != observation['sha256']) or (
            expected['bytes'] is not None and expected['bytes'] != total):
        raise InventoryError('STREAM_CONTENT_MISMATCH')
    if expected['streamObservation'] is not None and expected['streamObservation'] != observation:
        raise InventoryError('STREAM_OBSERVATION_CONFLICT')
    expected['streamObservation'] = observation
    return dict(observation)
