#!/usr/bin/env python3
"""Observe frozen promotion completion; never deploy, retry dispatch, or repair state."""
import argparse
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import time

SPEC = importlib.util.spec_from_file_location('frozen_dispatch', Path(__file__).with_name('dispatch-frozen-promotion.py'))
dispatch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dispatch)
require = dispatch.require


def validate(value):
    require(value.get('schemaVersion') == 1 and value.get('dispatched') is True,
            'INVALID_PROMOTION_CORRELATION')
    require(value.get('repository') == 'boardx/workspacex', 'INVALID_REPOSITORY')
    require(all(re.fullmatch('[a-f0-9]{40}', value.get(k, '')) for k in ('source', 'baseline')), 'INVALID_RELEASE_IDENTITY')
    require(re.fullmatch('[a-z0-9][a-z0-9._-]{0,127}', value.get('attempt', '')), 'INVALID_ATTEMPT')
    require(value.get('tag') == f"cn-prepared-{value['source']}-{value['attempt']}", 'INVALID_FROZEN_TAG')
    require(isinstance(value.get('previousRunIds'), list) and all(type(v) is int for v in value['previousRunIds']), 'INVALID_RUN_IDS')
    stamp = datetime.fromisoformat(value['requestedAt'])
    require(stamp.tzinfo is not None, 'INVALID_DISPATCH_TIME')
    return stamp


def observe(value, call=dispatch.github, timeout=3600, interval=15, clock=time.monotonic, sleep=time.sleep):
    stamp = validate(value)
    require(0 < timeout <= 7200 and 0 < interval <= 60, 'INVALID_OBSERVATION_BOUND')
    prefix = f"repos/{value['repository']}"
    deadline = clock() + timeout
    selected = None
    while clock() < deadline:
        runs = dispatch.promotion_runs(prefix, value['source'], call)
        candidates = [r for r in runs if r['id'] not in value['previousRunIds'] and
                      r.get('head_branch') == value['tag'] and r.get('head_sha') == value['source'] and
                      r.get('event') == 'workflow_dispatch' and
                      datetime.fromisoformat(r['created_at'].replace('Z', '+00:00')) >= stamp.replace(microsecond=0)]
        require(len(candidates) <= 1, 'PROMOTION_DUPLICATE_RUN')
        if candidates:
            run = candidates[0]
            require(selected is None or selected == run['id'], 'PROMOTION_RUN_CHANGED')
            selected = run['id']
            require(run.get('run_attempt') == 1, 'PROMOTION_RERUN_NOT_AUTHORIZED')
            if run.get('status') == 'completed':
                require(run.get('conclusion') == 'success', 'PROMOTION_DOWNSTREAM_FAILED')
                jobs = call([f'{prefix}/actions/runs/{selected}/attempts/1/jobs?per_page=100'])
                require(jobs.get('total_count', 101) <= 100, 'PROMOTION_JOBS_INCOMPLETE')
                # Existing readiness/admit/promote jobs enforce host receipts,
                # migration, governance, activation and full business acceptance.
                # A health response or dispatch acknowledgment cannot replace them.
                for name in ('readiness', 'admit', 'promote'):
                    matches = [j for j in jobs['jobs'] if j.get('name') == name]
                    require(len(matches) == 1 and matches[0].get('status') == 'completed' and
                            matches[0].get('conclusion') == 'success', 'PROMOTION_BUSINESS_GATE_NOT_PROVEN')
                require(call([f'{prefix}/git/ref/heads/main-cn'])['object']['sha'] == value['source'], 'PROMOTION_REF_NOT_COMMITTED')
                return {'schemaVersion': 1, 'source': value['source'], 'attempt': value['attempt'],
                        'tag': value['tag'], 'runId': selected, 'runAttempt': 1,
                        'conclusion': 'success', 'businessGateEvidence': 'existing-readiness-admit-promote-jobs',
                        'mainCnVerified': True}
        sleep(min(interval, max(0, deadline - clock())))
    raise ValueError('PROMOTION_OBSERVATION_TIMEOUT')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--correlation', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--timeout-seconds', type=int, default=3600)
    a = p.parse_args()
    result = observe(json.loads(Path(a.correlation).read_text()), timeout=a.timeout_seconds)
    Path(a.output).write_text(json.dumps(result, sort_keys=True) + '\n')
    print('FROZEN_PROMOTION_TERMINAL_VERIFIED')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError):
        print('FROZEN_PROMOTION_TERMINAL_REJECTED', file=sys.stderr)
        sys.exit(1)
