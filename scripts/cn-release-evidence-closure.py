#!/usr/bin/env python3
"""Inventory local original executor/package bytes without running their code.

This is a measurement-side snapshot verifier, never root admission or a remote collector.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('closure_measurement', Path(__file__).with_name('cn-release-measurement.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def inspect(attempt_dir, packages_dir, *, github_accepted_at, user_requested_at, observed_at=None):
    root, packages = Path(attempt_dir), Path(packages_dir)
    timing = m.report(root, github_accepted_at=github_accepted_at,
                      user_requested_at=user_requested_at, observed_at=observed_at)
    m.need(timing['stages'], 'NO_ORIGINAL_STAGE_EVIDENCE')
    identity_raw = m.read(root, 'identity.json')
    m.need(m.digest(identity_raw) == timing['identityRawSha256'], 'TIMING_IDENTITY_CHANGED')
    identity = m.decode(identity_raw)
    inventory = [{'area': 'attempt', 'name': 'identity.json', 'sha256': m.digest(identity_raw), 'bytes': len(identity_raw)}]
    stages = []
    seen_packages = set()
    for index, row in enumerate(timing['stages']):
        prefix = '%02d-%s' % (index, row['stage'])
        original, originals_raw = {}, {}
        for suffix in ('.intent.json', '.receipt.json', '.process.json', '.terminal.json',
                       '.evidence.json', '.terminal-observation.json', '.admission.json'):
            raw = m.read(root, prefix+suffix)
            value = m.decode(raw)
            m.need(type(value) is dict and value, 'EMPTY_OR_NON_OBJECT_EVIDENCE')
            original[suffix] = value
            originals_raw[suffix] = raw
            inventory.append(dict(area='attempt', name=prefix+suffix, sha256=m.digest(raw), bytes=len(raw)))
        receipt, intent = original['.receipt.json'], original['.intent.json']
        m.need(m.digest(originals_raw['.receipt.json']) == row['receiptSha256'], 'TIMING_RECEIPT_CHANGED')
        m.need(m.digest(originals_raw['.intent.json']) == row['intentSha256'], 'TIMING_INTENT_CHANGED')
        for suffix, key in (('.evidence.json', 'evidenceSha256'),
                            ('.terminal-observation.json', 'terminalObservationSha256'),
                            ('.admission.json', 'admissionSha256')):
            m.need(m.digest(originals_raw[suffix]) == receipt[key], 'INVENTORY_PROOF_CHANGED')
        process, terminal = original['.process.json'], original['.terminal.json']
        request = receipt['requestSha256']  # strict64 hex validated by measurement reader
        m.need(request not in seen_packages, 'PACKAGE_REUSED')
        seen_packages.add(request)
        package = packages/request
        raw = m.read(package, 'manifest.json')
        m.need(m.digest(raw) == request, 'MANIFEST_HASH_CHANGED')
        manifest = m.decode(raw)
        m.need(type(manifest) is dict and manifest, 'MANIFEST_OBJECT')
        m.need(all(manifest.get(k) == v for k, v in identity.items()), 'PACKAGE_IDENTITY_DRIFT')
        m.need(manifest.get('stage') == row['stage'] and manifest.get('previousReceiptSha256') == receipt['previousReceiptSha256'], 'PACKAGE_CHAIN_DRIFT')
        m.need(process.get('requestSha256') == request, 'PROCESS_REQUEST_DRIFT')
        m.need(type(process.get('pid')) is int and process['pid'] > 1, 'PROCESS_JOURNAL')
        m.need(type(terminal.get('exitCode')) is int, 'COMMAND_EXIT_CODE')
        m.need(terminal.get('reason') in ('EXITED', 'TIMEOUT', 'OUTPUT_LIMIT', 'ISOLATION_UNPROVEN'), 'TERMINAL_REASON')
        m.need(type(terminal.get('processGroupStillPresent')) is bool, 'TERMINAL_GROUP_STATE')
        m.need(m.instant(intent['createdAt']) <= m.instant(terminal['finishedAt']) <= m.instant(receipt['finishedAt']), 'TERMINAL_CLOCK')
        if receipt['mode'] == 'advance':
            m.need(terminal['reason'] == 'EXITED' and terminal['exitCode'] == 0 and terminal['processGroupStillPresent'] is False, 'ADVANCE_NOT_SUCCESSFUL')
            m.need(terminal.get('stdoutSha256') == receipt['evidenceSha256'], 'COMMAND_STDOUT_DRIFT')
        else:
            # Reconcile has independent observer evidence, which can differ from action stdout.
            m.need(type(terminal.get('stdoutSha256')) is str and m.entry.HEX.fullmatch(terminal['stdoutSha256']), 'COMMAND_STDOUT_PIN')
        inventory.append(dict(area='package', requestSha256=request, name='manifest.json', sha256=request, bytes=len(raw)))
        for name, key in (('action.sh', 'actionSha256'), ('observe.sh', 'observerSha256'),
                          ('verify.py', 'verifierSha256'), ('authorization.json', 'authorizationEvidenceSha256')):
            raw = m.read(package, name)
            m.need(m.digest(raw) == manifest.get(key), 'PACKAGE_BYTES_CHANGED')
            inventory.append(dict(area='package', requestSha256=request, name=name, sha256=m.digest(raw), bytes=len(raw)))
        admission = original['.admission.json']
        expected = dict(kind='cn-entry-admission-v1', requestSha256=request,
                        verifierSha256=manifest['verifierSha256'], observerSha256=manifest['observerSha256'],
                        authorizationEvidenceSha256=manifest['authorizationEvidenceSha256'],
                        evidenceSha256=receipt['evidenceSha256'], terminalObservationSha256=receipt['terminalObservationSha256'])
        m.need(admission == expected, 'ADMISSION_LINK_DRIFT')
        stages.append(dict(stage=row['stage'], requestSha256=request, mode=receipt['mode'],
                           originalCommandExitCode=terminal['exitCode'], originalTerminalReason=terminal['reason']))
    # Re-read identity/receipt/proof hashes to catch a changing snapshot while collecting packages.
    for item in inventory:
        area = root if item['area'] == 'attempt' else packages/item['requestSha256']
        m.need(m.digest(m.read(area, item['name'])) == item['sha256'], 'SNAPSHOT_CHANGED')
    canonical = (json.dumps(inventory, sort_keys=True, separators=(',', ':'))+'\n').encode()
    return dict(kind='cn-original-evidence-inventory-v1', timing=timing, files=inventory,
                inventorySha256=m.digest(canonical), stages=stages,
                originalBytesLinked=True, completeTransportSnapshot=timing['completeTransportChain'],
                sourceAuthorityVerified=False, cloudTerminalityVerified=False,
                productionAccepted=False, thirtyMinuteProductionProven=False,
                missingProductionEvidence=['target-and-owner-provenance', 'five-image-and-toolkit-digests',
                    'workflow-run-and-UTC-clock-error', 'backup-ID-and-isolated-restore-target',
                    'four-SQL-and-schema-versions', 'runtime-instance-digests',
                    'canonical-six-journeys-and-stable-window'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--attempt-dir', required=True)
    parser.add_argument('--packages-dir', required=True)
    parser.add_argument('--github-accepted-at', required=True)
    parser.add_argument('--user-requested-at', required=True)
    args = parser.parse_args()
    try:
        result = inspect(args.attempt_dir, args.packages_dir, github_accepted_at=args.github_accepted_at,
                         user_requested_at=args.user_requested_at)
        print(json.dumps(result, sort_keys=True, separators=(',', ':')))
    except (m.Rejected, OSError, KeyError, TypeError, ValueError, OverflowError):
        print('{"kind":"cn-original-evidence-inventory-v1","error":"CLOSURE_REJECTED","productionAccepted":false}')
    return 2  # Never an admission/ready exit, including a complete local snapshot.


if __name__ == '__main__':
    sys.exit(main())
