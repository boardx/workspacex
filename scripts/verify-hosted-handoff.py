#!/usr/bin/env python3
"""Offline draft handoff validation. Never installs or activates a candidate."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

SOURCE_FILES = ('release-candidate-cli.ts', 'release-candidate.ts', 'release.ts', 'image-reference.ts')
SERVICES = {'web', 'api', 'agent', 'sandbox', 'postgres', 'redis'}
IDENTITY = ('sourceRevision', 'release', 'attemptId', 'platform', 'registryPrefix', 'acrRegion', 'acrInstanceId')
DIGEST = re.compile(r'^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$')

def require(condition, code):
    if not condition:
        raise ValueError(code)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def load(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), 'INPUT_FILE_REQUIRED')
    data = path.read_bytes()
    require(len(data) <= 4 * 1024 * 1024, 'INPUT_TOO_LARGE')
    def pairs(values):
        result = {}
        for key, value in values:
            require(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs), data

def modules_tree_sha256(directory):
    root = Path(directory).resolve(strict=True)
    entries = []
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            target = path.resolve(strict=True)
            require(target.is_relative_to(root), 'MODULE_SYMLINK_ESCAPE')
            entries.append([relative, 'symlink', path.readlink().as_posix()])
        elif path.is_file():
            entries.append([relative, 'file', sha(path.read_bytes())])
    require(entries, 'MODULE_CLOSURE_EMPTY')
    return sha(json.dumps(entries, separators=(',', ':'), ensure_ascii=True).encode())

def canonical_validate(control_path, control_sha256, manifest_path, seal_path, revision):
    control_spec=importlib.util.spec_from_file_location('reviewed_canonical_control',Path(__file__).with_name('canonical_control.py'))
    control=importlib.util.module_from_spec(control_spec)
    control_spec.loader.exec_module(control)
    with control.canonical_snapshot(control_path, control_sha256) as closure:
        result = subprocess.run([closure['nodeExecutable'], '--import', 'tsx', 'packages/cloud-deploy/src/release-candidate-cli.ts', 'validate', str(manifest_path.resolve()), str(seal_path.resolve()), revision], cwd=closure['directory'], env=control.canonical_environment({'PATH':str(Path(closure['nodeExecutable']).parent),'HOME':'/nonexistent','NODE_ENV':'production'}), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60, check=False)
        require(result.returncode == 0, 'CANONICAL_VALIDATION_FAILED')
    return control_sha256

def verify(plan_path, sealed_dir, expected_path, now=None, control_path=None, control_sha256=None):
    expected, expected_bytes = load(expected_path)
    require(isinstance(expected, dict) and set(expected) == set(IDENTITY) | {'expectedPythonToolHash', 'expectedCanonicalControlSha256', 'expectedCanonicalVerifierHash'}, 'INVALID_EXPECTED_FIELDS')
    require(all(isinstance(expected[k], str) for k in IDENTITY), 'INVALID_EXPECTED_IDENTITY')
    require(re.fullmatch('[a-f0-9]{64}', expected['expectedPythonToolHash'] or ''), 'INVALID_EXPECTED_TOOL_HASH')
    require(sha(Path(__file__).with_name('canonical_control.py').read_bytes()) == expected['expectedCanonicalVerifierHash'], 'LOCAL_CANONICAL_VERIFIER_MISMATCH')
    require(control_path is not None and control_sha256 == expected['expectedCanonicalControlSha256'], 'INDEPENDENT_CONTROL_HASH_MISMATCH')
    plan, plan_bytes = load(plan_path)
    require(isinstance(plan, dict) and all(plan.get(k) == expected[k] for k in IDENTITY), 'PLAN_IDENTITY_MISMATCH')
    require(sha(Path(__file__).with_name('hosted-release.py').read_bytes()) == expected['expectedPythonToolHash'], 'LOCAL_PYTHON_TOOL_MISMATCH')
    spec = importlib.util.spec_from_file_location('reviewed_hosted_release', Path(__file__).with_name('hosted-release.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    # Validate without checkout, authentication, Docker or registry operations.
    helper.validate_input({k: v for k, v in plan.items() if k != 'services'})
    require(set(plan.get('services', [])) == set(helper.SERVICES) and len(plan['services']) == len(helper.SERVICES), 'PLAN_SERVICE_SET_MISMATCH')
    require(sha(Path(__file__).with_name('hosted-release.py').read_bytes()) == expected['expectedPythonToolHash'], 'LOCAL_PYTHON_TOOL_MISMATCH')
    root = Path(sealed_dir)
    require(root.is_dir() and not root.is_symlink(), 'SEALED_DIRECTORY_REQUIRED')
    values = {name: load(root / name) for name in ('build-input.json', 'release.json', 'release.sealed.json', 'artifact-build.json')}
    build, _ = values['build-input.json']; manifest, manifest_bytes = values['release.json']; seal, seal_bytes = values['release.sealed.json']; receipt, receipt_bytes = values['artifact-build.json']
    require(isinstance(receipt, dict), 'INVALID_RECEIPT')
    required_receipt = set(IDENTITY) | {'schemaVersion','receiptKind','stage','manifestSha256','sealSha256','planSha256','controlToolSha256','issuedAt','expiresAt','clockSource','services','artifactsVerified','ready','prepared','productionActivated','canonicalControlSha256','canonicalNodeSha256','canonicalVerifierSha256'}
    require(set(receipt) == required_receipt, 'INVALID_RECEIPT_FIELDS')
    require(all(receipt[k] == expected[k] for k in IDENTITY), 'RECEIPT_IDENTITY_MISMATCH')
    require(type(receipt['schemaVersion']) is int and receipt['schemaVersion'] == 1 and receipt['receiptKind'] == 'hosted-artifact-build-draft-v1' and receipt['stage'] == 'hosted-artifact-build', 'RECEIPT_STAGE_MISMATCH')
    require(receipt['ready'] is False and receipt['prepared'] is False and receipt['productionActivated'] is False and receipt['artifactsVerified'] is True, 'RECEIPT_PRIVILEGE_MISMATCH')
    require(receipt['clockSource'] == 'runner-system-clock-unattested', 'RECEIPT_CLOCK_MISMATCH')
    require(receipt['planSha256'] == sha(plan_bytes) and receipt['manifestSha256'] == sha(manifest_bytes) and receipt['sealSha256'] == sha(seal_bytes), 'ARTIFACT_HASH_MISMATCH')
    control_config, _ = load(control_path)
    require(receipt['canonicalControlSha256'] == control_sha256 and receipt['canonicalVerifierSha256'] == expected['expectedCanonicalVerifierHash'] and receipt['canonicalNodeSha256'] == control_config.get('nodeSha256'), 'RECEIPT_CANONICAL_CONTROL_MISMATCH')
    require(receipt['controlToolSha256'] == expected['expectedPythonToolHash'], 'RECEIPT_TOOL_MISMATCH')
    require(isinstance(receipt['services'], list) and len(receipt['services']) == 6 and set(receipt['services']) == SERVICES, 'RECEIPT_SERVICES_MISMATCH')
    def timestamp(value):
        require(isinstance(value, str), 'INVALID_RECEIPT_TIME')
        date = datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(date.tzinfo is not None and date.utcoffset() is not None, 'TIMEZONE_REQUIRED')
        return date
    issued = timestamp(receipt['issuedAt']); expires = timestamp(receipt['expiresAt']); clock = now or datetime.now(timezone.utc)
    require(0 < (expires-issued).total_seconds() <= 3600 and issued <= clock < expires, 'RECEIPT_EXPIRED_OR_INVALID_TTL')
    require(build == manifest, 'BUILD_MANIFEST_MISMATCH')
    require(isinstance(manifest, dict) and set(manifest) == {'schemaVersion','release','sourceRevision','platform','images'}, 'MANIFEST_FIELDS_MISMATCH')
    require(type(manifest['schemaVersion']) is int and manifest['schemaVersion'] == 1 and all(manifest[k] == expected[k] for k in ('sourceRevision','release','platform')), 'MANIFEST_IDENTITY_MISMATCH')
    require(isinstance(manifest['images'], dict) and set(manifest['images']) == SERVICES, 'MANIFEST_SERVICES_MISMATCH')
    for service, image in manifest['images'].items():
        require(isinstance(image, dict) and set(image) == {'image'} and isinstance(image['image'], str) and DIGEST.fullmatch(image['image']), 'INVALID_IMAGE')
        if service in helper.SERVICES:
            require(image['image'].split('@')[0] == expected['registryPrefix'] + '/' + helper.SERVICES[service][0], 'BUILD_TARGET_NAMESPACE_MISMATCH')
    require(manifest['images']['redis']['image'] == plan['baseImages']['redis'], 'REVIEWED_REDIS_MISMATCH')
    require(isinstance(seal, dict) and set(seal) == {'schemaVersion','status','sourceRevision','manifestSha256','sealedAt'} and type(seal['schemaVersion']) is int and seal['schemaVersion'] == 1 and seal['status'] == 'sealed' and seal['sourceRevision'] == expected['sourceRevision'] and seal['manifestSha256'] == sha(manifest_bytes), 'SEAL_MISMATCH')
    timestamp(seal['sealedAt'])
    closure_hash = canonical_validate(control_path, control_sha256, root/'release.json', root/'release.sealed.json', expected['sourceRevision'])
    clock = now or datetime.now(timezone.utc)
    require(issued <= clock < expires, 'RECEIPT_EXPIRED_DURING_VALIDATION')
    return {'schemaVersion':1,'stage':'offline-hosted-handoff-validation','handoffValidated':True,'prepared':False,'productionActivated':False,'cloudVerified':False,'trustScope':'independently-supplied-local-control-closure; no external attestation','sourceRevision':expected['sourceRevision'],'release':expected['release'],'attemptId':expected['attemptId'],'platform':expected['platform'],'planSha256':sha(plan_bytes),'manifestSha256':sha(manifest_bytes),'sealSha256':sha(seal_bytes),'receiptSha256':sha(receipt_bytes),'expectedInputSha256':sha(expected_bytes),'pythonToolSha256':expected['expectedPythonToolHash'],'validatorSha256':sha(Path(__file__).read_bytes()),'canonicalControlSha256':closure_hash,'canonicalVerifierSha256':expected['expectedCanonicalVerifierHash'],'canonicalNodeSha256':control_config['nodeSha256'],'validatedAt':clock.isoformat()}

def main():
    parser = argparse.ArgumentParser()
    for name in ('plan','sealed-dir','expected','output','control','control-sha256'):
        parser.add_argument('--'+name, required=True)
    args = parser.parse_args()
    result = verify(args.plan, args.sealed_dir, args.expected, control_path=args.control, control_sha256=args.control_sha256)
    with Path(args.output).open('x', encoding='utf8') as output:
        output.write(json.dumps(result, indent=2, sort_keys=True)+'\n')
    print('HOSTED_HANDOFF_VALIDATED_OFFLINE')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, TypeError, KeyError, subprocess.SubprocessError, AttributeError):
        print('HOSTED_HANDOFF_VALIDATION_FAILED', file=sys.stderr)
        sys.exit(1)
