#!/usr/bin/env python3
"""Actual production entry.create against kernel FUSE fsync EIO and recovery.

GitHub Linux/root only; requires libfuse3-dev, gcc, pkg-config and /dev/fuse.
No install, device mapper, physical power-loss claim, or production access.
Private mount namespace + bounded tmpfs; missing capabilities fail, never skip.
"""
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def need(value, code):
    if not value:
        raise RuntimeError(code)


def command(argv, timeout=10):
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=True)
    need(len(result.stdout) + len(result.stderr) <= 16384, 'FIXTURE_COMMAND_OUTPUT_LIMIT')
    return result.stdout.decode().strip()


def mount_row(path):
    rows = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        left, right = line.split(' - ', 1)
        if left.split()[4] == str(path):
            rows.append((left.split(), right.split()))
    need(len(rows) <= 1, 'AMBIGUOUS_MOUNT')
    return rows[0] if rows else None


def namespace():
    return os.readlink('/proc/self/ns/mnt')


def worker(path, binary, parent_ns, mode):
    need(namespace() != parent_ns and os.readlink('/proc/' + str(os.getppid()) + '/ns/mnt') == parent_ns,
         'PRIVATE_NAMESPACE_REQUIRED')
    need(not any(part.startswith('shared:') for line in Path('/proc/self/mountinfo').read_text().splitlines()
                 for part in line.split(' - ', 1)[0].split()[6:]), 'PRIVATE_PROPAGATION_REQUIRED')
    need(path.parent == Path('/run') and re.fullmatch('wsx-fsync-test-[a-f0-9]{32}', path.name)
         and path.resolve(strict=True) == path and not list(path.iterdir()) and mount_row(path) is None, 'OWNED_EMPTY_PATH_REQUIRED')
    server = None
    mounted = False
    fuse = path / 'fuse'
    output = None
    try:
        command(['/usr/bin/mount', '-t', 'tmpfs', '-o', 'size=8m,nr_inodes=128,mode=0700,nodev,nosuid,noexec', path.name, str(path)])
        mounted = True
        row = mount_row(path)
        need(row is not None and row[1][:2] == ['tmpfs', path.name], 'TMPFS_IDENTITY')
        need(0 < os.statvfs(path).f_blocks * os.statvfs(path).f_frsize <= 8 * 1024 * 1024, 'TMPFS_BOUND')
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
        if mode == 'kill':
            print(json.dumps({'ready': True, 'privateNamespace': True, 'serverPid': server.pid, 'mountNamespace': namespace(), 'serverGroup': os.getpgid(server.pid)}), flush=True)
            time.sleep(60)
            raise RuntimeError('EXPECTED_PARENT_KILL')
        spec = importlib.util.spec_from_file_location('real_entry', ROOT / '.harness/scripts/vm/cn-release-advance.py')
        entry = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(entry)
        original = b'{"kind":"synthetic-prior-receipt","verified":true}\n'
        baseline = fuse / 'original.receipt.json'
        entry.create(baseline, original)
        original_hash = hashlib.sha256(baseline.read_bytes()).hexdigest()
        fault.touch(exist_ok=False)
        error_number = None
        succeeded = False
        failed = fuse / 'failed.intent.json'
        pending = b'{"kind":"synthetic-intent","mustNotReportSuccess":true}\n'
        try:
            entry.create(failed, pending)
            succeeded = True
        except OSError as exc:
            error_number = exc.errno
        need(error_number == errno.EIO and not succeeded, 'REAL_FSYNC_EIO_NOT_PROPAGATED')
        output.flush()
        log = (path / 'server.log').read_bytes()
        need(b'FSYNC_EIO /failed.intent.json\n' in log, 'SERVER_FSYNC_ERROR_NOT_OBSERVED')
        need(failed.read_bytes() == pending, 'WRITE_BEFORE_FSYNC_NOT_PROVEN')
        need(baseline.read_bytes() == original, 'BASELINE_LOST_DURING_FAULT')
        fault.unlink()
        # An ambiguous intent cannot be silently overwritten after storage recovers.
        try:
            entry.create(failed, b'overwrite')
        except FileExistsError:
            pass
        else:
            raise RuntimeError('AMBIGUOUS_INTENT_OVERWRITTEN')
        recovered = fuse / 'after-recovery.receipt.json'
        recovery_bytes = b'{"kind":"synthetic-recovery-probe","verified":true}\n'
        entry.create(recovered, recovery_bytes)
        need(recovered.read_bytes() == recovery_bytes and baseline.read_bytes() == original
             and failed.read_bytes() == pending, 'RECOVERY_READBACK_FAILED')
        log = (path / 'server.log').read_bytes()
        need(len(log) <= 16384 and b'FSYNC_OK /after-recovery.receipt.json\n' in log and b'FSYNC_OK /\n' in log,
             'RECOVERY_FSYNC_NOT_OBSERVED')
        result = {'verified': True, 'realKernelFsyncErrno': error_number, 'productionCreateReturnedSuccess': succeeded,
                  'writeBeforeFsyncProven': True, 'ambiguousIntentPreserved': True, 'recoveryReadbackVerified': True,
                  'originalSha256': original_hash, 'faultModel': 'FUSE storage-server EIO',
                  'physicalPowerLossTested': False, 'fullReleaseRecoveryTested': False}
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


def run_case(binary, mode):
    path = Path('/run') / ('wsx-fsync-test-' + uuid.uuid4().hex)
    path.mkdir(mode=0o700)
    st = path.stat()
    identity = (st.st_dev, st.st_ino)
    parent_ns = namespace()
    process = None
    killed = False
    try:
        process = subprocess.Popen(['/usr/bin/unshare', '--mount', '--propagation', 'private',
            sys.executable, '-I', '-B', str(Path(__file__).resolve()), '--worker', str(path), str(binary), parent_ns, mode],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, start_new_session=True,
            env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        try:
            stdout, stderr = process.communicate(timeout=8 if mode == 'kill' else 25)
        except subprocess.TimeoutExpired:
            killed = True
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate(timeout=5)
        need(len(stdout) + len(stderr) <= 16384, 'WORKER_OUTPUT_LIMIT')
        result = json.loads(stdout)
        if mode == 'kill':
            need(killed and process.returncode == -signal.SIGKILL and result['ready'] is True
                 and result['privateNamespace'] is True and result['serverGroup'] == process.pid, 'KILL_AFTER_FUSE_MOUNT_UNPROVEN')
            until = time.monotonic() + 3
            while True:
                try:
                    alive_namespace = os.readlink('/proc/' + str(result['serverPid']) + '/ns/mnt')
                except FileNotFoundError:
                    break
                if alive_namespace != result['mountNamespace']:
                    break
                need(time.monotonic() < until, 'FUSE_SERVER_NAMESPACE_STILL_ALIVE')
                time.sleep(.02)
            result = {'verified': True, 'forcedKillAfterFuseMount': True, 'serverNamespaceReleased': True, 'explicitUnmountVerified': False}
        else:
            need(not killed and process.returncode == 0 and result['verified'] is True, 'FSYNC_WORKER_FAILED')
    finally:
        if process is not None:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait(timeout=5)
            for pipe in (process.stdout, process.stderr):
                pipe.close()
        need(namespace() == parent_ns and mount_row(path) is None, 'HOST_MOUNT_CHANGED')
        after = path.stat()
        need((after.st_dev, after.st_ino) == identity and not list(path.iterdir()), 'HOST_DIRECTORY_CHANGED')
        path.rmdir()
    result['hostMountUnchanged'] = True
    result['ownedHostDirectoryRemoved'] = True
    return result


def main():
    if sys.platform != 'linux' or os.geteuid() != 0 or os.environ.get('GITHUB_ACTIONS') != 'true':
        print(json.dumps({'verified': False, 'reason': 'GITHUB_LINUX_ROOT_REQUIRED'}))
        return 2
    started = time.monotonic()
    try:
        need(Path('/dev/fuse').exists() and stat.S_ISCHR(Path('/dev/fuse').stat().st_mode), 'DEV_FUSE_REQUIRED')
        need(all(shutil.which(x) for x in ('gcc', 'pkg-config', 'unshare', 'mount', 'umount')), 'FUSE_BUILD_MOUNT_TOOLS_REQUIRED')
        flags = command(['pkg-config', '--cflags', '--libs', 'fuse3']).split()
        with tempfile.TemporaryDirectory(prefix='wsx-fsync-build-') as directory:
            binary = Path(directory) / 'faultfs'
            source = ROOT / 'tests/fixtures/cn-storage-fsync/faultfs.c'
            command(['gcc', '-O2', '-Wall', '-Wextra', str(source), '-o', str(binary), *flags], timeout=20)
            results = [run_case(binary, 'fault-recovery'), run_case(binary, 'kill')]
        print(json.dumps({'kind': 'cn-storage-fsync-linux-v1', 'verified': True, 'results': results,
                          'durationSeconds': round(time.monotonic() - started, 3),
                          'productionAccepted': False, 'cloudCalls': 0}))
        return 0
    except Exception as exc:
        print(json.dumps({'verified': False, 'status': 'FAILED_OR_CAPABILITY_UNAVAILABLE',
                          'error': type(exc).__name__, 'reason': str(exc)[:256], 'productionAccepted': False}))
        return 1


if __name__ == '__main__':
    if len(sys.argv) == 6 and sys.argv[1] == '--worker':
        worker(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], sys.argv[5])
    else:
        sys.exit(main())
