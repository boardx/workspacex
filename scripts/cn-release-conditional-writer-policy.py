#!/usr/bin/env python3
"""Offline, default-disabled A5 policy evaluator. No CLI, file or cloud writes.

Both expected hashes must originate in independently protected approval/journal
stores, never in the supplied JSON itself. The observation is a projection of
an already verified terminal chain, not an attestation this module authenticates.
The installer is deliberately absent: it must atomically claim policyId under
one root lock, preserve unknown claims, reread the live chain/code/clock, install
once, then invoke the existing terminal derive_writer_resume checks. A history
snapshot here detects known replay; it cannot replace that atomic transaction.
Policy issuance/installation needs explicit human authorization. No router or
static A5 path is changed. Returned approval bytes are only an uninstalled draft.
"""
import datetime as dt
import hashlib
import json
import re

TARGET = {'accountId': '1177216024653153', 'region': 'cn-shanghai',
          'ecsInstanceId': 'i-uf6ga92ewloganobbln6'}
IDENTITY = {'sourceRevision', 'baselineRevision', 'controlRevision',
            'publicationAttemptId', 'attemptId', 'requestedAt', 'deadlineAt'}
IMAGES = {'api', 'web', 'agent', 'sandbox', 'postgres'}
CODES = {'scripts/cn-release-conditional-writer-policy.py',
         'scripts/cn-release-terminal-delegation.py',
         'scripts/cn-release-stage-router.py', '.harness/scripts/vm/cn-release-advance.py',
         'scripts/cn-release-continuation-finalize.py'}
INPUTS = {'binding': 'bindingSha256', 'hold': 'holdRawSha256',
          'switchReceipt': 'switchReceiptSha256', 'status': 'heldHealthSha256',
          'userAuthorization': 'userAuthorizationEvidenceSha256',
          'testDataScope': 'testDataScopeSha256'}
SCOPE = 'a5-resume-writers-and-a6-scoped-business-observation'
ORIGIN = 'https://app.boardx.com.cn/'


def need(value, code):
    if not value:
        raise ValueError(code)


def sha(raw):
    need(type(raw) is bytes, 'RAW_BYTES_REQUIRED')
    return hashlib.sha256(raw).hexdigest()


def enc(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def parse(raw):
    need(type(raw) is bytes and 0 < len(raw) <= 1048576, 'RAW_SIZE')
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, 'DUPLICATE_KEY')
            result[key] = value
        return result
    def constant(_):
        raise ValueError('NONFINITE_JSON')
    result = json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    need(type(result) is dict, 'OBJECT_REQUIRED')
    return result


def digest(value):
    return type(value) is str and re.fullmatch('[0-9a-f]{64}', value) is not None


def stamp(value):
    need(type(value) is str, 'TIME')
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    need(result.tzinfo is not None and result.utcoffset() == dt.timedelta(0), 'UTC_REQUIRED')
    return result


def derive_proposal(policy_raw, release_raw, observation_raw, inputs, *,
                    approved_policy_sha256=None, verified_observation_sha256=None,
                    observed_code_hashes=None, consumed_policy_ids=None,
                    now=None, enabled=False):
    """Pure evaluation; caller must supply independent trust anchors and history.

    Observation generation/raw hashes must be from the same locked terminal
    chain; the eventual terminal consumer still checks original bytes itself.
    No default empty replay history is allowed. This API does not authenticate
    caller-supplied anchors or perform durable consumption.
    """
    need(enabled is True, 'POLICY_DISABLED')
    need(digest(approved_policy_sha256) and sha(policy_raw) == approved_policy_sha256,
         'POLICY_NOT_APPROVED')
    need(digest(verified_observation_sha256) and sha(observation_raw) == verified_observation_sha256,
         'OBSERVATION_NOT_VERIFIED')
    p, a, o = parse(policy_raw), parse(release_raw), parse(observation_raw)
    need(set(p) == {'kind', 'policyId', 'releaseSha256', 'identity', 'target', 'issuedAt',
                   'expiresAt', 'imageDigests', 'codeFiles', 'evidencePins', 'scope',
                   'publicOrigin', 'maxObservationAgeSeconds'}, 'POLICY_FIELDS')
    need(p['kind'] == 'cn-conditional-writer-policy-v1' and
         type(p['policyId']) is str and re.fullmatch('[0-9a-f]{32}', p['policyId']), 'POLICY_ID')
    need(type(consumed_policy_ids) is tuple and all(type(x) is str and
         re.fullmatch('[0-9a-f]{32}', x) for x in consumed_policy_ids), 'HISTORY_REQUIRED')
    need(len(set(consumed_policy_ids)) == len(consumed_policy_ids), 'DUPLICATE_HISTORY')
    need(p['policyId'] not in consumed_policy_ids, 'POLICY_REPLAY')
    need(a['kind'] == 'cn-fixed-release-approval-v1' and p['releaseSha256'] == sha(release_raw), 'RELEASE_PIN')
    r = p['identity']
    need(type(r) is dict and set(r) == IDENTITY and r == a['identity'], 'IDENTITY')
    for key in ('sourceRevision', 'baselineRevision', 'controlRevision'):
        need(type(r[key]) is str and re.fullmatch('[0-9a-f]{40}', r[key]), 'REVISION')
    for key in ('attemptId', 'publicationAttemptId'):
        need(type(r[key]) is str and re.fullmatch('[a-z0-9-]{1,64}', r[key]), 'ATTEMPT')
    need(p['target'] == a['target'] == TARGET and p['scope'] == SCOPE and
         p['publicOrigin'] == ORIGIN, 'TARGET_SCOPE')
    need(type(p['imageDigests']) is dict and set(p['imageDigests']) == IMAGES and
         all(type(x) is str and re.fullmatch('sha256:[0-9a-f]{64}', x)
             for x in p['imageDigests'].values()), 'FIVE_IMAGES')
    need(type(p['codeFiles']) is dict and CODES <= set(p['codeFiles']) and
         all(type(k) is str and not k.startswith('/') and '..' not in k.split('/') and digest(v)
             for k, v in p['codeFiles'].items()) and p['codeFiles'] == observed_code_hashes, 'CODE_PINS')
    need(type(p['evidencePins']) is dict and set(p['evidencePins']) == {'userAuthorization', 'testDataScope'}
         and all(digest(v) for v in p['evidencePins'].values()), 'EVIDENCE_PINS')
    need(type(p['maxObservationAgeSeconds']) is int and 0 < p['maxObservationAgeSeconds'] <= 60, 'FRESHNESS_LIMIT')
    need(set(o) == {'kind', 'releaseSha256', 'identity', 'target', 'observedAt',
                    'holdGeneration', 'inputHashes', 'imageDigests'}, 'OBSERVATION_FIELDS')
    need(o['kind'] == 'cn-verified-writer-chain-projection-v1' and
         o['releaseSha256'] == p['releaseSha256'] and o['identity'] == r and
         o['target'] == TARGET and o['imageDigests'] == p['imageDigests'], 'OBSERVATION_BINDING')
    need(type(inputs) is dict and set(inputs) == set(INPUTS), 'INPUT_FIELDS')
    hashes = {key: sha(raw) for key, raw in inputs.items()}
    need(hashes == o['inputHashes'], 'OBSERVATION_RAW_HASHES')
    need(all(hashes[k] == v for k, v in p['evidencePins'].items()) and
         len(inputs['userAuthorization']) > 0, 'STATIC_EVIDENCE')
    now = now or dt.datetime.now(dt.timezone.utc)
    need(isinstance(now, dt.datetime) and now.tzinfo is not None, 'NOW_TIMEZONE')
    requested, deadline = stamp(r['requestedAt']), stamp(r['deadlineAt'])
    need(dt.timedelta(0) < deadline - requested <= dt.timedelta(minutes=30), 'ORIGINAL_BUDGET')
    need(requested <= stamp(a['issuedAt']) <= now < stamp(a['expiresAt']) <= deadline, 'RELEASE_EXPIRED')
    need(requested <= stamp(p['issuedAt']) <= now < stamp(p['expiresAt']) <= stamp(a['expiresAt']), 'POLICY_EXPIRED')
    need(dt.timedelta(0) <= now - stamp(o['observedAt']) <=
         dt.timedelta(seconds=p['maxObservationAgeSeconds']), 'OBSERVATION_STALE')
    b, hold, status = (parse(inputs[k]) for k in ('binding', 'hold', 'status'))
    need(all(b.get(k) == r[k] for k in IDENTITY - {'publicationAttemptId'}), 'BINDING_IDENTITY')
    need(hold == b.get('hold') and hold.get('state') == 'held' and
         type(hold.get('generation')) is str and re.fullmatch('[0-9a-f]{32}', hold['generation']) and
         hold['generation'] == o['holdGeneration'], 'HOLD_GENERATION')
    need(status.get('bindingSha256') == hashes['binding'] and
         status.get('switchReceiptSha256') == hashes['switchReceipt'], 'HEALTH_LINK')
    writer = dict(kind='cn-writer-resume-approval-v1', releaseSha256=p['releaseSha256'],
                  identity=r, target=TARGET, issuedAt=now.isoformat(), expiresAt=p['expiresAt'],
                  holdGeneration=hold['generation'], scope=SCOPE, publicOrigin=ORIGIN)
    writer.update({field: hashes[key] for key, field in INPUTS.items()})
    raw = enc(writer)
    return {'writerApprovalRaw': raw, 'writerApprovalSha256': sha(raw),
            'policySha256': sha(policy_raw), 'policyId': p['policyId'],
            'observationSha256': sha(observation_raw), 'inputHashes': hashes,
            'executionAuthorized': False, 'installed': False, 'cloudCalls': 0,
            'requiresAtomicConsumption': True, 'requiresTerminalChainRecheck': True}
