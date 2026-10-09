#!/usr/bin/env python3
"""Dispatch the unchanged promotion workflow only through its frozen annotated tag."""
import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def require(ok, code):
    if not ok:
        raise ValueError(code)


def github(argv, payload=None):
    result = subprocess.run(['gh', 'api', *argv],
                            input=None if payload is None else json.dumps(payload),
                            text=True, capture_output=True, timeout=60)
    require(result.returncode == 0, 'PROMOTION_GITHUB_REQUEST_FAILED')
    return json.loads(result.stdout) if result.stdout.strip() else None


def promotion_runs(prefix, source, call=github):
    """Read every page for the exact frozen SHA, not lifetime workflow history.

    The bounded 1,000-run window rejects pathological same-SHA volumes without
    accepting a partial list (GitHub filtered run searches cap at 1,000).
    """
    runs = []
    seen = set()
    expected = None
    for page in range(1, 11):
        listing = call([f'{prefix}/actions/workflows/promote-cn-production.yml/runs?event=workflow_dispatch&head_sha={source}&per_page=100&page={page}'])
        batch = listing['workflow_runs']
        require(isinstance(batch, list) and len(batch) <= 100, 'PROMOTION_RUN_WINDOW_INVALID')
        count = listing.get('total_count')
        if count is not None:
            require(type(count) is int and 0 <= count < 1000, 'PROMOTION_RUN_WINDOW_AMBIGUOUS')
            require(expected is None or expected == count, 'PROMOTION_RUN_WINDOW_CHANGED')
            expected = count
        for run in batch:
            require(run['id'] not in seen, 'PROMOTION_RUN_WINDOW_CHANGED')
            seen.add(run['id'])
            runs.append(run)
        if len(batch) < 100:
            require(expected is None or len(runs) == expected, 'PROMOTION_RUN_WINDOW_INCOMPLETE')
            return runs
    raise ValueError('PROMOTION_RUN_WINDOW_AMBIGUOUS')


def dispatch(mode, repository, source, baseline, attempt, tag, call=github, correlate=False):
    require(mode in ('artifact-only', 'full-release'), 'INVALID_RELEASE_MODE')
    if mode == 'artifact-only':
        return {'dispatched': False, 'mode': mode}
    require(repository == 'boardx/workspacex', 'INVALID_REPOSITORY')
    require(all(re.fullmatch('[a-f0-9]{40}', v or '') for v in (source, baseline)), 'INVALID_RELEASE_IDENTITY')
    require(re.fullmatch('[a-z0-9][a-z0-9._-]{0,127}', attempt or ''), 'INVALID_ATTEMPT')
    require(tag == f'cn-prepared-{source}-{attempt}', 'INVALID_FROZEN_TAG')
    prefix = f'repos/{repository}'
    actual_baseline = call([f'{prefix}/git/ref/heads/main-cn'])['object']['sha']
    require(actual_baseline == baseline, 'BASELINE_CHANGED_BEFORE_DISPATCH')
    ref = call([f'{prefix}/git/ref/tags/{tag}'])
    require(ref['object']['type'] == 'tag', 'ANNOTATED_FROZEN_TAG_REQUIRED')
    frozen = call([f'{prefix}/git/tags/{ref["object"]["sha"]}'])
    require(frozen['tag'] == tag and frozen['object']['type'] == 'commit' and frozen['object']['sha'] == source,
            'FROZEN_TAG_SOURCE_MISMATCH')
    binding = json.loads(frozen['message'])
    require(binding['releaseSourceSha'] == source and binding['expectedMainCnSha'] == baseline
            and binding['attemptId'] == attempt, 'FROZEN_TAG_BINDING_MISMATCH')
    # Full host/governance evidence is validated by existing freeze-tag and again
    # by unchanged promotion readiness. This bridge grants no admission itself.
    payload = {'ref': tag, 'inputs': {'release_sha': source,
               'expected_main_cn_sha': baseline, 'release_attempt_id': attempt}}
    previous = []
    if correlate:
        previous = promotion_runs(prefix, source, call)
        require(not any(r.get('head_branch') == tag and r.get('head_sha') == source for r in previous),
                'PROMOTION_ALREADY_DISPATCHED')
    requested_at = datetime.now(timezone.utc).isoformat()
    call(['--method', 'POST', f'{prefix}/actions/workflows/promote-cn-production.yml/dispatches',
          '--input', '-'], payload)
    return {'schemaVersion': 1, 'dispatched': True, 'mode': mode, 'repository': repository,
            'source': source, 'baseline': baseline, 'attempt': attempt, 'tag': tag,
            'requestedAt': requested_at, 'previousRunIds': [r['id'] for r in previous]}


def main():
    p = argparse.ArgumentParser()
    for field in ('mode', 'repository', 'source', 'baseline', 'attempt', 'tag'):
        p.add_argument('--' + field, required=True)
    p.add_argument('--output', required=True)
    a = p.parse_args()
    value = dispatch(a.mode, a.repository, a.source, a.baseline, a.attempt, a.tag, correlate=True)
    Path(a.output).write_text(json.dumps(value, sort_keys=True) + "\n")
    print('FROZEN_PROMOTION_DISPATCH_REQUESTED' if value['dispatched'] else 'ARTIFACT_ONLY_NO_PROMOTION')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print('FROZEN_PROMOTION_DISPATCH_REJECTED', file=sys.stderr)
        sys.exit(1)
