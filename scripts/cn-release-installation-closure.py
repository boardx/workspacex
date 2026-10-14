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
    'scripts/cn-release-mvp-private-input.py',
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

def fixed_wrapper(files, entry):
    """Reproduce approved wrapper bytes on a cloud executor; no local inputs."""
    files = dict(sorted(files.items()))
    entries = {
        'release': (('run', 'status', 'reconcile'), 'cn-release-fixed-driver.py'),
        'evidence': (('approval', 'terminal'), 'cn-release-mvp-evidence.py'),
        'prepare': (('prepare', 'terminal'), 'cn-release-mvp-cloud-prepare.py'),
    }
    modes, leaf = entries[entry]
    root = '/usr/local/lib/workspacex-cn/continuation-control/' + digest(files)
    source = '''#!/usr/bin/python3 -IB
import hashlib,os,re,stat,sys
from pathlib import Path
root=Path(ROOT_VALUE)
pins=PINS_VALUE
if os.geteuid()!=0 or len(sys.argv)!=3 or sys.argv[1]not in MODES_VALUE or not re.fullmatch('[a-f0-9]{64}',sys.argv[2]):raise SystemExit(20)
for name,pin in pins.items():
 path=root/name
 for parent in path.parents:
  st=parent.lstat()
  if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_mode&0o022:raise SystemExit(20)
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb')as stream:
  st=os.fstat(stream.fileno())
  if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_mode&0o077 or st.st_nlink!=1 or st.st_size>1048576:raise SystemExit(20)
  if hashlib.sha256(stream.read(1048577)).hexdigest()!=pin:raise SystemExit(20)
path=Path(FULL_LEAF_VALUE)
source=path.read_bytes()
if hashlib.sha256(source).hexdigest()!=pins['scripts/'+LEAF_VALUE]:raise SystemExit(20)
exec(compile(source,str(path),'exec'),{'__file__':str(path),'__name__':'__main__'})
'''
    for key, value in {'ROOT_VALUE':repr(root),'PINS_VALUE':repr(files),'MODES_VALUE':repr(modes),'FULL_LEAF_VALUE':repr(root+'/scripts/'+leaf),'LEAF_VALUE':repr(leaf)}.items():
        source = source.replace(key, value)
    return source.encode()

def content_source_inventory(root):
    return {name: hashlib.sha256((Path(root)/name).read_bytes()).hexdigest() for name in CONTENT_SOURCE_FILES}

def closure_status():
    return {'sourceFilesAreRuntimeClosure': False, 'runtimeDependencyClosureVerified': False,
            'requiredRuntimeClosures': ['source-bound API dependency tree and lockfile',
             'pinned Node/tsx interpreter', 'existing scoped database environment',
             'root-owned exact control Git checkout', 'provider authenticated read-only clients']}


INSTALLATION_DIRECTORIES = (
    '/etc/workspacex-cn/mvp-approval-blueprints',
    '/etc/workspacex-cn/mvp-approval-blueprints/objects',
    '/var/lib/workspacex-cn/release-generated/mvp-approval',
    '/etc/workspacex-cn/mvp-evidence',
    '/etc/workspacex-cn/mvp-evidence/selectors',
    '/etc/workspacex-cn/mvp-evidence/objects',
    '/etc/workspacex-cn/continuation-requests',
    '/etc/workspacex-cn/continuation-approvals',
    '/var/lib/workspacex-cn/continuation',
    '/etc/workspacex-cn/release-approvals',
    '/etc/workspacex-cn/runtime-readback-approvals',
    '/etc/workspacex-cn/continuation-finalize-approvals',
    '/var/lib/workspacex-cn/continuation-evidence',
    '/var/lib/workspacex-cn/continuation-derived-requests',
    '/var/lib/workspacex-cn/release-driver',
    '/var/lib/workspacex-cn/release-generated',
    '/var/lib/workspacex-cn/release-inputs',
    '/etc/workspacex-cn/acquire-observers',
    '/etc/workspacex-cn/publication-observers',
    '/etc/workspacex-cn/runtime-observer-approvals',
    '/etc/workspacex-cn/writer-resume-approvals',
    '/etc/workspacex-cn/writer-resume-approvals/by-release',
    '/etc/workspacex-cn/recovery-writer-resume-approvals',
    '/etc/workspacex-cn/recovery-writer-resume-approvals/by-recovery',
    '/etc/workspacex-cn/release-recovery-approvals',
    '/etc/workspacex-cn/release-recovery-approvals/by-failed-request',
    '/etc/workspacex-cn/mvp-cloud-policies',
    '/etc/workspacex-cn/mvp-cloud-policies/objects',
    '/var/lib/workspacex-cn/release-generated/mvp-cloud-preparation',
)

FIXED_ENTRIES = (
    '/usr/local/bin/workspacex-cn-fixed-release',
    '/usr/local/bin/workspacex-cn-mvp-evidence',
    '/usr/local/bin/workspacex-cn-mvp-prepare-approved',
    '/usr/local/bin/workspacex-cn-release-advance',
    '/usr/local/bin/workspacex-cn-fixed-recovery',
    '/usr/local/bin/workspacex-cn-deploy',
)
