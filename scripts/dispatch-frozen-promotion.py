#!/usr/bin/env python3
"""Dispatch the unchanged promotion workflow only through its frozen annotated tag."""
import argparse
import json
import re
import subprocess
import sys


def require(ok, code):
    if not ok:
        raise ValueError(code)


def github(argv, payload=None):
    result = subprocess.run(['gh', 'api', *argv],
                            input=None if payload is None else json.dumps(payload),
                            text=True, capture_output=True, timeout=60)
    require(result.returncode == 0, 'PROMOTION_GITHUB_REQUEST_FAILED')
    return json.loads(result.stdout) if result.stdout.strip() else None


def dispatch(mode, repository, source, baseline, attempt, tag, call=github):
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
    call(['--method', 'POST', f'{prefix}/actions/workflows/promote-cn-production.yml/dispatches',
          '--input', '-'], payload)
    return {'dispatched': True, 'mode': mode}


def main():
    p = argparse.ArgumentParser()
    for field in ('mode', 'repository', 'source', 'baseline', 'attempt', 'tag'):
        p.add_argument('--' + field, required=True)
    a = p.parse_args()
    value = dispatch(a.mode, a.repository, a.source, a.baseline, a.attempt, a.tag)
    print('FROZEN_PROMOTION_DISPATCH_REQUESTED' if value['dispatched'] else 'ARTIFACT_ONLY_NO_PROMOTION')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print('FROZEN_PROMOTION_DISPATCH_REJECTED', file=sys.stderr)
        sys.exit(1)
