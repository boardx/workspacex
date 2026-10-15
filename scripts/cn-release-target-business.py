"""Source-only BC receipt sidecar over the existing privileged business adapter.

No CLI, installation, arbitrary LiveState callback, QA bootstrap or new authority.
The original observer owns admission, lock, six journeys, no-replay and readback.
"""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
APP_SOURCE = 'bc3d1254ce05c915801fb73fe6698072730a051c'
TOOL_REVISION = CASE_REVISION = 'aa36786188de51a0dc11b15cc1ffa2d192666555'
SELF = 'scripts/cn-release-target-business.py'
CASE_FILE = '.harness/scripts/vm/cn-maintenance-browser.cjs'
PINS = {
 'scripts/cn-release-business-observer.py':'c7a5b50e70025b1bd0d055fe2870d7fcdf87b7d5c7e0fad6848fcfed0dec8a68',
 'scripts/cn-release-business-state.py':'836bc0a08035d6abe94719cefe46d2a93e51500061f113a2657db8c3f188f4e7',
 'scripts/cn-release-business-entry.ts':'93c3668dcae22f8afda753e50edf4ab19d3e7e5401e4dd2be4ce9a93a28a8842',
 'scripts/cn-release-business-runner.ts':'19ff9005c2654be2537abd341ed86ef37385301d9ba2442f9040668bb9fbadfc',
 CASE_FILE:'3aa186d48cc524703e14088cc5aeab5604b80c27482a167f523118715b2342e6',
 'packages/cloud-deploy/src/cn-release-browser-contract.ts':'5dfe1563bddef368bc99586413f1dbaf1f383778f9a639a416503200ef783444',
 'packages/cloud-deploy/src/cn-maintenance-host/acceptance_contract.ts':'7c388c30f8569127c9cd9f23463dd48671c3d61b84f26ee5161cd1b84bbf17c8',
}
CHECKS = {'login','hello','asr','githubFeedbackRead','skillTool','pdfDownload'}

class TargetBlocked(ValueError):
    """Only static codes escape this adapter, never credential-bearing errors."""


def need(value, code):
    if not value:
        raise TargetBlocked(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def _observer():
    # Bootstrap only the exact existing adapter after original root/private-file
    # policy is checked. No arbitrary module path or callable comes from callers.
    path = ROOT/'scripts/cn-release-business-observer.py'
    import os, stat
    for parent in path.parents:
        value = parent.lstat()
        need(stat.S_ISDIR(value.st_mode) and value.st_uid == 0 and not value.st_mode & 0o022,'TRUSTED_ADAPTER_REQUIRED')
    fd = os.open(path, os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as stream:
        value = os.fstat(stream.fileno())
        need(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and value.st_nlink == 1 and stat.S_IMODE(value.st_mode) == 0o600 and value.st_size <= 1048576,'TRUSTED_ADAPTER_REQUIRED')
        raw = stream.read(1048577)
    need(sha(raw) == PINS['scripts/cn-release-business-observer.py'],'ADAPTER_BYTES_CHANGED')
    # Execute exactly the checked bytes rather than reopening a mutable path.
    import types
    module = types.ModuleType('bc_fixed_business_observer')
    module.__file__ = str(path)
    exec(compile(raw,str(path),'exec'),module.__dict__)
    return module


def _context(observer, release_sha):
    raw = observer.private(observer.APPROVALS/(release_sha+'.json'))
    approval = observer.validate_approval(raw,release_sha,'observe')
    identity = approval['identity']
    need(identity['sourceRevision'] == APP_SOURCE,'BC_SOURCE_REQUIRED')
    need(re.fullmatch('[a-f0-9]{40}',identity['controlRevision']) is not None,'CONTROL_REVISION_REQUIRED')
    for name, pin in PINS.items():
        need(approval['codeFiles'].get(name) == pin and sha(observer.private(ROOT/name)) == pin,'TOOL_OR_CASE_PIN_CHANGED')
    wrapper_pin = sha(observer.private(ROOT/SELF))
    need(approval['codeFiles'].get(SELF) == wrapper_pin,'WRAPPER_NOT_APPROVED')
    prepared = observer.preflight(approval)  # original fixture/QA/profile checks
    profile,plan = prepared['profile'],prepared['plan']
    need(profile['toolRevision'] == TOOL_REVISION,'TOOL_REVISION_CHANGED')
    need(profile['sourcePins'].get(CASE_FILE) == PINS[CASE_FILE] and profile['filesSha256'].get(CASE_FILE) == PINS[CASE_FILE],'CASE_PIN_CHANGED')
    need(plan['deploymentMarker'] and prepared['scope']['runtimeRevision'] == APP_SOURCE,'TARGET_FIXTURE_REQUIRED')
    return approval, prepared, wrapper_pin


def _sidecar(receipt_raw, receipt, approval, prepared, release_sha, wrapper_pin):
    identity = approval['identity']
    need(receipt.get('kind') == 'cn-independent-business-acceptance-v1' and receipt.get('mode') == 'observe','ORIGINAL_RECEIPT_REQUIRED')
    need(all(receipt.get(key) == value for key,value in identity.items()),'RECEIPT_IDENTITY_CHANGED')
    need(receipt.get('runtimeRevision') == APP_SOURCE,'AA_RUNTIME_CANNOT_ATTEST_BC')
    inventory = receipt.get('runtimeInventorySha256','')
    need(isinstance(inventory,str) and re.fullmatch('[a-f0-9]{64}',inventory),'RUNTIME_INVENTORY_REQUIRED')
    need(receipt.get('checks') == {key:True for key in CHECKS},'ORIGINAL_SIX_CHECKS_REQUIRED')
    ids = receipt.get('ownedAcceptanceRunIds')
    need(isinstance(ids,list) and len(ids) == 3 and all(isinstance(i,str) and re.fullmatch('[a-zA-Z0-9_-]{1,128}',i) for i in ids) and len(set(ids)) == 3,'THREE_OWNED_RUNS_REQUIRED')
    return {'kind':'cn-bc-business-sidecar-v1','appSourceSha':APP_SOURCE,
            'controlSha':identity['controlRevision'],'toolSha':TOOL_REVISION,'caseSha':CASE_REVISION,
            'toolProfileSha256':approval['business']['runtimeProfileSha256'],
            'toolFilesSha256':sha(canonical(prepared['profile']['filesSha256'])),
            'caseSourceFilesSha256':{CASE_FILE:PINS[CASE_FILE]},'wrapperSha256':wrapper_pin,
            'releaseApprovalSha256':release_sha,'originalReceiptRawSha256':sha(receipt_raw),
            'runtimeInventorySha256':inventory,'deploymentMarker':prepared['plan']['deploymentMarker'],
            'ownedAcceptanceRunIds':ids,'originalObservedAt':receipt['observedAt'],
            'liveAtSidecarWriteVerified':False,
            'diagnostics':{'kinds':['identity-binding'],'eventCount':0,'readtapAttached':False,'r01StageAttached':False},
            'coverage':'original-six-journeys-with-original-privileged-readback',
            'newBusinessPassClaim':False,'isolatedCandidateImageAdapterImplemented':False}


def execute(release_sha, mode):
    """Only an existing approved privileged caller can reach the original adapter.

    `observe` performs original exclusive journeys; `readback` never replays.
    No implicit fallback to native/source app, no credential parameters or output.
    """
    need(isinstance(release_sha,str) and re.fullmatch('[a-f0-9]{64}',release_sha),'RELEASE_HASH_REQUIRED')
    need(mode in ('observe','readback'),'MODE_REQUIRED')
    try:
        observer = _observer()
        approval, prepared, wrapper_pin = _context(observer,release_sha)
        verified = observer.execute(approval,release_sha,mode)
        # Mandatory original readback independently verifies live inventory,
        # marker, writer/hold linkage and actual terminal run IDs under its lock.
        if mode == 'observe':
            verified = observer.execute(approval,release_sha,'readback')
        again, current, current_wrapper = _context(observer,release_sha)
        need(again == approval and current == prepared and current_wrapper == wrapper_pin,'CONTEXT_DRIFT')
        root = Path('/var/lib/workspacex-cn/business-evidence')/approval['identity']['attemptId']
        raw = observer.private(root/'receipt.json')
        state = observer.state_module(approval)
        receipt = state.parse(raw)
        need(receipt == verified,'ORIGINAL_READBACK_CHANGED')
        value = _sidecar(raw,receipt,approval,prepared,release_sha,wrapper_pin)
        # Preserve exact original receipt bytes and original receipt schema.
        destination = root/'target-bc-binding.json'
        body = canonical(value)
        if destination.exists():
            need(observer.private(destination) == body,'SIDECAR_CHANGED')
        else:
            observer.save(destination,body)
        need(observer.private(root/'receipt.json') == raw,'ORIGINAL_RECEIPT_CHANGED')
        return value
    except TargetBlocked:
        raise
    except Exception:
        raise TargetBlocked('TRUSTED_ADAPTER_OR_ORIGINAL_BUSINESS_BLOCKED') from None
