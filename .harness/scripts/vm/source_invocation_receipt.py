#!/usr/bin/env python3
"""Own and join bounded offline source operations; no policy approval or live capture.

Only the two compiled branches below may execute. Receipt identity comes from
/proc and actual file bytes, never caller supplied PID/outcome fields.
"""
import ctypes
import importlib
import hashlib
import json
import math
import os
from pathlib import Path
import re
import select
import signal
import stat
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent
MAX_BYTES = 16 * 1024 * 1024
MODULES = ('source_invocation_receipt', 'current_held_epoch_evidence_producer',
           'isolated_conservation_evidence_producer', 'cn_backup_package',
           'writer_fence', 'isolated_conservation_plan', 'isolated_conservation_stage',
           'isolated_rehearsal', 'cn_production_recovery_executor',
           'isolated_conservation_inputs', 'isolated_canonical_plan_factory')


def require(value, code):
    if not value:
        raise ValueError(code)


def source_path(operation):
    if operation == 'collection':
        return ROOT / 'current_held_epoch_evidence_producer.py'
    if operation == 'conservation':
        return ROOT / 'isolated_conservation_evidence_producer.py'
    raise ValueError('INVOCATION_OPERATION_UNSUPPORTED')


def read_bytes(path, maximum=MAX_BYTES, mode=0o600):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'INVOCATION_PATH')
    for parent in path.parents:
        if parent == Path("/") and os.geteuid() != 0:
            continue
        s = parent.lstat()
        require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid() and s.st_gid == os.getegid() and not s.st_mode & 0o022, 'INVOCATION_PARENT_TRUST')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        s = os.fstat(stream.fileno())
        require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_uid == os.geteuid() and s.st_gid == os.getegid() and stat.S_IMODE(s.st_mode) == mode, 'INVOCATION_FILE_TRUST')
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        named = path.lstat()
        require(len(raw) <= maximum, 'INVOCATION_BYTE_LIMIT')
        require((s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) and (s.st_dev, s.st_ino) == (named.st_dev, named.st_ino), 'INVOCATION_FILE_CHANGED')
        return raw


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def reference(path, mode=0o600):
    return {'path': str(Path(path).absolute()), 'sha256': sha(read_bytes(path, 128 * 1024 * 1024, mode))}


def read_reference(ref):
    require(type(ref) is dict and set(ref) == {'path', 'sha256'} and type(ref['sha256']) is str and re.fullmatch('[a-f0-9]{64}', ref['sha256']), 'INVOCATION_REFERENCE')
    raw = read_bytes(ref['path'])
    require(sha(raw) == ref['sha256'], 'INVOCATION_INPUT_HASH')
    return raw


def pinned_open(ref, mode):
    require(reference(ref['path'], mode) == ref, 'INVOCATION_MODULE_PIN')
    fd = os.open(ref['path'], os.O_RDONLY | os.O_NOFOLLOW)
    try:
        actual = os.fstat(fd)
        named = Path(ref['path']).lstat()
        require(stat.S_ISREG(actual.st_mode) and actual.st_uid == os.geteuid() and
                actual.st_gid == os.getegid() and actual.st_nlink == 1 and
                stat.S_IMODE(actual.st_mode) == mode and
                (actual.st_dev, actual.st_ino) == (named.st_dev, named.st_ino),
                'INVOCATION_FD_METADATA')
        raw = os.pread(fd, 128 * 1024 * 1024 + 1, 0)
        require(len(raw) <= 128 * 1024 * 1024 and sha(raw) == ref['sha256'], 'INVOCATION_MODULE_FD_PIN')
        after = os.fstat(fd)
        require((actual.st_size, actual.st_mtime_ns, actual.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'INVOCATION_FD_CHANGED')
        return fd
    except BaseException:
        os.close(fd)
        raise


def proc_identity(child):
    # The worker blocks on its owned gate until these facts have been read.
    process = Path('/proc') / str(child.pid)
    fields = (process / 'stat').read_text().rsplit(')', 1)[1].split()
    require(int(fields[1]) == os.getpid(), 'INVOCATION_OWNED_CHILD')
    namespaces = {name: re.fullmatch(name + r':\[([0-9]+)\]', os.readlink(process / 'ns' / name)).group(1) for name in ('pid', 'mnt', 'net')}
    executable = Path(os.readlink(process / 'exe')).resolve()
    return fields[19], namespaces, reference(executable, 0o755)


def own_group_members(group):
    members = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == group:
                members.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError):
            pass
    return members


def enable_subreaper():
    # Descendants orphaned by the leader become children of this supervisor.
    libc = ctypes.CDLL(None, use_errno=True)
    require(libc.prctl(36, 1, 0, 0, 0) == 0, 'INVOCATION_SUBREAPER_REQUIRED')


def stop_join(child):
    # The inherited session/group is exclusive to this invocation. Killing only
    # a still-running leader misses adopted descendants after leader exit.
    members = own_group_members(child.pid)
    if members:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    until = time.monotonic() + 1
    while own_group_members(child.pid) and time.monotonic() < until:
        if child.poll() is None:
            try:
                child.wait(timeout=.02)
            except subprocess.TimeoutExpired:
                pass
        for pid in own_group_members(child.pid):
            if pid == child.pid:
                continue
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass
        select.select([], [], [], .01)
    if own_group_members(child.pid):
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    child.wait()
    for pid in own_group_members(child.pid):
        if pid == child.pid:
            continue
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            raise ValueError('INVOCATION_DESCENDANT_NOT_OWNED')
    require(not own_group_members(child.pid), 'INVOCATION_DESCENDANTS_UNJOINED')


def pinned_bootstrap(closure, descriptors):
    # This source-fixed loader never resolves repository modules from sys.path.
    fdmap = {name: '/proc/self/fd/' + str(descriptors[name]) for name in MODULES}
    return """import sys,runpy,importlib.abc,importlib.util,importlib.machinery
class PinnedFinder(importlib.abc.MetaPathFinder):
 def find_spec(self,fullname,path=None,target=None):
  pinned=FD_MAP
  if fullname in pinned:return importlib.util.spec_from_loader(fullname,importlib.machinery.SourceFileLoader(fullname,pinned[fullname]))
sys.meta_path.insert(0,PinnedFinder())
sys.argv=[FD_MAP['source_invocation_receipt']]+sys.argv[1:]
runpy.run_path(FD_MAP['source_invocation_receipt'],run_name='__main__',init_globals={'PINNED_SOURCES': SOURCE_REFS})
""".replace('FD_MAP', repr(fdmap)).replace('SOURCE_REFS', repr(closure))


def publish(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    directory = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return {'path': str(path), 'sha256': sha(raw)}


def fixture_authority(operation, identity, isolation, release):
    # Import-only non-root fixtures cannot grant root production authority.
    require(os.geteuid() != 0, 'INVOCATION_ROOT_REQUIRES_PROTECTED_AUTHORITY')
    require(type(identity) is dict and set(identity) == {'sourceRevision', 'baselineRevision', 'migrationPlanSha256', 'attemptId'}, 'INVOCATION_EXPECTED_IDENTITY')
    require(all(type(identity[k]) is str and re.fullmatch('[a-f0-9]{40}', identity[k]) for k in ('sourceRevision', 'baselineRevision')) and type(identity['migrationPlanSha256']) is str and re.fullmatch('[a-f0-9]{64}', identity['migrationPlanSha256']) and type(identity['attemptId']) is str and re.fullmatch('[A-Za-z0-9-]{1,32}', identity['attemptId']), 'INVOCATION_EXPECTED_IDENTITY')
    from isolated_conservation_evidence_producer import FIXED_BASE
    require(identity['baselineRevision'] == FIXED_BASE, 'INVOCATION_EXPECTED_BASELINE')
    if operation == 'conservation':
        require(type(isolation) is dict and set(isolation) == {'candidateSha', 'attemptId', 'targetInstanceId'} and isolation['candidateSha'] == identity['sourceRevision'] and all(type(isolation[k]) is str and re.fullmatch('[A-Za-z0-9-]{1,128}', isolation[k]) for k in ('attemptId', 'targetInstanceId')) and type(release) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,127}', release), 'INVOCATION_EXPECTED_ISOLATION')
    else:
        require(operation == 'collection' and isolation is None and release is None, 'INVOCATION_OPERATION_AUTHORITY')
    return {'identity': dict(identity), 'isolation': None if isolation is None else dict(isolation), 'release': release}


def invoke(operation, binding, producer_id, input_reference, output_root,
           source_sha256, executable_sha256, module_closure, executable_reference, timeout_seconds=30, *, local_fixture_root=None, expected_identity=None, expected_isolation_binding=None, expected_release=None):
    """Run explicit non-root fixtures only; root requires protected authority.

    Production uses parent_source_invocation_receipt.record_production.
    This fixture interface cannot grant production authority.

    Pins are independent source/executable review inputs, not authorization.
    Every file and non-root ancestor must match effective UID/GID (root in
    production), with exact source 0700, existing fixed Python executable
    0755 and private input 0600 modes. External root-protected sourcePolicy still grants admission.
    providerBindingSha256 binds the externally supplied epoch identity; this
    offline operation performs no provider call or identity probe.
    No caller can choose command, callback, PID, timestamps or exit outcome.
    """
    source_path(operation)
    authority = fixture_authority(operation, expected_identity, expected_isolation_binding, expected_release)
    require(type(module_closure) is dict and set(module_closure) == set(MODULES), 'INVOCATION_FIXED_MODULE_CLOSURE')
    source = Path(module_closure['source_invocation_receipt']['path'])
    require(type(binding) is dict and type(binding.get('providerBindingSha256')) is str and re.fullmatch('[a-f0-9]{64}', binding['providerBindingSha256']), 'INVOCATION_PROVIDER_BINDING')
    require(type(producer_id) is str and re.fullmatch('[a-z0-9][a-z0-9._-]{0,127}', producer_id), 'INVOCATION_PRODUCER_ID')
    require(type(timeout_seconds) in (int, float) and math.isfinite(timeout_seconds) and 0 < timeout_seconds <= 300, 'INVOCATION_TIMEOUT_BOUND')
    src = reference(source, 0o700)
    require(src['sha256'] == source_sha256, 'INVOCATION_SOURCE_PIN')
    executable = Path(executable_reference['path'])
    if os.geteuid() == 0:
        require(local_fixture_root is None and executable == Path('/usr/bin/python3').resolve(), 'INVOCATION_FIXED_PYTHON')
    else:
        # Explicit import-only local fixture; root production cannot enable it.
        require(local_fixture_root is not None, 'INVOCATION_LOCAL_FIXTURE_REQUIRED')
        fixture = Path(local_fixture_root).absolute()
        require(executable == fixture / 'python' and Path(output_root).absolute().is_relative_to(fixture)
                and all(Path(ref['path']).is_relative_to(fixture) for ref in module_closure.values()), 'INVOCATION_LOCAL_FIXTURE_BOUNDARY')
    exe = reference(executable, 0o755)
    require(exe == executable_reference, 'INVOCATION_EXECUTABLE_REFERENCE')
    require(exe['sha256'] == executable_sha256, 'INVOCATION_EXECUTABLE_PIN')
    raw = read_reference(input_reference)
    root = Path(output_root).absolute()
    require(root.is_dir() and stat.S_IMODE(root.lstat().st_mode) == 0o700 and not root.is_symlink(), 'INVOCATION_PRIVATE_OUTPUT')
    # Trigger full parent trust checks before spawning or creating a file.
    for parent in (root, *root.parents):
        if parent == Path("/") and os.geteuid() != 0:
            continue
        s = parent.lstat()
        require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid() and s.st_gid == os.getegid() and not s.st_mode & 0o022, 'INVOCATION_OUTPUT_TRUST')
    for name in ('operation.json', 'invocation.json'):
        require(not os.path.lexists(root / name), 'INVOCATION_OUTPUT_EXISTS')
    enable_subreaper()
    descriptors = {}
    for name in MODULES:
        mode = 0o700
        ref = module_closure[name]
        require(type(ref) is dict and set(ref) == {'path', 'sha256'}, 'INVOCATION_MODULE_REFERENCE')
        require(reference(ref['path'], mode) == ref, 'INVOCATION_MODULE_PIN')
    try:
        for name in MODULES:
            ref = module_closure[name]
            descriptors[name] = pinned_open(ref, 0o700)
        executable_fd = pinned_open(exe, 0o755)
        descriptors['__executable__'] = executable_fd
    except BaseException:
        for fd in descriptors.values():
            os.close(fd)
        raise
    ready_read, ready_write = os.pipe()
    child = None
    started = time.time()
    deadline = time.monotonic() + timeout_seconds
    try:
        with tempfile.TemporaryFile(dir=root) as stdout, tempfile.TemporaryFile(dir=root) as stderr:
            child = subprocess.Popen(['/proc/self/fd/' + str(executable_fd), '-I', '-c', pinned_bootstrap(module_closure, descriptors), '--owned-worker', operation, str(ready_write)],
                                     stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                                     pass_fds=(ready_write, *descriptors.values()), start_new_session=True,
                                     env={'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'})
            os.close(ready_write)
            ready_write = None
            available, _, _ = select.select([ready_read], [], [], max(0, deadline - time.monotonic()))
            require(available and os.read(ready_read, 1) == b'R', 'INVOCATION_WORKER_START')
            process_start, namespaces, actual_exe = proc_identity(child)
            require(actual_exe == exe, 'INVOCATION_ACTUAL_EXECUTABLE')
            # Worker receives exact bytes through the owned pipe, not a callback path.
            envelope = json.dumps({'input': json.loads(raw), 'inputReference': input_reference, 'expectedAuthority': authority}, sort_keys=True, allow_nan=False).encode()
            require(len(envelope) <= MAX_BYTES, 'INVOCATION_INPUT_LIMIT')
            child.stdin.write(envelope)
            child.stdin.close()
            while child.poll() is None:
                require(time.monotonic() < deadline, 'INVOCATION_TIMEOUT')
                require(os.fstat(stdout.fileno()).st_size <= MAX_BYTES and os.fstat(stderr.fileno()).st_size <= MAX_BYTES, 'INVOCATION_OUTPUT_LIMIT')
                try:
                    child.wait(timeout=min(.05, max(.001, deadline - time.monotonic())))
                except subprocess.TimeoutExpired:
                    pass
            code = child.wait()
            stop_join(child)
            ended = time.time()
            require(code == 0, 'INVOCATION_SOURCE_FAILED')
            stdout.seek(0)
            output_raw = stdout.read(MAX_BYTES + 1)
            require(len(output_raw) <= MAX_BYTES, 'INVOCATION_OUTPUT_LIMIT')
            result = json.loads(output_raw)
            require(type(result) is dict and set(result) == {'output', 'inputs'}, 'INVOCATION_WORKER_OUTPUT')
            inputs = result['inputs']
            require(type(inputs) is list and input_reference in inputs, 'INVOCATION_INPUT_CLOSURE')
            for ref in inputs:
                if ref in module_closure.values():
                    require(reference(ref['path'], 0o700) == ref, 'INVOCATION_MODULE_CHANGED')
                else:
                    read_reference(ref)
            require(reference(source, 0o700) == src and reference(executable, 0o755) == exe and read_reference(input_reference) == raw, 'INVOCATION_IDENTITY_CHANGED')
            output = publish(root / 'operation.json', json.dumps(result['output'], sort_keys=True, separators=(',', ':'), allow_nan=False).encode())
            receipt = {'schemaVersion': 2, 'kind': operation, 'binding': binding, 'producerId': producer_id,
                       'source': src, 'executable': actual_exe, 'pid': child.pid, 'processStart': process_start,
                       'startedAt': started, 'endedAt': ended, 'namespaces': namespaces,
                       'providerBindingSha256': binding['providerBindingSha256'], 'inputs': inputs,
                       'output': output, 'exitCode': code, 'ownedChildrenJoined': True}
            receipt_ref = publish(root / 'invocation.json', json.dumps(receipt, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())
            return {'receipt': receipt, 'invocation': receipt_ref, 'output': output}
    finally:
        try:
            if child is not None:
                stop_join(child)
        finally:
            if child is not None and child.stdin is not None and not child.stdin.closed:
                child.stdin.close()
            for fd in descriptors.values():
                os.close(fd)
            os.close(ready_read)
            if ready_write is not None:
                os.close(ready_write)


def owned_worker(operation, ready_fd):
    # All repository imports are resolved by the independently pinned FD finder.
    require(type(globals().get('PINNED_SOURCES')) is dict and set(PINNED_SOURCES) == set(MODULES), 'INVOCATION_FD_CLOSURE_REQUIRED')
    source_path(operation)
    require(os.geteuid() != 0, 'INVOCATION_ROOT_REQUIRES_PROTECTED_AUTHORITY')
    os.write(ready_fd, b'R')
    os.close(ready_fd)
    raw = sys.stdin.buffer.read(MAX_BYTES + 1)
    require(len(raw) <= MAX_BYTES, 'INVOCATION_WORKER_INPUT_LIMIT')
    envelope = json.loads(raw)
    require(type(envelope) is dict and set(envelope) == {'input', 'inputReference', 'expectedAuthority'}, 'INVOCATION_WORKER_ENVELOPE')
    a = envelope['expectedAuthority']
    require(type(a) is dict and set(a) == {'identity', 'isolation', 'release'}, 'INVOCATION_WORKER_AUTHORITY')
    authority = fixture_authority(operation, a['identity'], a['isolation'], a['release'])
    refs = [envelope['inputReference']] + [PINNED_SOURCES[name] for name in MODULES if name != 'source_invocation_receipt']

    def reader(path, digest):
        ref = {'path': path, 'sha256': digest}
        data = read_reference(ref)
        if ref not in refs:
            refs.append(ref)
        return data

    if operation == 'collection':
        from current_held_epoch_evidence_producer import produce
        # Complete raw ciphertext refs are still verified, never replayed.
        output = produce(envelope['input'], expected_identity=authority['identity'], reader=reader,
                         large_reader=lambda ref: [reader(ref['path'], ref['sha256'])])
    elif operation == 'conservation':
        from isolated_conservation_evidence_producer import produce
        output = produce(envelope['input'], reader=reader, expected_identity=authority['identity'], expected_isolation_binding=authority['isolation'], expected_release=authority['release'])
    else:
        raise ValueError('INVOCATION_OPERATION_UNSUPPORTED')
    sys.stdout.buffer.write(json.dumps({'output': output, 'inputs': refs}, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 4 and sys.argv[1] == '--owned-worker', 'INVOCATION_INTERNAL_WORKER_ONLY')
        owned_worker(sys.argv[2], int(sys.argv[3]))
    except Exception:
        print('SOURCE_INVOCATION_REJECTED', file=sys.stderr)
        sys.exit(1)
