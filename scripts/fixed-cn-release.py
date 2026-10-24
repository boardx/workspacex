#!/usr/bin/env python3
"""Fixed request admission and offline stage engine. No production execution mode."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import signal
import time

SOURCE = 'bc3d1254ce05c915801fb73fe6698072730a051c'
CONTROL = '5acebbb6741ed13c6379407aa0529c0eb8695b72'
RUN = 38852606085
RUN_ATTEMPT = 2  # Same fixed source/control, explicitly authorized expired-build rerun.
TARGET = 'i-uf6ga92ewloganobbln6'
ROLES = ('api', 'web', 'agent', 'sandbox', 'postgres')
STAGES = ('candidate', 'readonly-preflight', 'image-transfer', 'compose-image-only', 'health', 'business')
TIMEOUTS = dict(zip(STAGES, (60, 30, 120, 180, 30, 60)))
BLOCKERS = ['NO_APPROVED_CLOUD_IDENTITY', 'NEW_PROBE_REQUIRES_SEPARATE_APPROVAL',
            'UNKNOWN_PRODUCTION_SQL_COMPATIBILITY', 'A1_A4_NOT_EXECUTED',
            'NO_PRODUCTION_TRANSFER_OR_BUSINESS_EVIDENCE']

class Rejected(Exception):
    pass

def need(ok, code):
    if not ok:
        raise Rejected(code)

def raw(obj):
    return (json.dumps(obj, sort_keys=True, indent=2) + '\n').encode()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def admission(run, artifacts, now):
    """Metadata-only: availability is NOT download, archive or image verification."""
    need(run['id'] == RUN and run['head_sha'] == CONTROL and run['run_attempt'] == RUN_ATTEMPT,
         'FIXED_CONTROL_RUN_MISMATCH')
    need(run['status'] == 'completed' and run['conclusion'] == 'success', 'BUILD_NOT_SUCCESSFUL')
    need(run['path'] == '.github/workflows/build-cn-image-candidates.yml', 'BUILD_WORKFLOW_MISMATCH')
    names = (['cn-image-candidate-set', 'cn-candidate-plan']
             + ['cn-image-candidate-' + r for r in ROLES]
             + ['cn-image-candidate-metadata-' + r for r in ROLES])
    rows = []
    for name in names:
        matches = [a for a in artifacts if a['name'] == f'{name}-{RUN}-{RUN_ATTEMPT}']
        need(len(matches) == 1, 'ARTIFACT_MISSING_OR_DUPLICATE')
        a = matches[0]
        expiry = dt.datetime.fromisoformat(a['expires_at'].replace('Z', '+00:00'))
        need(not a['expired'] and expiry > now, 'ARTIFACT_EXPIRED')
        need(a['size_in_bytes'] > 0, 'ARTIFACT_EMPTY')
        rows.append({k: a[k] for k in ('id', 'name', 'expires_at', 'size_in_bytes')})
    return {'kind': 'github-metadata-only', 'observedAt': now.isoformat(),
            'expectedSource': SOURCE, 'control': CONTROL, 'run': RUN, 'runAttempt': RUN_ATTEMPT, 'artifacts': rows,
            'sourceBytesVerified': False, 'downloadVerified': False, 'ready': False,
            'productionExecuted': False, 'blockers': BLOCKERS}

def github(path):
    p = subprocess.run(['gh', 'api', 'repos/boardx/workspacex/' + path],
                       capture_output=True, timeout=60, check=False)
    need(p.returncode == 0, 'GITHUB_READ_FAILED')  # Never print signed URLs/provider stderr.
    return json.loads(p.stdout)

def inspect():
    run = github(f'actions/runs/{RUN}')
    page = github(f'actions/runs/{RUN}/artifacts?per_page=100')
    need(page['total_count'] == len(page['artifacts']), 'INCOMPLETE_ARTIFACT_PAGE')
    return admission(run, page['artifacts'],
                     dt.datetime.now(dt.timezone.utc))

def simulate(output, adapter, source=SOURCE):
    """Adapter is test-owned Python code, never a CLI command or production transport.

    Each adapter operation returns evidence bytes after a bounded child process.
    Exclusive output prevents replay; intent without receipt requires reconciliation.
    """
    out = Path(output)
    out.mkdir(mode=0o700, parents=False, exist_ok=False)
    completed = []
    stage = 'candidate'
    try:
        need(source == SOURCE, 'FIXED_SOURCE_MISMATCH')
        for stage in STAGES:
            (out / f'{stage}.intent.json').write_bytes(raw({
                'stage': stage, 'startedAt': utc(), 'source': source,
                'timeoutSeconds': TIMEOUTS[stage], 'simulation': True}))
            started = time.monotonic()
            previous = signal.getsignal(signal.SIGALRM)
            def expired(*_):
                raise Rejected('STAGE_TIMEOUT')
            signal.signal(signal.SIGALRM, expired)
            signal.setitimer(signal.ITIMER_REAL, TIMEOUTS[stage])
            try:
                evidence = adapter(stage, TIMEOUTS[stage])
                need(time.monotonic() - started < TIMEOUTS[stage], 'STAGE_TIMEOUT')
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, previous)
            need(isinstance(evidence, bytes) and bool(evidence), 'EVIDENCE_MISSING')
            body = json.loads(evidence)
            need(body.get('stage') == stage and body.get('source') == SOURCE
                 and body.get('simulation') is True and body.get('passed') is True,
                 'EVIDENCE_BINDING_OR_FAILURE')
            need(body.get('control') == CONTROL and body.get('run') == RUN,
                 'EVIDENCE_IDENTITY_MISMATCH')
            (out / f'{stage}.evidence.json').write_bytes(evidence)
            receipt = {'stage': stage, 'finishedAt': utc(), 'sha256': sha(evidence),
                       'simulation': True, 'source': source}
            (out / f'{stage}.receipt.json').write_bytes(raw(receipt))
            completed.append(receipt)
        result = {'status': 'SIMULATION_PASSED', 'completed': completed}
    except Exception as error:
        code = str(error) if isinstance(error, Rejected) else (
            'STAGE_TIMEOUT' if isinstance(error, subprocess.TimeoutExpired) else 'STAGE_FAILED')
        result = {'status': 'SIMULATION_FAILED', 'failedStage': stage,
                  'code': code, 'completed': completed}
    result.update(simulation=True, productionExecuted=False, productionAccepted=False,
                  automaticRetry=False, blockers=BLOCKERS,
                  recovery='Retain intent/evidence. Inspect uncertain action before a fresh isolated attempt; never replay a production write.')
    (out / 'result.json').write_bytes(raw(result))
    return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=('inspect', 'probe-hash', 'stage-local'))
    p.add_argument('--request', help='Reviewed local stage request JSON; no network or Docker')
    a = p.parse_args()
    try:
        if a.mode == 'probe-hash':
            probe = Path(__file__).with_name('fixed-cn-readonly-probe.sh')
            result = {'path': str(probe), 'sha256': sha(probe.read_bytes()),
                      'executionApproved': False, 'productionExecuted': False}
        elif a.mode == 'stage-local':
            import sys
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            import fixed_cn_bundle
            need(a.request is not None, 'STAGE_REQUEST_REQUIRED')
            request_raw = Path(a.request).read_bytes()
            need(len(request_raw) <= 16384, 'STAGE_REQUEST_SIZE')
            request = json.loads(request_raw)
            need(set(request) == {'bundle', 'plan', 'planSha256', 'candidate', 'candidateSha256', 'inventory', 'output'}, 'STAGE_REQUEST_FIELDS')
            result = fixed_cn_bundle.stage(request['bundle'], Path(request['plan']).read_bytes(),
                request['planSha256'], Path(request['candidate']).read_bytes(), request['candidateSha256'],
                json.loads(Path(request['inventory']).read_bytes()), request['output'])
        else:
            result = inspect()
        print(raw(result).decode(), end='')
        return 0
    except Exception as error:
        print(raw({'status': 'BLOCKED', 'code': str(error) if isinstance(error, Rejected)
                   else 'READ_FAILED', 'ready': False, 'productionExecuted': False}).decode(), end='')
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
