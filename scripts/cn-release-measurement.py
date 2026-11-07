#!/usr/bin/env python3
"""Read original durable-entry receipts; never executes or admits a release."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('measurement_entry', ROOT/'.harness/scripts/vm/cn-release-advance.py')
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)
LIMIT = 65536
CAP = 1800


class Rejected(ValueError):
    pass


def need(value, code):
    if not value:
        raise Rejected(code)


def instant(value):
    need(isinstance(value, str), 'UTC_TIMESTAMP')
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise Rejected('UTC_TIMESTAMP') from None
    need(parsed.tzinfo is not None and parsed.utcoffset() == dt.timedelta(0), 'UTC_TIMESTAMP')
    return parsed


def pairs(items):
    result = {}
    for key, value in items:
        need(key not in result, 'DUPLICATE_KEY')
        result[key] = value
    return result


def decode(raw):
    try:
        return json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError, RecursionError):
        raise Rejected('JSON_INVALID') from None


def read(root, name):
    # Only fixed children. The snapshot is caller-supplied, never trusted root evidence.
    need(root.is_absolute() and root.resolve() == root, 'SNAPSHOT_PATH')
    for parent in (root, *root.parents):
        need(stat.S_ISDIR(parent.lstat().st_mode), 'SNAPSHOT_PARENT')
    fd = os.open(root/name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= LIMIT, 'FILE_BOUND')
        raw = stream.read(LIMIT+1)
        after = os.fstat(stream.fileno())
        need(len(raw) == before.st_size and (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'FILE_CHANGED')
    return raw


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def union_seconds(intervals):
    total = 0.0
    end = None
    for start, finish in sorted(intervals):
        if end is None or start > end:
            total += (finish-start).total_seconds()
        elif finish > end:
            total += (finish-end).total_seconds()
        end = max(end, finish) if end else finish
    return total


def report(root, *, github_accepted_at, user_requested_at, observed_at=None, waits=()):
    """Preserves original clock/hash chain; incomplete or unmeasured is not PASS.

    Wait rows are reporting annotations, not independently verified scheduler facts.
    No privileged path, SDK, subprocess, approval, stage action or resume is invoked.
    """
    root = Path(root)
    current = instant(observed_at or dt.datetime.now(dt.timezone.utc).isoformat())
    github_start, user_start = instant(github_accepted_at), instant(user_requested_at)
    raw_identity = read(root, 'identity.json')
    identity = decode(raw_identity)
    need(type(identity) is dict and set(identity) == {'sourceRevision', 'baselineRevision',
         'controlRevision', 'attemptId', 'scope', 'requestedAt', 'deadlineAt'}, 'IDENTITY_FIELDS')
    need(identity['scope'] == 'runtime-only-reviewed-continuation', 'IDENTITY_SCOPE')
    for key in ('sourceRevision', 'baselineRevision', 'controlRevision'):
        need(re.fullmatch('[a-f0-9]{40}', identity.get(key, '')), 'EXACT_REVISION')
    need(entry.ATTEMPT.fullmatch(identity.get('attemptId', '')), 'ATTEMPT')
    requested, deadline = instant(identity['requestedAt']), instant(identity['deadlineAt'])
    need(user_start <= github_start <= requested < deadline and requested <= current, 'CLOCK_ORDER')
    previous = None
    rows, intervals, missing, uncertain = [], [], [], []
    last = requested
    for index, stage in enumerate(entry.STAGES):
        prefix = '%02d-%s' % (index, stage)
        try:
            receipt_raw = read(root, prefix+'.receipt.json')
        except FileNotFoundError:
            missing.append(stage)
            try:
                read(root, prefix+'.intent.json')
                uncertain.append(stage)
            except FileNotFoundError:
                pass
            continue
        need(not missing, 'RECEIPT_AFTER_GAP')
        receipt = decode(receipt_raw)
        intent_raw = read(root, prefix+'.intent.json')
        intent = decode(intent_raw)
        need(type(receipt) is dict and type(intent) is dict, 'RECEIPT_INTENT_OBJECT')
        need(all(receipt.get(k) == v for k, v in identity.items()), 'IDENTITY_DRIFT')
        need(receipt.get('stage') == intent.get('stage') == stage, 'STAGE_DRIFT')
        need(receipt.get('previousReceiptSha256') == intent.get('previousReceiptSha256') == previous, 'CHAIN_DRIFT')
        request = receipt.get('requestSha256', '')
        need(re.fullmatch('[a-f0-9]{64}', request) and intent.get('requestSha256') == request, 'REQUEST_DRIFT')
        for key, suffix in (('evidenceSha256', '.evidence.json'),
                            ('terminalObservationSha256', '.terminal-observation.json'),
                            ('admissionSha256', '.admission.json')):
            pin = receipt.get(key, '')
            need(isinstance(pin, str) and re.fullmatch('[a-f0-9]{64}', pin), 'EVIDENCE_PIN')
            need(digest(read(root, prefix+suffix)) == pin, 'EVIDENCE_CHANGED')
        need(receipt.get('mode') in ('advance', 'reconcile'), 'RECEIPT_MODE')
        start, finish = instant(intent['createdAt']), instant(receipt['finishedAt'])
        need(last <= start <= finish <= current, 'STAGE_CLOCK_ORDER')
        elapsed = (finish-requested).total_seconds()
        need(type(receipt.get('elapsedSeconds')) in (int, float) and receipt['elapsedSeconds'] == elapsed, 'ELAPSED_DRIFT')
        need(receipt.get('withinTotalBudget') is (finish <= deadline), 'DEADLINE_DRIFT')
        previous = digest(receipt_raw)
        rows.append(dict(stage=stage, startedAt=intent['createdAt'], finishedAt=receipt['finishedAt'],
                         seconds=(finish-start).total_seconds(), receiptSha256=previous,
                         intentSha256=digest(intent_raw)))
        intervals.append((start, finish))
        last = finish
    complete = not missing
    # Complete transport != A3/A4 proof, final stable observer bytes, or production completion.
    end = last if complete else current
    annotations = {'queue': [], 'approval': []}
    for wait in waits:
        need(set(wait) == {'kind', 'startedAt', 'finishedAt'} and wait['kind'] in annotations, 'WAIT_FIELDS')
        start, finish = instant(wait['startedAt']), instant(wait['finishedAt'])
        need(github_start <= start <= finish <= end, 'WAIT_CLOCK_ORDER')
        annotations[wait['kind']].append((start, finish))
    active = union_seconds(intervals)
    waiting = [span for values in annotations.values() for span in values]
    covered = union_seconds(intervals+waiting)
    github_seconds = (end-github_start).total_seconds()
    return dict(kind='cn-release-measurement-v1', sourceRevision=identity['sourceRevision'],
                controlRevision=identity['controlRevision'], attemptId=identity['attemptId'],
                identityRawSha256=digest(raw_identity), observedAt=current.isoformat(),
                userRequestedAt=user_requested_at, githubAcceptedAt=github_accepted_at,
                transportEndAt=end.isoformat(), completeTransportChain=complete, missingStages=missing,
                uncertainStages=uncertain,
                githubToTransportSeconds=github_seconds, userToTransportSeconds=(end-user_start).total_seconds(),
                totalIsLowerBound=True, executionIntervalUnionSeconds=active,
                queueAnnotationSeconds=union_seconds(annotations['queue']),
                approvalAnnotationSeconds=union_seconds(annotations['approval']),
                waitAnnotationUnionSeconds=union_seconds(waiting),
                executionOrWaitUnionSeconds=covered, unclassifiedGapSeconds=github_seconds-covered,
                exceedsThirtyMinutes=github_seconds > CAP,
                performanceVerdict='FAIL' if github_seconds > CAP else 'UNVERIFIED',
                clockTrust='caller-supplied UTC; cross-host offset/error not verified',
                evidenceTrust='untrusted local snapshot; hashes bind bytes, not provenance or authority',
                productionAccepted=False, thirtyMinuteProductionProven=False, stages=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--attempt-dir', required=True)
    parser.add_argument('--github-accepted-at', required=True)
    parser.add_argument('--user-requested-at', required=True)
    args = parser.parse_args()
    try:
        value = report(args.attempt_dir, github_accepted_at=args.github_accepted_at, user_requested_at=args.user_requested_at)
        print(json.dumps(value, sort_keys=True, separators=(',', ':')))
        return 2  # A projection can never satisfy production/30-minute admission.
    except (Rejected, OSError, KeyError, TypeError, OverflowError):
        print('{"kind":"cn-release-measurement-v1","error":"MEASUREMENT_REJECTED","productionAccepted":false}')
        return 2


if __name__ == '__main__':
    sys.exit(main())
