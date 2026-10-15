#!/usr/bin/env python3
"""Real bounded tmpfs ENOSPC against the production entry journal primitive.

Private mount namespace only; never fill host storage. Missing Linux/root/mount
capabilities fail. This proves write failure handling, not injected fsync errors,
full release-driver recovery, provider storage, or production acceptance.
"""
import concurrent.futures
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import random
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 4 * 1024 * 1024


def require(value, code):
    if not value: raise RuntimeError(code)


def mount_row(path):
    rows = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        left, right = line.split(' - ', 1)
        fields = left.split(); fs = right.split()
        if fields[4] == str(path): rows.append((fields, fs))
    require(len(rows) <= 1, 'AMBIGUOUS_MOUNT')
    return rows[0] if rows else None


def namespace():
    return os.readlink('/proc/self/ns/mnt')


def worker(path, parent_namespace, mode, seed):
    require(os.readlink('/proc/'+str(os.getppid())+'/ns/mnt') == parent_namespace, 'PARENT_NAMESPACE_BINDING')
    require(namespace() != parent_namespace, 'PRIVATE_MOUNT_NAMESPACE_REQUIRED')
    require(not any(part.startswith('shared:') for line in Path('/proc/self/mountinfo').read_text().splitlines()
                    for part in line.split(' - ', 1)[0].split()[6:]), 'PRIVATE_PROPAGATION_REQUIRED')
    require(path.parent == Path('/run') and re.fullmatch('wsx-storage-test-[a-f0-9]{32}', path.name), 'OWNED_PATH_REQUIRED')
    require(path.resolve(strict=True) == path and not list(path.iterdir()) and mount_row(path) is None, 'EMPTY_UNMOUNTED_PATH_REQUIRED')
    source = path.name; mounted = False
    try:
        subprocess.run(['/usr/bin/mount', '-t', 'tmpfs', '-o', 'size=4m,nr_inodes=128,mode=0700,nodev,nosuid,noexec', source, str(path)], check=True, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        mounted = True
        row = mount_row(path)
        require(row is not None and row[1][0] == 'tmpfs' and row[1][1] == source, 'MOUNT_IDENTITY_REQUIRED')
        require({'nodev', 'nosuid', 'noexec'} <= set(row[0][5].split(',')), 'MOUNT_FLAGS_REQUIRED')
        fs = os.statvfs(path)
        require(0 < fs.f_blocks * fs.f_frsize <= LIMIT, 'FILESYSTEM_CAPACITY_BOUND')
        mounted_receipt = {'privateNamespace': True, 'mountSource': source, 'capacityBytes': fs.f_blocks * fs.f_frsize}
        if mode == 'timeout':
            print(json.dumps({'ready': mounted_receipt}), flush=True)
            time.sleep(60)
            raise RuntimeError('TIMEOUT_FIXTURE_NOT_INTERRUPTED')
        spec = importlib.util.spec_from_file_location('entry', ROOT / '.harness/scripts/vm/cn-release-advance.py')
        entry = importlib.util.module_from_spec(spec); spec.loader.exec_module(entry)
        original = b'{"kind":"synthetic-existing-receipt","verified":true}\n'
        evidence = path / 'existing.receipt.json'; entry.create(evidence, original)
        baseline = hashlib.sha256(evidence.read_bytes()).hexdigest()
        import threading
        barrier = threading.Barrier(2)
        delays = [random.Random(seed + index).randrange(21) / 1000 for index in range(2)]
        def fill(index):
            fd = os.open(path / ('filler-' + str(index)), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            written = 0
            try:
                barrier.wait(timeout=5); time.sleep(delays[index])
                while written < 2 * LIMIT:
                    written += os.write(fd, b'x' * 65536)
                raise RuntimeError('EXPECTED_ENOSPC_NOT_REACHED')
            except OSError as error:
                require(error.errno == errno.ENOSPC, 'WRITER_FAILURE_NOT_ENOSPC')
                return {'writer': index, 'writtenBytes': written, 'errno': error.errno}
            finally: os.close(fd)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(fill, range(2)))
        require(os.statvfs(path).f_bavail == 0, 'FILESYSTEM_NOT_FULL')
        success_reported = False; failure_errno = None
        try:
            entry.create(path / 'new.intent.json', b'{"kind":"new-intent","value":"must-not-succeed"}\n')
            success_reported = True
        except OSError as error: failure_errno = error.errno
        require(not success_reported and failure_errno == errno.ENOSPC, 'JOURNAL_FAILED_TO_REJECT_ENOSPC')
        require(evidence.read_bytes() == original and hashlib.sha256(evidence.read_bytes()).hexdigest() == baseline, 'EXISTING_EVIDENCE_CHANGED')
        # No replacement of an original receipt is permitted even under pressure.
        try: entry.create(evidence, b'replacement')
        except FileExistsError: pass
        else: raise RuntimeError('ORIGINAL_EVIDENCE_OVERWRITTEN')
        require(evidence.read_bytes() == original, 'ORIGINAL_EVIDENCE_LOST')
        result = {'verified': True, 'tests': ['concurrent_writes_reach_real_enospc',
            'production_entry_create_propagates_write_failure', 'existing_evidence_preserved'],
            'mount': mounted_receipt, 'writers': results, 'seed': seed, 'staggerSeconds': delays,
            'journalErrno': failure_errno, 'successReported': success_reported,
            'originalSha256': baseline, 'fsyncFailureTested': False,
            'fullReleaseDriverTested': False, 'productionAccepted': False, 'cloudCalls': 0}
    finally:
        if mounted:
            row = mount_row(path)
            require(row is not None and row[1][0] == 'tmpfs' and row[1][1] == source, 'UNMOUNT_IDENTITY_CHANGED')
            subprocess.run(['/usr/bin/umount', str(path)], check=True, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            require(mount_row(path) is None, 'UNMOUNT_UNCONFIRMED')
    result['explicitUnmountVerified'] = True
    print(json.dumps(result), flush=True)


def run_case(mode, seed):
    path = Path('/run') / ('wsx-storage-test-' + uuid.uuid4().hex)
    path.mkdir(mode=0o700); st = path.stat(); identity = (st.st_dev, st.st_ino)
    parent_namespace = namespace(); process = None; timed_out = False
    try:
        command = ['/usr/bin/unshare', '--mount', '--propagation', 'private',
                   sys.executable, '-I', '-B', str(Path(__file__).resolve()), '--worker',
                   str(path), parent_namespace, mode, str(seed)]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL, start_new_session=True, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        try: stdout, stderr = process.communicate(timeout=3 if mode == 'timeout' else 30)
        except subprocess.TimeoutExpired:
            timed_out = True
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            stdout, stderr = process.communicate(timeout=5)
        require(len(stdout) <= 16384 and len(stderr) <= 16384, 'OUTPUT_BOUND')
        value = json.loads(stdout)
        if mode == 'timeout':
            require(timed_out and process.returncode != 0 and value['ready']['privateNamespace'] is True, 'TIMEOUT_AFTER_MOUNT_NOT_PROVEN')
            value = {'verified': True, 'test': 'timeout_releases_private_mount_namespace', 'mountedBeforeTimeout': value['ready'], 'explicitUnmountVerified': False}
        else: require(not timed_out and process.returncode == 0 and value['verified'] is True, 'STORAGE_WORKER_FAILED')
    finally:
        if process is not None:
            if process.poll() is None:
                try: os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError: pass
            process.wait(timeout=5)
            for stream in (process.stdout, process.stderr):
                if stream is not None: stream.close()
        require(namespace() == parent_namespace and mount_row(path) is None, 'HOST_MOUNT_CHANGED')
        after = path.stat()
        require((after.st_dev, after.st_ino) == identity and not list(path.iterdir()), 'HOST_DIRECTORY_CHANGED_OR_NOT_EMPTY')
        path.rmdir()
    value['hostMountUnchanged'] = True; value['ownedDirectoryRemoved'] = True
    return value


def main():
    if sys.platform != 'linux' or os.geteuid() != 0:
        print(json.dumps({'verified': False, 'status': 'CAPABILITY_UNAVAILABLE', 'reason': 'LINUX_ROOT_REQUIRED'})); return 2
    try:
        require(all(Path(p).is_file() for p in ['/usr/bin/unshare', '/usr/bin/mount', '/usr/bin/umount']), 'MOUNT_TOOLS_REQUIRED')
        seed = int(os.environ.get('CN_RELEASE_SIMULATION_SEED', '0'))
        results = [run_case('enospc', seed), run_case('timeout', seed)]
    except Exception as error:
        print(json.dumps({'verified': False, 'status': 'FAILED_OR_CAPABILITY_UNAVAILABLE', 'error': type(error).__name__, 'cloudCalls': 0})); return 1
    print(json.dumps({'verified': True, 'status': 'PASSED', 'results': results,
                      'fsyncFailureTested': False, 'productionAccepted': False, 'cloudCalls': 0})); return 0


if __name__ == '__main__':
    if len(sys.argv) == 6 and sys.argv[1] == '--worker':
        worker(Path(sys.argv[2]), sys.argv[3], sys.argv[4], int(sys.argv[5]))
    else: sys.exit(main())
