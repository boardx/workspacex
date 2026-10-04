"""Offline frozen-source discovery evidence; SQL heuristics are NOT completeness proof."""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from inventory import SOURCE_SHA, SOURCES


def git_read(*args):
    result = subprocess.run(['git', *args], capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError('FROZEN_SOURCE_READ_FAILED')
    return result.stdout.decode('utf-8')


def audit():
    paths = git_read('ls-tree', '-r', '--name-only', SOURCE_SHA).splitlines()
    evidence = []
    table_origins = {}
    for path in paths:
        if not path.startswith('apps/api/migrations/') or not path.endswith('.sql'):
            continue
        sql = git_read('show', SOURCE_SHA + ':' + path)
        matches = []
        for number, line in enumerate(sql.splitlines(), 1):
            # Capture declarations and other references, including storage_ref and
            # extracted_ref; keep only symbol names, not arbitrary SQL comments.
            names = sorted(set(re.findall(r'\b(?:[a-z_]*object[a-z_]*key|storage_key|storage_ref|extracted_ref|[a-z_]*(?:r2|oss|blob)_key)\b', line)))
            if names:
                matches.append({'line': number, 'symbols': names})
            for name in re.findall(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)', line, re.I):
                table_origins.setdefault(name, []).append({'path': path, 'line': number})
        if matches:
            evidence.append({'path': path, 'sourceFileSha256': hashlib.sha256(sql.encode()).hexdigest(),
                             'referenceSymbols': matches})
    return {'sourceSha': SOURCE_SHA, 'ready': False, 'complete': False,
            'method': 'all frozen apps/api/migrations SQL symbol scan; heuristic, not SQL parser',
            'mappedSourceTableOrigins': {table: table_origins.get(table, []) for table in SOURCES},
            'sourceReferenceFiles': evidence,
            'gaps': ['other schemas/packages', 'embedded JSON/URLs and indirect references',
                     'runtime-only object writes', 'live catalog and RLS coverage',
                     'bucket/object version identity and existence', 'no live probe executed']}

if __name__ == '__main__':
    output = Path(__file__).with_name('frozen-source-evidence.json')
    output.write_text(json.dumps(audit(), indent=2) + '\n')
