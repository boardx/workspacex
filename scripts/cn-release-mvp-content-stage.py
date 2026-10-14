#!/usr/bin/env python3
"""Fixed content CLI adapter. Library execution requires a trusted installed caller.

No shell, credentials, sudo or production entry is exposed by this module.
Original receipts and a durable apply intent survive unknown outcomes; retry is
never inferred from a subprocess error. Nonmodel acceptance is a separate stage.
"""
import hashlib
from datetime import datetime
import json
import os
from pathlib import Path
import re
import subprocess

LIMIT = 65536
CLI = 'apps/api/scripts/platform-content-release.ts'


def need(ok, code):
    if not ok:
        raise ValueError(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def decode(raw):
    need(type(raw) is bytes and 0 < len(raw) <= LIMIT, 'RECEIPT_LIMIT')
    def unique(items):
        result = {}
        for key, value in items:
            need(key not in result, 'DUPLICATE_KEY')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def validate(raw, mode, source, request_sha):
    value = decode(raw)
    need(value.get('kind') == 'cn-platform-content-release-receipt-v1'
         and value.get('mode') == mode and value.get('sourceRevision') == source
         and value.get('requestSha256') == request_sha, 'CLI_RECEIPT_BINDING')
    need(isinstance(value.get('observedAt'), str), 'OBSERVATION_REQUIRED')
    try:
        observed = datetime.fromisoformat(value['observedAt'].replace('Z', '+00:00'))
        need(observed.tzinfo is not None, 'OBSERVATION_TIMEZONE')
    except (TypeError, ValueError) as error:
        raise ValueError('OBSERVATION_INVALID') from error
    row = value.get('receipt', {})
    if mode == 'preflight':
        need(row.get('expectedBeforeStateMatches') is True
             and row.get('sourceInputsVerified') is True
             and row.get('productionWrites') is False, 'PREFLIGHT_REJECTED')
    else:
        need(row.get('contentReadbackPassed') is True
             and row.get('acceptanceScope') == 'mvp-non-model'
             and row.get('realModel') == 'SKIPPED'
             and row.get('aiOutputQuality') == 'SKIPPED'
             and row.get('skillVerificationPromotion') == 'NOT_PERFORMED'
             and row.get('fullBusinessAcceptance') is False, 'CONTENT_READBACK_REJECTED')
        for name in ('skillVersions', 'roleVersions', 'workflows', 'pendingBindings'):
            need(type(row.get(name)) is int and row[name] >= 0, 'CONTENT_COUNT')
    return value


def exclusive(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        # Preserve partial evidence or intent; never erase uncertain execution.
        raise


def command(mode, checkout, node, request_path, source, request_sha,
            backup_path=None, backup_sha=None):
    need(mode in ('preflight', 'apply', 'readback'), 'MODE')
    need(re.fullmatch('[a-f0-9]{40}', source or '')
         and re.fullmatch('[a-f0-9]{64}', request_sha or ''), 'IDENTITY')
    checkout, node = Path(checkout), Path(node)
    need(checkout.is_absolute() and node.is_absolute(), 'FIXED_INSTALL_PATH')
    args = [str(node), '--import', 'tsx', str(checkout / CLI), mode,
            str(request_path), request_sha, source]
    if mode == 'apply':
        need(backup_path and re.fullmatch('[a-f0-9]{64}', backup_sha or ''), 'BACKUP_REQUIRED')
        args += [str(backup_path), backup_sha]
    return args


def execute(request_raw, backup_raw, source, checkout, node, evidence_dir,
            *, runner=None):
    """One attempt; trusted caller supplies already-authorized root-private inputs.

    The root TS CLI independently enforces real target DB, pack bytes, root
    input ownership, before-state and fresh independently observed backup.
    runner is an in-process isolated-test seam, unavailable as a CLI argument.
    """
    request, backup = decode(request_raw), decode(backup_raw)
    request_sha, backup_sha = digest(request_raw), digest(backup_raw)
    need(request.get('sourceRevision') == source
         and request.get('expectedDatabase') == 'workspacex_a1cb_20261006', 'REQUEST_IDENTITY')
    need(backup.get('requestSha256') == request_sha
         and backup.get('sourceRevision') == source
         and backup.get('beforeStateSha256') == request.get('beforeStateSha256')
         and backup.get('status') == 'Success'
         and backup.get('independentlyObserved') is True, 'BACKUP_BINDING')
    root = Path(evidence_dir)
    need(root.is_dir() and not root.is_symlink(), 'EVIDENCE_DIRECTORY')
    st = root.stat()
    need(st.st_uid == os.getuid() and st.st_mode & 0o077 == 0, 'PRIVATE_EVIDENCE_DIRECTORY')
    request_path, backup_path = root / 'request.json', root / 'backup.json'
    # Existing files reject the entire attempt, including re-entry after crashes.
    exclusive(request_path, request_raw)
    exclusive(backup_path, backup_raw)
    originals = {}
    invoke = runner or (lambda args: subprocess.run(args, stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL, timeout=300, check=False))
    for mode in ('preflight', 'apply', 'readback'):
        if mode == 'apply':
            exclusive(root / 'apply-intent.json', json.dumps({
                'kind': 'cn-mvp-content-apply-intent-v1', 'sourceRevision': source,
                'requestSha256': request_sha, 'backupSha256': backup_sha,
                'automaticRetry': False}, sort_keys=True).encode())
        result = invoke(command(mode, checkout, node, request_path, source,
                                request_sha, backup_path, backup_sha))
        raw = result.stdout
        need(type(raw) is bytes and len(raw) <= LIMIT, 'SUBPROCESS_OUTPUT_LIMIT')
        exclusive(root / (mode + '.json'), raw)
        need(result.returncode == 0, 'EXECUTION_FAILED_OR_UNKNOWN_NO_RETRY')
        originals[mode] = validate(raw, mode, source, request_sha)
    a, b = originals['apply']['receipt'], originals['readback']['receipt']
    need(all(a[k] == b[k] for k in ('skillVersions', 'roleVersions', 'workflows',
                                   'pendingBindings')), 'INDEPENDENT_READBACK_MISMATCH')
    return {'kind': 'cn-mvp-content-stage-v1', 'sourceRevision': source,
            'requestSha256': request_sha, 'backupSha256': backup_sha,
            'contentReadback': 'PASSED', 'tenantProtection': 'NOT_PROVEN_BY_CONTENT_STAGE',
            'nonmodelAcceptance': 'REQUIRED_SEPARATELY', 'automaticRetry': False,
            'originals': {m: digest((root / (m + '.json')).read_bytes()) for m in originals},
            'fullBusinessAcceptance': False}
