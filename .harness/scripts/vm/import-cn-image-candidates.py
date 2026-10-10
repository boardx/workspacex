#!/usr/bin/env python3
"""Candidate-v2 explicit root entry. No installation or transport fallback.

python3 -I -S -B <entry> --check-plan|--publish SOURCE ATTEMPT APPROVAL_SHA
"""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import tempfile
import time

class Rejected(ValueError):
    pass

def need(value, code):
    if not value:
        raise Rejected(code)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def protected(path, maximum, expected=None, mode=None):
    """No symlinks at any level; fd pins each directory and the regular file."""
    path = Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'PROTECTED_PATH_INVALID')
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in path.parts[1:-1]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory); directory = child
            s = os.fstat(directory)
            need(s.st_uid == 0 and s.st_gid == 0 and not s.st_mode & 0o022, 'PROTECTED_PARENT_TRUST')
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno())
            need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_gid == 0
                 and before.st_nlink == 1 and not before.st_mode & 0o022 and before.st_size <= maximum, 'PROTECTED_FILE_TRUST')
            if mode is not None:
                need(stat.S_IMODE(before.st_mode) == mode, 'PROTECTED_FILE_MODE')
            raw = stream.read(maximum + 1)
            after = os.fstat(stream.fileno()); named = os.stat(path.name, dir_fd=directory, follow_symlinks=False)
            identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
            need(len(raw) <= maximum and identity(before) == identity(after) == identity(named), 'PROTECTED_FILE_CHANGED')
            if expected is not None:
                need(digest(raw) == expected, 'PROTECTED_FILE_HASH')
            return raw
    finally:
        os.close(directory)



TOOLS = Path('/usr/local/lib/workspacex-cn')
CLOSURE = frozenset(('import-cn-image-candidates.py', 'import-cn-image-archives.py',
    'cn_candidate_host.py', 'cn_candidate_publication.py', 'cn_image_candidate.py',
    'cn_image_archive.py', 'hosted-release.py', 'canonical_control.py'))

def decode(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs)

def main():
    argv = sys.argv[1:]
    need(len(argv) == 4 and argv[0] in ('--check-plan', '--publish'), 'EXPLICIT_OPERATION_REQUIRED')
    operation, source, attempt, expected = argv
    need(os.geteuid() == 0 and os.getegid() == 0 and sys.flags.isolated
         and sys.flags.no_site and sys.dont_write_bytecode, 'ISOLATED_ROOT_REQUIRED')
    need(re.fullmatch('[a-f0-9]{40}', source) and re.fullmatch('[a-z0-9][a-z0-9-]{0,63}', attempt)
         and re.fullmatch('[a-f0-9]{64}', expected), 'INVOCATION_IDENTITY')
    started = time.monotonic()
    def expired(*_):
        raise Rejected('PUBLISH_DEADLINE')
    signal.signal(signal.SIGALRM, expired)
    signal.signal(signal.SIGTERM, expired)
    signal.alarm(1200)
    directory = Path('/etc/workspacex-cn/candidate-publish') / source / attempt
    raw = protected(directory / 'approval.json', 256 * 1024, expected, 0o600)
    approval = decode(raw)
    need(type(approval) is dict, 'APPROVAL_FIELDS')
    hashes = approval.get('installedToolSha256')
    need(type(hashes) is dict and set(hashes) == CLOSURE
         and all(isinstance(x, str) and re.fullmatch('[a-f0-9]{64}', x) for x in hashes.values()),
         'INSTALLED_CLOSURE_REQUIRED')
    need(Path(__file__) == TOOLS / 'import-cn-image-candidates.py', 'ENTRY_LOCATION')
    protected(Path(__file__), 1024**2, hashes['import-cn-image-candidates.py'], 0o700)
    # Materialize only verified bytes into a root-private snapshot. Dynamic
    # sibling imports in candidate/hosted-release cannot resolve unverified code.
    temp_root = Path('/var/tmp')
    st = os.lstat(temp_root)
    need(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and st.st_gid == 0
         and (not st.st_mode & 0o022 or st.st_mode & stat.S_ISVTX), 'TEMP_ROOT_TRUST')
    tempfile.tempdir = str(temp_root)
    with tempfile.TemporaryDirectory(prefix='wsx-candidate-tools-', dir=temp_root) as temporary:
        snapshot = Path(temporary)
        for name in sorted(CLOSURE):
            content = protected(TOOLS / name, 1024**2, hashes[name], 0o700)
            target = snapshot / name
            target.write_bytes(content)
            target.chmod(0o700)
        sys.path.insert(0, str(snapshot))
        import cn_candidate_host
        return cn_candidate_host.run(operation, source, attempt, approval,
                                     expected, directory, started)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Never echo provider responses, arbitrary exception strings or paths.
        print('CN_CANDIDATE_PUBLISH_REJECTED=LOCAL_INPUT_OR_OPERATION_REJECTED', file=sys.stderr)
        sys.exit(1)
