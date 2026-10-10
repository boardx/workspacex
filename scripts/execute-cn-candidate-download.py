#!/usr/bin/env python3
"""Root protected, explicit check/download launcher. No upload/publication API.

python3 -I -S -B ENTRY SOURCE ORIGINAL_ATTEMPT APPROVAL_SHA [--download]
The default performs real authenticated checks only. All inputs are root private
and independently approved. No installed dependency or credential is discovered
through environment variables, user site packages or the current directory.
"""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import sys
import sysconfig
import tempfile
import time

OWNER = (0, 0)
PYTHON_SHA = 'e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f'
TOOLS = '/usr/local/lib/workspacex-cn'
INPUTS = '/etc/workspacex-cn/candidate-download'
STATE = '/var/lib/workspacex-cn'
BASE_CODE = frozenset({'execute-cn-candidate-download.py', 'cn_candidate_download_supervisor.py',
    'cn_candidate_sdk_runtime.py', 'cn_candidate_authenticated_oss.py', 'cn_candidate_oss.py',
    'cn_archive_oss.py', 'cn_image_archive.py', 'cn_image_candidate.py',
    'hosted-release.py', 'canonical_control.py', 'cn_candidate_revalidation.py'})


def need(ok, code):
    if not ok:
        raise ValueError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def decode(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            need(key not in value, 'DUPLICATE_JSON_KEY')
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=pairs)


def identity(s):
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns


def directory(path, private=False):
    need(Path(path).is_absolute() and '..' not in Path(path).parts, 'DIRECTORY_PATH')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in (None, *Path(path).parts[1:]):
            if part is not None:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = child
            value = os.fstat(fd)
            need((value.st_uid, value.st_gid) == (0, 0) and not value.st_mode & 0o022,
                 'DIRECTORY_TRUST')
        need(not private or stat.S_IMODE(value.st_mode) == 0o700, 'DIRECTORY_PRIVATE')
        return fd
    except BaseException:
        os.close(fd)
        raise


def read(parent, name, mode=0o600, maximum=1024**2):
    need(re.fullmatch(r'[A-Za-z0-9_.+-]+', name) is not None, 'FILE_NAME')
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and (before.st_uid, before.st_gid) == OWNER
             and before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == mode
             and before.st_size <= maximum, 'FILE_TRUST')
        raw = stream.read(maximum + 1)
        need(len(raw) <= maximum and identity(before) == identity(os.fstat(stream.fileno()))
             == identity(os.stat(name, dir_fd=parent, follow_symlinks=False)), 'FILE_CHANGED')
        return raw


def verify_interpreter():
    need(os.geteuid() == 0 and os.getegid() == 0 and sys.flags.isolated
         and sys.flags.no_site and sys.dont_write_bytecode, 'ROOT_ISOLATED_REQUIRED')
    need(sys.version_info[:3] == (3, 12, 3) and platform.machine() == 'x86_64'
         and sysconfig.get_config_var('SOABI') == 'cpython-312-x86_64-linux-gnu'
         and os.path.realpath(sys.executable) == '/usr/bin/python3.12', 'PYTHON_TARGET')
    fd = directory('/usr/bin')
    try:
        raw = read(fd, 'python3.12', 0o755, 16 * 1024**2)
        need(len(raw) == 8020928 and sha(raw) == PYTHON_SHA, 'PYTHON_HASH')
        # Verify the executable actually mapped by the kernel, not merely its path.
        with open('/proc/self/exe', 'rb') as executable:
            need(sha(executable.read(16 * 1024**2)) == PYTHON_SHA, 'PYTHON_RUNNING_HASH')
    finally:
        os.close(fd)


def admit_approval(raw, expected, source, attempt, operation):
    need(sha(raw) == expected, 'APPROVAL_HASH')
    v = decode(raw)
    fields = {'kind', 'sourceRevision', 'controlRevision', 'attemptId', 'operation', 'issuedAt', 'expiresAt',
              'maxSeconds', 'inputs', 'code', 'sdkManifestSha256'}
    need(type(v) is dict and set(v) == fields and v['kind'] == 'cn-candidate-download-root-v1', 'APPROVAL_FIELDS')
    need(type(v['controlRevision']) is str and re.fullmatch('[a-f0-9]{40}', v['controlRevision']), 'CONTROL_REVISION')
    need(v['sourceRevision'] == source and v['attemptId'] == attempt
         and v['operation'] == operation and operation in ('check', 'download'), 'APPROVAL_IDENTITY')
    start, end = (datetime.fromisoformat(v[k].replace('Z', '+00:00')) for k in ('issuedAt', 'expiresAt'))
    need(start.tzinfo is not None and end.tzinfo is not None
         and 0 < (end-start).total_seconds() <= 3600
         and start <= datetime.now(timezone.utc) < end, 'APPROVAL_EXPIRED')
    need(type(v['maxSeconds']) is int and 1 <= v['maxSeconds'] <= 1200, 'APPROVAL_DEADLINE')
    mandatory = {'request.json', 'candidate-plan.json', 'candidate-set.json'}
    optional = {'candidate-revalidation.json', 'revalidation-policy.json'}
    need(type(v['inputs']) is dict and set(v['inputs']) in (mandatory, mandatory | optional), 'APPROVAL_INPUTS')
    need(type(v['code']) is dict and set(v['code']) == BASE_CODE, 'APPROVAL_CODE')
    hashes = [*v['inputs'].values(), *v['code'].values(), v['sdkManifestSha256']]
    need(all(type(h) is str and re.fullmatch('[a-f0-9]{64}', h) for h in hashes), 'APPROVAL_HASH_FORMAT')
    return v


def run(source, attempt, expected, operation):
    started = time.monotonic()
    verify_interpreter()
    need(re.fullmatch('[a-f0-9]{40}', source) and re.fullmatch('[a-z0-9][a-z0-9-]{0,63}', attempt)
         and re.fullmatch('[a-f0-9]{64}', expected), 'ARGUMENT_FORMAT')
    handles = []
    try:
        inputs = directory(f'{INPUTS}/{source}/{attempt}', private=True); handles.append(inputs)
        tools = directory(TOOLS); handles.append(tools)
        state = directory(STATE, private=True); handles.append(state)
        lock = os.open('release.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=state)
        handles.append(lock)
        ls = os.fstat(lock)
        need(stat.S_ISREG(ls.st_mode) and (ls.st_uid, ls.st_gid) == (0, 0)
             and ls.st_nlink == 1 and not ls.st_mode & 0o077, 'LOCK_TRUST')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(identity(ls) == identity(os.fstat(lock)) == identity(os.stat('release.lock', dir_fd=state, follow_symlinks=False)), 'LOCK_CHANGED')
        approval = admit_approval(read(inputs, 'approval.json'), expected, source, attempt, operation)
        expiry = datetime.fromisoformat(approval['expiresAt'].replace('Z', '+00:00'))
        deadline = min(started + approval['maxSeconds'], time.monotonic() + (expiry - datetime.now(timezone.utc)).total_seconds())
        data = {}
        for name, digest in approval['inputs'].items():
            data[name] = read(inputs, name)
            need(sha(data[name]) == digest, 'INPUT_HASH')
        plan = decode(data['candidate-plan.json'])
        need(plan['sourceRevision'] == source and plan['attemptId'] == attempt, 'PLAN_IDENTITY')
        sdk = directory(f"{TOOLS}/python-oss-runtime/{approval['sdkManifestSha256']}", private=True)
        handles.append(sdk)
        manifest = read(sdk, 'manifest.json')
        need(sha(manifest) == approval['sdkManifestSha256'], 'SDK_MANIFEST_HASH')
        code_fd = directory(f"{TOOLS}/candidate-download-code/{approval['controlRevision']}", private=True)
        handles.append(code_fd)
        code = {}
        for name, digest in approval['code'].items():
            code[name] = read(tools if name == 'execute-cn-candidate-download.py' else code_fd, name, 0o700, 2 * 1024**2)
            need(sha(code[name]) == digest, 'CODE_HASH')
        need(os.path.abspath(__file__) == TOOLS + '/execute-cn-candidate-download.py', 'ENTRY_PATH')
        # All imported code is a private snapshot of admitted raw bytes.
        with tempfile.TemporaryDirectory(prefix='.candidate-check-', dir=STATE) as folder:
            snapshot = Path(folder)
            for name, raw in code.items():
                (snapshot / name).write_bytes(raw)
                (snapshot / name).chmod(0o600)
            runtime = snapshot / 'sdk'; runtime.mkdir(mode=0o700)
            sys.path.insert(0, str(snapshot))
            from cn_candidate_sdk_runtime import extract_wheels
            from cn_candidate_download_supervisor import supervise
            extract_wheels(manifest, lambda name, size: read(sdk, name, maximum=size), runtime)
            destination = f'{STATE}/candidate-inbox/{source}'
            if operation == 'download':
                handles.append(directory(destination, private=True))
            def execute():
                sys.path.insert(0, str(runtime))
                module = importlib.import_module('cn_candidate_authenticated_oss')
                return module.execute_from_ecs(operation, data['request.json'],
                    approval['inputs']['request.json'], data['candidate-plan.json'], data['candidate-set.json'],
                    destination_parent=destination if operation == 'download' else None,
                    destination_name=attempt if operation == 'download' else None,
                    revalidation_raw=data.get('candidate-revalidation.json'),
                    revalidation_policy_raw=data.get('revalidation-policy.json'))
            remaining = int(min(deadline - time.monotonic(), (expiry - datetime.now(timezone.utc)).total_seconds()))
            need(remaining >= 1, 'APPROVAL_EXPIRED')
            return supervise(execute, remaining)
    finally:
        for fd in reversed(handles):
            os.close(fd)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source'); parser.add_argument('attempt'); parser.add_argument('approval_sha256')
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    try:
        result = run(args.source, args.attempt, args.approval_sha256, 'download' if args.download else 'check')
        print(json.dumps(result, sort_keys=True, separators=(',', ':')))
    except Exception:
        print('{"ok":false,"code":"PROTECTED_DOWNLOAD_REJECTED"}')
        sys.exit(1)
