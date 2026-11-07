#!/usr/bin/env python3
"""Real entry -> kernel fsync EIO -> no replay -> original reconcile.

GitHub Linux root only. Single synthetic consume-stage external effect, real
entry/flock/cgroup/journal; not physical power loss or full release acceptance.
Mounts exist only in a private namespace. Outer owned cgroup also contains
setsid descendants; missing capabilities fail instead of skipping.
"""
import datetime as dt
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


primitive = load('fsync_primitive', ROOT / 'tests/cn_release_fsync_linux.py')
containment = load('fsync_containment', ROOT / 'scripts/cn_release_simulation_domain.py')
need, command, namespace, mount_row = primitive.need, primitive.command, primitive.namespace, primitive.mount_row

VERIFIER = b"import json\ndef verify(raw, manifest, previous, mode):\n return {'externalWritesTerminal':True} if mode=='terminal' and json.loads(raw)=={'verified':True} else json.loads(raw)=={'verified':True}\n"
OK = b"printf '%s\\n' '{\"verified\":true}'\n"


def package(entry, action, observer, stage='consume', previous=None):
    start = entry.now() - dt.timedelta(seconds=2)
    manifest = dict(schemaVersion=1, sourceRevision='1'*40, baselineRevision='2'*40,
        controlRevision='3'*40, attemptId='fsync-one', scope='runtime-only-reviewed-continuation',
        stage=stage, previousReceiptSha256=previous, issuedAt=start.isoformat(),
        expiresAt=(start+dt.timedelta(minutes=20)).isoformat(), requestedAt=start.isoformat(),
        deadlineAt=(start+dt.timedelta(minutes=30)).isoformat(), timeoutSeconds=3,
        actionSha256=entry.digest(action), observerSha256=entry.digest(observer),
        verifierSha256=entry.digest(VERIFIER), authorizationEvidenceSha256=entry.digest(b'{"fixture":true}\n'))
    raw = entry.encode(manifest)
    digest = entry.digest(raw)
    folder = entry.REQUESTS / digest
    folder.mkdir(mode=0o700)
    for name, data in [('manifest.json', raw), ('action.sh', action), ('observe.sh', observer),
                       ('verify.py', VERIFIER), ('authorization.json', b'{"fixture":true}\n')]:
        entry.create(folder / name, data)
    return digest


def exercise(path, fuse, fault, output):
    entry = load('real_entry', ROOT / '.harness/scripts/vm/cn-release-advance.py')
    entry.REQUESTS = path / 'requests'
    entry.REQUESTS.mkdir(mode=0o700)
    entry.STATE = path / 'state'
    entry.OWNER = os.getuid()
    base = containment.current_cgroup() / ('workspacex-ci-entry-' + uuid.uuid4().hex)
    base.mkdir(mode=0o700)
    identity = (base.stat().st_dev, base.stat().st_ino)
    entry.CGROUP_BASE = base
    try:
        marker = path / 'effect'
        publish = path / 'publication-effect'
        action = ('printf x >> ' + shlex.quote(str(marker)) + '\n' +
                  'touch ' + shlex.quote(str(fault)) + '\n').encode() + OK
        observer = ('test "$(cat ' + shlex.quote(str(marker)) + ')" = x || exit 19\n').encode() + OK
        request = package(entry, action, observer)
        baseline = fuse / 'prior.receipt.json'
        entry.create(baseline, b'{"prior":true}\n')
        error_number = None
        try:
            entry.entry('advance', request, 'fsync-one')
        except OSError as exc:
            error_number = exc.errno
        need(error_number == errno.EIO, 'TERMINAL_FSYNC_EIO_REQUIRED')
        prefix = '00-consume'
        receipt = fuse / (prefix + '.receipt.json')
        terminal = fuse / (prefix + '.terminal.json')
        output.flush()
        need(b'FSYNC_EIO /00-consume.terminal.json\n' in (path / 'server.log').read_bytes(),
             'EXACT_TERMINAL_FSYNC_FAILURE_REQUIRED')
        need(marker.read_bytes() == b'x' and not receipt.exists(), 'NO_SUCCESS_AFTER_FAULT_REQUIRED')
        need(entry.entry('status', request, 'fsync-one')['status'] == 'UNCERTAIN', 'UNCERTAIN_REQUIRED')
        preserved = {name: (fuse/name).read_bytes() for name in
                     ('prior.receipt.json', 'identity.json', prefix+'.intent.json', prefix+'.process.json', prefix+'.terminal.json')}
        # Both before and after device recovery, advance must never retry action.
        for recovered in (False, True):
            if recovered:
                fault.unlink()
            try:
                entry.entry('advance', request, 'fsync-one')
            except entry.Rejected as exc:
                need(str(exc) == 'UNCERTAIN_RECONCILE_NO_RETRY', 'WRONG_REPLAY_REJECTION')
            else:
                raise RuntimeError('UNCERTAIN_ACTION_REPLAYED')
            need(marker.read_bytes() == b'x' and not receipt.exists(), 'REPLAY_SIDE_EFFECT')
        # A later publication stage must not execute without the prior receipt.
        # Copy original epoch clocks so rejection concerns missing prior proof.
        publication = package(entry, ('touch '+shlex.quote(str(publish))+'\n').encode()+OK, OK,
                              stage='publication-stage', previous='0'*64)
        original, _ = entry.load_package(request, 'fsync-one')
        folder = entry.REQUESTS / publication
        manifest = entry.decode((folder/'manifest.json').read_bytes())
        for key in ('requestedAt','deadlineAt'):
            manifest[key] = original[key]
        raw = entry.encode(manifest)
        replacement = entry.REQUESTS / entry.digest(raw)
        replacement.mkdir(mode=0o700)
        for child in folder.iterdir():
            entry.create(replacement/child.name, raw if child.name == 'manifest.json' else child.read_bytes())
        try:
            entry.entry('advance', entry.digest(raw), 'fsync-one')
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError('PUBLICATION_WITHOUT_PRIOR_RECEIPT')
        need(not publish.exists(), 'PUBLICATION_EXECUTED')
        recovered = entry.entry('reconcile', request, 'fsync-one')
        need(recovered['status'] == 'COMPLETED' and recovered['mutationExecuted'] is False, 'RECONCILE_FAILED')
        receipt_bytes = receipt.read_bytes()
        need(entry.decode(receipt_bytes)['mode'] == 'reconcile', 'RECONCILE_RECEIPT_REQUIRED')
        for mode in ('status', 'advance', 'reconcile'):
            result = entry.entry(mode, request, 'fsync-one')
            need(result['status'] == 'COMPLETED' and result['mutationExecuted'] is False
                 and result['receiptSha256'] == entry.digest(receipt_bytes), 'COMPLETED_REENTRY_CHANGED')
        need(all((fuse/name).read_bytes() == data for name, data in preserved.items()), 'ORIGINAL_EVIDENCE_CHANGED')
        need(marker.read_bytes() == b'x' and not publish.exists(), 'RECOVERY_REPLAY_OR_PUBLICATION')
        log = (path/'server.log').read_bytes()
        need(len(log) <= 16384 and b'FSYNC_OK /00-consume.receipt.json\n' in log, 'RECOVERY_FSYNC_REQUIRED')
        return dict(verified=True, originalEntryExecuted=True, originalReconcileExecuted=True,
                    terminalFsyncErrno=error_number, actionExecutionCount=1, uncertainReplayRejected=True,
                    publicationWithoutPriorReceiptRejected=True, originalEvidencePreserved=True,
                    completedReentryNoMutation=True, receiptSha256=entry.digest(receipt_bytes),
                    realOwnedCgroup=True, fullReleaseRecoveryTested=False, physicalPowerLossTested=False)
    finally:
        # Only this exact empty owned subtree; populated descendants are handled
        # by outer Domain on failure, never a broad process scan.
        containment.remove_empty_tree(base, identity)


def worker(path, binary, parent_ns, mode):
    need(namespace() != parent_ns and os.readlink('/proc/' + str(os.getppid()) + '/ns/mnt') == parent_ns,
         'PRIVATE_NAMESPACE_REQUIRED')
    need(not any(part.startswith('shared:') for line in Path('/proc/self/mountinfo').read_text().splitlines()
                 for part in line.split(' - ', 1)[0].split()[6:]), 'PRIVATE_PROPAGATION_REQUIRED')
    need(path.parent == Path('/run') and re.fullmatch('wsx-fsync-test-[a-f0-9]{32}', path.name)
         and path.resolve(strict=True) == path and not list(path.iterdir()) and mount_row(path) is None, 'OWNED_EMPTY_PATH_REQUIRED')
    server = None
    mounted = False
    state = path / 'state'
    fuse = state / 'fsync-one'
    output = None
    try:
        command(['/usr/bin/mount', '-t', 'tmpfs', '-o', 'size=8m,nr_inodes=128,mode=0700,nodev,nosuid,noexec', path.name, str(path)])
        mounted = True
        row = mount_row(path)
        need(row is not None and row[1][:2] == ['tmpfs', path.name], 'TMPFS_IDENTITY')
        need(0 < os.statvfs(path).f_blocks * os.statvfs(path).f_frsize <= 8 * 1024 * 1024, 'TMPFS_BOUND')
        state.mkdir(mode=0o700)
        fuse.mkdir(mode=0o700)
        fault = path / 'fault-enabled'
        output = (path / 'server.log').open('w+b')
        server = subprocess.Popen([str(binary), str(fuse), str(fault)], stdout=output, stderr=output,
                                  stdin=subprocess.DEVNULL, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        until = time.monotonic() + 5
        while mount_row(fuse) is None and server.poll() is None and time.monotonic() < until:
            time.sleep(.02)
        row = mount_row(fuse)
        need(row is not None and row[1][0].startswith('fuse') and row[1][1] == 'wsx-fsync-fault', 'FUSE_MOUNT_IDENTITY')
        need({'nodev', 'nosuid', 'noexec'} <= set(row[0][5].split(',')), 'FUSE_MOUNT_FLAGS')
        result = exercise(path, fuse, fault, output)
    finally:
        if mount_row(fuse) is not None:
            row = mount_row(fuse)
            need(row[1][0].startswith('fuse') and row[1][1] == 'wsx-fsync-fault', 'UNMOUNT_IDENTITY_CHANGED')
            command(['/usr/bin/umount', str(fuse)])
            need(mount_row(fuse) is None, 'FUSE_UNMOUNT_UNPROVEN')
        if server is not None:
            if server.poll() is None:
                server.terminate()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=3)
        if output is not None:
            output.close()
        if mounted:
            row = mount_row(path)
            need(row is not None and row[1][:2] == ['tmpfs', path.name], 'TMPFS_UNMOUNT_IDENTITY_CHANGED')
            command(['/usr/bin/umount', str(path)])
            need(mount_row(path) is None, 'TMPFS_UNMOUNT_UNPROVEN')
    result['explicitUnmountVerified'] = True
    result['serverExited'] = True
    print(json.dumps(result), flush=True)


def run_case(binary):
    path = Path('/run') / ('wsx-fsync-test-' + uuid.uuid4().hex)
    path.mkdir(mode=0o700)
    identity = (path.stat().st_dev, path.stat().st_ino)
    parent_ns = namespace()
    domain = None
    process = None
    cleanup = None
    try:
        domain = containment.Domain()
        process = domain.spawn(['/usr/bin/unshare', '--mount', '--propagation', 'private',
            sys.executable, '-I', '-B', str(Path(__file__).resolve()), '--worker', str(path), str(binary), parent_ns],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
            start_new_session=True, env={'PATH':'/usr/bin:/bin', 'LANG':'C.UTF-8'})
        stdout, stderr = process.communicate(timeout=35)
        need(len(stdout)+len(stderr) <= 16384, 'WORKER_OUTPUT_LIMIT')
        if process.returncode != 0:
            print(json.dumps({'stage':'entry-worker', 'exitCode':process.returncode,
                              'stdoutBytes':len(stdout), 'stderrBytes':len(stderr),
                              'stderrSha256':hashlib.sha256(stderr).hexdigest()}), file=sys.stderr)
        need(process.returncode == 0, 'ENTRY_FSYNC_WORKER_FAILED')
        result = json.loads(stdout)
        need(result['verified'] is True, 'WORKER_UNVERIFIED')
    finally:
        if domain is not None:
            cleanup = domain.close(process)
            need(cleanup['verified'] is True, 'OWNED_CGROUP_CLEANUP_UNPROVEN')
        if process is not None:
            process.communicate(timeout=5)
            for pipe in (process.stdout, process.stderr):
                pipe.close()
        need(namespace() == parent_ns and mount_row(path) is None, 'HOST_MOUNT_CHANGED')
        after = path.stat()
        need((after.st_dev, after.st_ino) == identity and not list(path.iterdir()), 'HOST_DIRECTORY_CHANGED')
        path.rmdir()
    result['cleanup'] = cleanup
    result['hostMountUnchanged'] = True
    result['ownedHostDirectoryRemoved'] = True
    return result


def main():
    if sys.platform != 'linux' or os.geteuid() != 0 or os.environ.get('GITHUB_ACTIONS') != 'true':
        print(json.dumps({'verified':False, 'reason':'GITHUB_LINUX_ROOT_REQUIRED'}))
        return 2
    try:
        need(Path('/dev/fuse').exists() and stat.S_ISCHR(Path('/dev/fuse').stat().st_mode), 'DEV_FUSE_REQUIRED')
        need(all(shutil.which(x) for x in ('gcc','pkg-config','unshare','mount','umount')), 'TOOLS_REQUIRED')
        flags = command(['pkg-config','--cflags','--libs','fuse3']).split()
        with tempfile.TemporaryDirectory(prefix='wsx-entry-fsync-build-') as directory:
            binary = Path(directory)/'faultfs'
            command(['gcc','-O2','-Wall','-Wextra',str(ROOT/'tests/fixtures/cn-storage-fsync/faultfs.c'),'-o',str(binary),*flags], timeout=20)
            result = run_case(binary)
        print(json.dumps({'kind':'cn-entry-fsync-recovery-linux-v1', 'verified':True, 'result':result,
                          'productionAccepted':False, 'cloudCalls':0}))
        return 0
    except Exception as exc:
        print(json.dumps({'verified':False, 'error':type(exc).__name__, 'reason':str(exc)[:200],
                          'productionAccepted':False}))
        return 1


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--worker':
        worker(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], 'entry-recovery')
    else:
        sys.exit(main())
