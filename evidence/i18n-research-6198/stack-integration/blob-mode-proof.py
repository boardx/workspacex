"""Read-only proof against immutable Git trees; run from repository root."""
import json
import subprocess
import sys


def git(*args):
    return subprocess.check_output(['git', *args]).decode().strip()


def entries(ref):
    return {
        row.split('\t', 1)[1]: row.split('\t', 1)[0]
        for row in git('ls-tree', '-r', ref).splitlines()
    }


worker, upstream, candidate = sys.argv[1:]
base = git('merge-base', worker, upstream)
paths = lambda ref: set(filter(None, git('diff', '--name-only', base, ref).splitlines()))
worker_paths, upstream_paths = paths(worker), paths(upstream)
overlap = worker_paths & upstream_paths
assert overlap == {'apps/web/lib/i18n/messages/en.ts', 'apps/web/lib/i18n/messages/zh-CN.ts'}
merged = entries(candidate)
for changed, expected_ref in [(worker_paths - overlap, worker), (upstream_paths - overlap, upstream)]:
    expected = entries(expected_ref)
    for file in changed:
        assert merged.get(file) == expected.get(file), file
print(json.dumps(dict(worker=worker, upstream=upstream, candidate=candidate,
                     mergeBase=base, candidateTree=git('rev-parse', candidate + '^{tree}'),
                     workerExactBlobsAndModes=len(worker_paths - overlap),
                     upstreamExactBlobsAndModes=len(upstream_paths - overlap),
                     overlap=sorted(overlap)), indent=2))
