#!/usr/bin/env python3
"""Offline identity binding and terminal acceptance for the CN MVP chain.

Consumes GitHub API records obtained by an authenticated caller. No dispatch,
credentials, downloads or production mutation; adapters retain their own gates.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

SERVICES = ('api', 'web', 'agent', 'sandbox', 'postgres')
STAGES = ('build', 'transfer', 'backup', 'schema', 'content', 'deploy', 'acceptance')
CHECKS = ('image_identity', 'schema_readback', 'content_readback',
          'tenant_protection', 'login', 'permissions', 'fixed_api_behavior')


def need(value, code):
    if not value:
        raise ValueError(code)


def load(path):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    raw = Path(path).read_bytes()
    need(len(raw) <= 4 * 1024 * 1024, 'INPUT_LIMIT')
    return json.loads(raw, object_pairs_hook=pairs)


def identity(value):
    need(set(value) == {'sourceRevision', 'controlRevision', 'releaseId',
                        'contentManifestSha256'}, 'IDENTITY_FIELDS')
    for key in ('sourceRevision', 'controlRevision'):
        need(isinstance(value[key], str) and re.fullmatch('[a-f0-9]{40}', value[key]), 'REVISION')
    need(isinstance(value['contentManifestSha256'], str) and
         re.fullmatch('[a-f0-9]{64}', value['contentManifestSha256']), 'CONTENT_DIGEST')
    need(isinstance(value['releaseId'], str) and
         re.fullmatch('[a-z0-9][a-z0-9-]{0,79}', value['releaseId']), 'RELEASE_ID')
    return value


def bind(release, run, listing):
    release = identity(release)
    need(type(run.get('id')) is int and run['id'] > 0, 'RUN_ID')
    need(run.get('repository', {}).get('full_name') == 'boardx/workspacex', 'REPOSITORY')
    need(run.get('path') == '.github/workflows/build-cn-image-candidates.yml', 'WORKFLOW')
    need(run.get('event') == 'workflow_dispatch' and run.get('head_branch') == 'main', 'RUN_TRIGGER')
    need(run.get('head_sha') == release['controlRevision'], 'CONTROL_IDENTITY')
    need(run.get('run_attempt') == 1, 'NO_AUTOMATIC_RETRY')
    need(run.get('status') == 'completed' and run.get('conclusion') == 'success', 'BUILD_NOT_SUCCESS')
    rows = listing.get('artifacts')
    need(isinstance(rows, list) and listing.get('total_count') == len(rows), 'ARTIFACT_PAGINATION')
    prefix = {'plan': 'cn-candidate-plan', 'set': 'cn-image-candidate-set',
              **{s: 'cn-image-candidate-' + s for s in SERVICES}}
    artifacts = {}
    for key, name in prefix.items():
        hits = [r for r in rows if r.get('name') == f'{name}-{run["id"]}-1']
        need(len(hits) == 1, 'ARTIFACT_MISSING_OR_DUPLICATE')
        row = hits[0]
        need(row.get('expired') is False, 'ARTIFACT_EXPIRED')
        need(row.get('workflow_run', {}).get('id') == run['id'] and
             row['workflow_run'].get('head_sha') == release['controlRevision'], 'ARTIFACT_RUN_IDENTITY')
        need(type(row.get('id')) is int and row['id'] > 0 and
             type(row.get('size_in_bytes')) is int and 0 < row['size_in_bytes'] <= 4 * 1024**3,
             'ARTIFACT_BUDGET')
        digest = row.get('digest', '')
        need(isinstance(digest, str) and re.fullmatch('sha256:[a-f0-9]{64}', digest), 'ARTIFACT_DIGEST')
        artifacts[key] = {'id': row['id'], 'bytes': row['size_in_bytes'], 'sha256': digest[7:]}
    need(len({r['id'] for r in artifacts.values()}) == 7, 'ARTIFACT_IDS')
    need(sum(r['bytes'] for r in artifacts.values()) <= 10 * 1024**3, 'TOTAL_BUDGET')
    return {'kind': 'cn-mvp-build-binding-v1', 'identity': release,
            'sourceRun': run['id'], 'sourceRunAttempt': 1,
            'prefix': f'runs/{run["id"]}/1/', 'artifacts': artifacts,
            'sourcePlanReadbackRequired': True}


def terminal(release, receipts):
    release = identity(release)
    need(isinstance(receipts, list) and len(receipts) == len(STAGES), 'STAGE_COUNT')
    previous = None
    for stage, receipt in zip(STAGES, receipts):
        need(receipt.get('stage') == stage, 'STAGE_ORDER')
        need(receipt.get('identity') == release, 'RECEIPT_IDENTITY')
        need(receipt.get('status') == 'SUCCEEDED', 'STAGE_NOT_SUCCESS')
        need(receipt.get('previousReceiptSha256') == previous, 'RECEIPT_CHAIN')
        evidence = receipt.get('evidenceSha256')
        need(isinstance(evidence, str) and re.fullmatch('[a-f0-9]{64}', evidence), 'EVIDENCE_REQUIRED')
        previous = hashlib.sha256(json.dumps(receipt, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    acceptance = receipts[-1]
    need(acceptance.get('checks') == {key: 'PASSED' for key in CHECKS}, 'ACCEPTANCE_SCOPE')
    need(acceptance.get('modelQuality') == 'SKIPPED' and
         acceptance.get('futureV2Content') == 'NOT_APPLICABLE', 'EXPLICIT_EXCLUSIONS')
    return {'kind': 'cn-mvp-terminal-v1', 'status': 'SUCCEEDED_MVP',
            'identity': release, 'lastReceiptSha256': previous,
            'modelQuality': 'SKIPPED', 'futureV2Content': 'NOT_APPLICABLE',
            'fullBusinessAcceptance': False}


def transfer_plan(binding, reviewed, candidate_raw, template_raw, code_root):
    """Rebind a reviewed destination/code policy; never derive IAM privileges."""
    release = identity(binding['identity'])
    need(binding['kind'] == 'cn-mvp-build-binding-v1', 'BUILD_BINDING_KIND')
    candidate = json.loads(candidate_raw)
    template = json.loads(template_raw)
    need(candidate.get('sourceRevision') == release['sourceRevision'] and
         candidate.get('controlRevision') == release['controlRevision'], 'SOURCE_PLAN_IDENTITY')
    need(template.get('runId') == binding['sourceRun'] and template.get('runAttempt') == 1 and
         template.get('controlRevision') == release['controlRevision'] and
         template.get('verifierRevision') == release['controlRevision'], 'PROOF_IDENTITY')
    need(template.get('artifactIds') == {k: v['id'] for k, v in binding['artifacts'].items()}, 'PROOF_ARTIFACTS')
    need(template.get('candidatePlanRawSha256') == hashlib.sha256(candidate_raw).hexdigest(), 'PROOF_PLAN_DIGEST')
    result = dict(reviewed)
    result.update(kind='hk-original-artifact-transfer-v3', sourceRun=binding['sourceRun'],
                  sourceRunAttempt=1, prefix=binding['prefix'], artifacts=binding['artifacts'],
                  sourceRevision=release['sourceRevision'], producerControl=release['controlRevision'],
                  candidatePlanRawSha256=hashlib.sha256(candidate_raw).hexdigest(),
                  producerWorkflowSha256=template['producerWorkflowSha256'],
                  revalidationTemplateSha256=hashlib.sha256(template_raw).hexdigest())
    result['uploaderFiles'] = {name: hashlib.sha256((Path(code_root) / name).read_bytes()).hexdigest()
                               for name in ('cn-hk-original-artifact-upload.py',
                                            'cn-hk-generate-proof.py', 'bounded_workers.py')}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('bind', 'terminal'))
    parser.add_argument('--identity', required=True)
    parser.add_argument('--run')
    parser.add_argument('--artifacts')
    parser.add_argument('--receipts')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        result = (bind(load(args.identity), load(args.run), load(args.artifacts))
                  if args.mode == 'bind' else terminal(load(args.identity), load(args.receipts)))
        with Path(args.output).open('x') as stream:
            json.dump(result, stream, sort_keys=True, separators=(',', ':'))
            stream.write('\n')
    except (ValueError, TypeError, KeyError, OSError) as error:
        print(json.dumps({'status': 'REJECTED', 'reason': str(error) if isinstance(error, ValueError)
                          else type(error).__name__}))
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
