#!/usr/bin/env python3
"""Canonical reviewed control inventory; runtime dependencies are separate claims."""
from pathlib import Path
import hashlib
import json

CONTROL_FILES = (
    '.harness/scripts/vm/cn-maintenance-browser.cjs',
    '.harness/scripts/vm/cn-release-advance.py',
    '.harness/scripts/vm/cn-runtime-continuation/acquire/README.md',
    '.harness/scripts/vm/cn-runtime-continuation/acquire/consume-launcher.py',
    '.harness/scripts/vm/cn-runtime-continuation/acquire/consumer.py',
    '.harness/scripts/vm/cn-runtime-continuation/acquire/deadline-runtime.py',
    '.harness/scripts/vm/cn-runtime-continuation/acquire/materialize-publication.py',
    '.harness/scripts/vm/cn-runtime-continuation/acquire/provenance.json',
    '.harness/scripts/vm/cn-runtime-continuation/acquire/stage-runtime.py',
    '.harness/scripts/vm/cn-runtime-continuation/acquire/transport-runtime.py',
    '.harness/scripts/vm/cn-runtime-continuation/backup-host.DRAFT.py',
    '.harness/scripts/vm/cn-runtime-continuation/finalize/prepare.py',
    '.harness/scripts/vm/cn-runtime-continuation/finalize/provenance.json',
    '.harness/scripts/vm/cn-runtime-continuation/finalize/runtime.py',
    '.harness/scripts/vm/cn-runtime-continuation/prepare-phase.py',
    '.harness/scripts/vm/cn-runtime-continuation/provenance.json',
    '.harness/scripts/vm/cn-runtime-continuation/sessions-after-stop.py',
    '.harness/scripts/vm/cn-runtime-continuation/sessions-after-stop.sh',
    '.harness/scripts/vm/cn-runtime-continuation/stage-phase.provenance.json',
    '.harness/scripts/vm/cn-runtime-continuation/stage-phase.py',
    '.harness/scripts/vm/cn-runtime-continuation/upgrade-draft.py',
    'packages/cloud-deploy/src/cn-maintenance-host/acceptance_contract.ts',
    'packages/cloud-deploy/src/cn-release-browser-contract.ts',
    'scripts/build-cn-business-runtime.cjs',
    'scripts/canonical_control.py',
    'scripts/cn-release-acquire-delegation.py',
    'scripts/cn-release-acquire-observer.py',
    'scripts/cn-release-approval-plan.py',
    'scripts/cn-release-business-entry.ts',
    'scripts/cn-release-business-observer.py',
    'scripts/cn-release-business-recovery.py',
    'scripts/cn-release-business-runner.ts',
    'scripts/cn-release-business-state.py',
    'scripts/cn-release-continuation-acquire.py',
    'scripts/cn-release-continuation-bind.py',
    'scripts/cn-release-continuation-finalize.py',
    'scripts/cn-release-continuation-journal.py',
    'scripts/cn-release-derived-approval.py',
    'scripts/cn-release-fixed-driver.py',
    'scripts/cn-release-generated-commands.py',
    'scripts/cn-release-installation-closure.py',
    'scripts/cn-release-mvp-approval-prepare.py',
    'scripts/cn-release-mvp-cloud-prepare.py',
    'scripts/cn-release-mvp-chain.py',
    'scripts/cn-release-mvp-content-stage.py',
    'scripts/cn-release-mvp-contract.py',
    'scripts/cn-release-mvp-driver-stages.py',
    'scripts/cn-release-mvp-evidence-materializer.py',
    'scripts/cn-release-mvp-evidence.py',
    'scripts/cn-release-mvp-nonmodel.py',
    'scripts/cn-release-mvp-stage-evidence.py',
    'scripts/cn-release-mvp-trusted-collector.py',
    'scripts/cn-release-orchestrate.py',
    'scripts/cn-release-publication-observer.py',
    'scripts/cn-release-rds-backup.py',
    'scripts/cn-release-recovery-admission.py',
    'scripts/cn-release-recovery-contract.py',
    'scripts/cn-release-recovery-driver.py',
    'scripts/cn-release-recovery-writer.py',
    'scripts/cn-release-runtime-delegation.py',
    'scripts/cn-release-runtime-observe.py',
    'scripts/cn-release-runtime-readback.py',
    'scripts/cn-release-runtime-stage.py',
    'scripts/cn-release-stage-contract.py',
    'scripts/cn-release-stage-router.py',
    'scripts/cn-release-terminal-delegation.py',
    'scripts/cn_candidate_revalidation.py',
    'scripts/cn_image_archive.py',
    'scripts/cn_image_candidate.py',
    'scripts/hosted-release.py',
    'scripts/cn-release-mvp-original-producer.py',
    'scripts/cn-release-mvp-original-retention.py',
    'scripts/cn-release-mvp-transfer-input.py',
    'scripts/cn-release-mvp-dispatch.py',
    'scripts/cn-hk-original-artifact-upload.py',
    'scripts/bounded_workers.py',
    'scripts/cn_candidate_github.py',
    'apps/api/scripts/platform-content-release.ts',
    'apps/api/scripts/platform-content-release-core.ts',
    'apps/api/scripts/platform-schema-readback.ts',
    'apps/api/scripts/platform-schema-readback-core.ts',
)
CONTENT_SOURCE_FILES = ('apps/api/scripts/platform-content-release-core.ts', 'apps/api/scripts/platform-content-release.ts',
                        'apps/api/scripts/platform-schema-readback-core.ts', 'apps/api/scripts/platform-schema-readback.ts')

def inventory(root):
    root = Path(root)
    result = {}
    for relative in CONTROL_FILES:
        path = root / relative
        if any(parent.is_symlink() for parent in (path, *path.parents)) or not path.is_file():
            raise ValueError('CONTROL_FILE_MISSING_OR_SYMLINK:' + relative)
        if path.stat().st_size > 1048576: raise ValueError('CONTROL_FILE_TOO_LARGE:' + relative)
        result[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result

def digest(files):
    return hashlib.sha256((json.dumps(files,sort_keys=True,separators=(',', ':'))+'\n').encode()).hexdigest()

def content_source_inventory(root):
    return {name: hashlib.sha256((Path(root)/name).read_bytes()).hexdigest() for name in CONTENT_SOURCE_FILES}

def closure_status():
    return {'sourceFilesAreRuntimeClosure': False, 'runtimeDependencyClosureVerified': False,
            'requiredRuntimeClosures': ['source-bound API dependency tree and lockfile',
             'pinned Node/tsx interpreter', 'existing scoped database environment',
             'root-owned exact control Git checkout', 'provider authenticated read-only clients']}
