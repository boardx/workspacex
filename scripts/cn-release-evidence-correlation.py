#!/usr/bin/env python3
"""Library-only consistency graph. Self-consistent snapshots cannot prove source trust."""
import importlib.util
from pathlib import Path
import re


def module(filename, name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


closure = module('cn-release-evidence-closure.py', 'correlation_closure')
business = module('cn-release-target-business.py', 'correlation_business_contract')
observer = module('cn-release-business-observer.py', 'correlation_observer_contract')
m = closure.m


def object_value(raw):
    m.need(type(raw) is bytes and len(raw) <= 1048576, 'RAW_JSON_BOUND')
    value = m.decode(raw)
    m.need(type(value) is dict and value, 'OBJECT_REQUIRED')
    return value


def correlate(attempt_dir, packages_dir, github_run_raw, github_jobs_raw, expected, *,
              github_accepted_at, user_requested_at, observed_at=None):
    """Expected is an untrusted comparison context, never an authority parameter.

    No trusted=true flag, arbitrary verifier callback, SDK or approval-writing route exists.
    Existing protected root observer admission and provider provenance are still mandatory.
    """
    m.need(type(expected) is dict and set(expected) == {'runId','runAttempt','jobId','owner','workflowPath'}, 'EXPECTED_FIELDS')
    for key in ('runId', 'runAttempt', 'jobId'):
        m.need(type(expected[key]) is int and expected[key] > 0, 'EXPECTED_ID')
    m.need(isinstance(expected['owner'], str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9-]{0,38}(?:\[bot\])?', expected['owner']), 'OWNER')
    m.need(isinstance(expected['workflowPath'], str) and re.fullmatch(r'\.github/workflows/[a-z0-9_-]+\.ya?ml', expected['workflowPath']), 'WORKFLOW_PATH')
    graph = closure.inspect(attempt_dir, packages_dir, github_accepted_at=github_accepted_at,
                            user_requested_at=user_requested_at, observed_at=observed_at)
    m.need(graph['completeTransportSnapshot'], 'COMPLETE_ORIGINAL_SNAPSHOT_REQUIRED')
    root, packages = Path(attempt_dir), Path(packages_dir)
    run, jobs = object_value(github_run_raw), object_value(github_jobs_raw)
    m.need(run.get('id') == expected['runId'] and type(run.get('id')) is int and
           run.get('run_attempt') == expected['runAttempt'] and type(run.get('run_attempt')) is int, 'GITHUB_ATTEMPT_DRIFT')
    m.need(type(run.get('repository')) is dict and run['repository'].get('full_name') == 'boardx/workspacex', 'REPOSITORY_DRIFT')
    m.need(type(run.get('actor')) is dict and run['actor'].get('login') == expected['owner'], 'OWNER_DRIFT')
    m.need(run.get('path') == expected['workflowPath'] and run.get('head_branch') == 'main' and
           run.get('event') == 'workflow_dispatch', 'WORKFLOW_SCOPE_DRIFT')
    m.need(run.get('head_sha') == graph['timing']['controlRevision'], 'WORKFLOW_REVISION_DRIFT')
    m.need(run.get('status') == 'completed' and run.get('conclusion') == 'success', 'GITHUB_NOT_SUCCESSFUL')
    m.need(type(jobs.get('jobs')) is list and type(jobs.get('total_count')) is int and
           jobs['total_count'] == len(jobs['jobs']), 'PAGINATED_OR_MISSING_JOBS')
    m.need(all(type(job) is dict for job in jobs['jobs']), 'JOB_OBJECT')
    selected = [job for job in jobs['jobs'] if job.get('id') == expected['jobId']]
    m.need(len(selected) == 1, 'JOB_UNIQUE')
    job = selected[0]
    m.need(type(job.get('id')) is int and type(job.get('run_id')) is int and
           type(job.get('run_attempt')) is int and job.get('run_id') == expected['runId'] and
           job.get('run_attempt') == expected['runAttempt'], 'JOB_ATTEMPT_DRIFT')
    m.need(job.get('status') == 'completed' and job.get('conclusion') == 'success', 'JOB_NOT_SUCCESSFUL')
    final = graph['stages'][-1]
    m.need(final['stage'] == 'observe', 'FINAL_OBSERVER_REQUIRED')
    manifest = object_value(m.read(packages/final['requestSha256'], 'manifest.json'))
    approval_raw = m.read(packages/final['requestSha256'], 'authorization.json')
    approval = object_value(approval_raw)
    m.need(approval.get('kind') == 'cn-fixed-release-approval-v1' and approval.get('target') == observer.TARGET, 'TARGET_SCOPE_DRIFT')
    m.need(type(approval.get('identity')) is dict and type(approval.get('business')) is dict, 'APPROVAL_OBJECTS')
    identity = object_value(m.read(root, 'identity.json'))
    m.need(set(approval['identity']) == (set(identity)-{'scope'}) | {'publicationAttemptId'}, 'APPROVAL_IDENTITY_FIELDS')
    m.need(isinstance(approval['identity']['publicationAttemptId'], str) and
           m.entry.ATTEMPT.fullmatch(approval['identity']['publicationAttemptId']), 'PUBLICATION_ATTEMPT')
    for key, value in identity.items():
        if key != 'scope': m.need(approval['identity'].get(key) == value, 'APPROVAL_IDENTITY_DRIFT')
    raw_a6 = m.read(root, '16-observe.evidence.json')
    a6 = object_value(raw_a6)
    m.need(all(a6.get(k) == v for k, v in approval['identity'].items()), 'A6_IDENTITY_DRIFT')
    m.need(a6.get('kind') == 'cn-independent-business-acceptance-v1' and a6.get('mode') == 'observe', 'A6_MODE')
    m.need(a6.get('runtimeRevision') == identity['sourceRevision'], 'A6_RUNTIME_DRIFT')
    m.need(type(a6.get('checks')) is dict and set(a6['checks']) == business.CHECKS and
           all(value is True for value in a6['checks'].values()), 'A6_SIX_JOURNEYS')
    stable = approval['business'].get('stableWindowSeconds')
    m.need(type(stable) is int and 30 <= stable <= 300 and a6.get('stableWindowSeconds') == stable, 'A6_FROZEN_WINDOW')
    for key in ('runtimeInventorySha256', 'bindingSha256', 'switchReceiptSha256'):
        m.need(isinstance(a6.get(key), str) and m.entry.HEX.fullmatch(a6[key]), 'A6_RUNTIME_PIN')
    ids, samples = a6.get('ownedAcceptanceRunIds'), a6.get('liveObservationSha256')
    m.need(type(ids) is list and len(ids) == 3 and all(isinstance(i, str) and re.fullmatch('[a-zA-Z0-9_-]{1,128}', i) for i in ids) and len(set(ids)) == 3, 'A6_OWNED_RUNS')
    m.need(type(samples) is list and len(samples) >= 2 and all(isinstance(s, str) and m.entry.HEX.fullmatch(s) for s in samples), 'A6_STABLE_SAMPLES')
    created, started = m.instant(run['created_at']), m.instant(job['started_at'])
    finished, accepted = m.instant(job['completed_at']), m.instant(a6['observedAt'])
    intent = object_value(m.read(root, '16-observe.intent.json'))
    receipt = object_value(m.read(root, '16-observe.receipt.json'))
    first_intent = object_value(m.read(root, '00-consume.intent.json'))
    m.need(m.instant(github_accepted_at) <= created <= started <= m.instant(first_intent['createdAt']) <=
           m.instant(intent['createdAt']) <= accepted <= m.instant(receipt['finishedAt']) <= finished, 'CROSS_SOURCE_CLOCK_ORDER')
    m.need((accepted-m.instant(intent['createdAt'])).total_seconds() >= stable, 'STABLE_WINDOW_TIME')
    return dict(kind='cn-evidence-correlation-proposal-v1', inventorySha256=graph['inventorySha256'],
                runId=expected['runId'], runAttempt=expected['runAttempt'], owner=expected['owner'],
                jobId=expected['jobId'], sourceRevision=identity['sourceRevision'], controlRevision=identity['controlRevision'],
                target=approval['target'], approvalRawSha256=m.digest(approval_raw), finalA6RawSha256=m.digest(raw_a6),
                canonicalAdmissionRawSha256=m.digest(m.read(root, '16-observe.admission.json')),
                githubRunRawSha256=m.digest(github_run_raw), githubJobsRawSha256=m.digest(github_jobs_raw),
                workflowCreationToA6Seconds=(accepted-created).total_seconds(), stableWindowSeconds=stable,
                consistencyChecked=True, sourceAuthorityVerified=False, crossHostClockErrorVerified=False,
                githubRequestAcceptanceVerified=False, canonicalVerifierExecuted=False,
                productionAccepted=False, thirtyMinuteProductionProven=False,
                status='UNVERIFIED_SOURCE',
                missingTrust=['authenticated-provider-capture','independent-clock-error',
                              'protected-root-canonical-readback','actual-runtime-and-output-readbacks'])
