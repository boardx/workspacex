#!/usr/bin/env python3
"""Narrow source import for the existing trusted deployment entrypoint.

Only public Git objects are admitted. This operation never executes candidate
code, changes a main-cn ref/HEAD, writes private inputs, or deploys a service.
"""
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request

SHA = re.compile(r'[a-f0-9]{40}')
ATTEMPT = re.compile(r'gha-[0-9]+-[0-9]+')
REMOTE_REF = 'refs/remotes/origin/main'
REPOSITORY = 'boardx/workspacex'
MAX_BUNDLE = 2 * 1024**3


class Rejected(ValueError):
    pass


def require(value, code):
    if not value:
        raise Rejected(code)


def environment():
    # Do not inherit executable/object/config overrides from the runner.
    return dict(PATH='/usr/sbin:/usr/bin:/sbin:/bin', HOME='/nonexistent',
                GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_SYSTEM='/dev/null',
                GIT_CONFIG_NOSYSTEM='1', GIT_NO_REPLACE_OBJECTS='1',
                GIT_NO_LAZY_FETCH='1', GIT_TERMINAL_PROMPT='0')


def git(path, *args, user=None):
    command = ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
               '-c', 'protocol.ext.allow=never', '-C', str(path), *args]
    if user:
        command = ['runuser', '-u', user, '--', *command]
    result = subprocess.run(command, env=environment(), stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=180, check=False)
    require(result.returncode == 0, 'CN_AUTO_SOURCE_GIT_REJECTED')
    return result.stdout.decode().strip()


def github(path):
    request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + path,
                                     headers={'Accept': 'application/vnd.github+json',
                                              'User-Agent': 'workspacex-cn-source-import'})
    with urllib.request.urlopen(request, timeout=15) as response:
        require(response.status == 200 and response.url.startswith('https://api.github.com/'),
                'CN_AUTO_SOURCE_REMOTE_IDENTITY')
        raw = response.read(2 * 1024**2 + 1)
    require(len(raw) <= 2 * 1024**2, 'CN_AUTO_SOURCE_REMOTE_BOUND')
    return json.loads(raw)


def verify_desired(revision, read=github):
    desired = read('/git/ref/heads/main-cn')['object']['sha']
    main = read('/git/ref/heads/main')['object']['sha']
    require(desired == revision and SHA.fullmatch(main), 'CN_AUTO_STALE_MAIN_CN')
    if main != revision:
        comparison = read('/compare/' + revision + '...' + main)
        require(comparison.get('status') in ('ahead', 'identical') and
                comparison.get('base_commit', {}).get('sha') == revision and
                comparison.get('merge_base_commit', {}).get('sha') == revision,
                'CN_AUTO_SOURCE_NOT_IN_MAIN')


def private_directory(path, uid=0):
    path = Path(path)
    for parent in (path, *path.parents):
        s = parent.lstat()
        require(stat.S_ISDIR(s.st_mode) and not parent.is_symlink() and
                s.st_uid == uid and not s.st_mode & 0o022,
                'CN_AUTO_SOURCE_UNTRUSTED_DIRECTORY')
    require(stat.S_IMODE(path.stat().st_mode) == 0o700,
            'CN_AUTO_SOURCE_PRIVATE_DIRECTORY')


def validate_bundle(path, revision):
    # A single complete ref is the public producer protocol. Prerequisite lines
    # would borrow local objects and cannot establish a self-contained artifact.
    with open(path, 'rb') as stream:
        header = []
        size = 0
        while True:
            line = stream.readline(4097)
            size += len(line)
            require(line and len(line) <= 4096 and size <= 65536,
                    'CN_AUTO_SOURCE_BUNDLE_HEADER')
            if line == b'\n':
                break
            header.append(line.rstrip(b'\n'))
    require(header[0] in (b'# v2 git bundle', b'# v3 git bundle'),
            'CN_AUTO_SOURCE_BUNDLE_VERSION')
    lines = [line for line in header[1:] if not line.startswith(b'@')]
    require(lines == [(revision + ' ' + REMOTE_REF).encode()],
            'CN_AUTO_SOURCE_BUNDLE_REFS')


def copy_input(stream, target, expected):
    before = os.fstat(stream.fileno())
    require(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= MAX_BUNDLE,
            'CN_AUTO_SOURCE_STDIN_REGULAR_REQUIRED')
    digest = hashlib.sha256()
    total = 0
    with open(target, 'xb', opener=lambda p, f: os.open(p, f, 0o600)) as output:
        while chunk := stream.read(1024**2):
            total += len(chunk)
            require(total <= MAX_BUNDLE, 'CN_AUTO_SOURCE_BUNDLE_BOUND')
            digest.update(chunk)
            output.write(chunk)
        output.flush()
        os.fsync(output.fileno())
    after = os.fstat(stream.fileno())
    fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    require(all(getattr(before, key) == getattr(after, key) for key in fields) and
            total == before.st_size and digest.hexdigest() == expected,
            'CN_AUTO_SOURCE_INPUT_CHANGED')


def verify_closure(cache):
    require(not (cache / 'shallow').exists() and
            not (cache / 'objects/info/alternates').exists() and
            not (cache / 'objects/info/http-alternates').exists() and
            not any(cache.rglob('*.promisor')) and
            not any(p.is_symlink() for p in cache.rglob('*')),
            'CN_AUTO_SOURCE_EXTERNAL_OBJECTS')
    require(git(cache, 'rev-parse', '--is-shallow-repository') == 'false',
            'CN_AUTO_SOURCE_SHALLOW')
    git(cache, 'fsck', '--full', '--strict', '--no-reflogs')


def verify_installed(cache, revision):
    # The importer is an installed control capability, never a runner import.
    # A changed control implementation requires its controlled software update.
    for path, mode in [(Path(__file__), 0o755),
                       (Path('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py'), 0o700)]:
        for parent in path.parents:
            s = parent.lstat()
            require(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022,
                    'CN_AUTO_SOURCE_INSTALLED_PARENT')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as stream:
            s = os.fstat(stream.fileno())
            require(stat.S_ISREG(s.st_mode) and s.st_uid == s.st_gid == 0 and
                    stat.S_IMODE(s.st_mode) == mode and s.st_nlink == 1,
                    'CN_AUTO_SOURCE_INSTALLED_TRUST')
            installed = stream.read(MAX_BUNDLE)
        command = ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
                   '-C', str(cache), 'show', revision + ':.harness/scripts/vm/' + path.name]
        result = subprocess.run(command, env=environment(), stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=30, check=False)
        require(result.returncode == 0 and result.stdout == installed,
                'CN_AUTO_SOURCE_INSTALLED_DRIFT')


def maintenance_admission(runtime):
    # Reuse the canonical strict record parser and hold.lock. Its installed
    # identity gate pins the exact protected helper before any library operation.
    path = Path('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py')
    spec = importlib.util.spec_from_file_location('cn_source_canonical_hold', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        module.require_installed_identity()
        module.HoldStore(str(runtime)).admit_ordinary_release()
    except BaseException:
        raise Rejected('CN_AUTO_SOURCE_MAINTENANCE_HOLD') from None


def import_objects(cache, bundle, revision, old, user=None):
    # FETCH_HEAD is not an authority and is not written. Ref advancement is CAS.
    git(cache, 'fetch', '--no-tags', '--no-write-fetch-head', str(bundle), REMOTE_REF, user=user)
    require(git(cache, 'cat-file', '-t', revision, user=user) == 'commit',
            'CN_AUTO_SOURCE_COMMIT_REQUIRED')
    git(cache, 'merge-base', '--is-ancestor', old, revision, user=user)
    git(cache, 'update-ref', 'refs/heads/main', revision, old, user=user)


@contextlib.contextmanager
def canonical_lock(runtime):
    private_directory(runtime)
    lock = runtime / 'release.lock'
    fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        require(stat.S_ISREG(s.st_mode) and s.st_uid == s.st_gid == 0 and
                stat.S_IMODE(s.st_mode) == 0o600 and s.st_nlink == 1,
                'CN_AUTO_SOURCE_LOCK_TRUST')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        named = lock.lstat()
        require((s.st_dev, s.st_ino) == (named.st_dev, named.st_ino),
                'CN_AUTO_SOURCE_LOCK_CHANGED')
        yield
    finally:
        os.close(fd)


def main(args):
    require(os.geteuid() == os.getegid() == 0 and sys.platform == 'linux',
            'CN_AUTO_SOURCE_ROOT_LINUX_REQUIRED')
    require(len(args) == 3 and SHA.fullmatch(args[0]) and ATTEMPT.fullmatch(args[1]) and
            re.fullmatch('[a-f0-9]{64}', args[2]), 'CN_AUTO_SOURCE_ARGUMENTS')
    revision, attempt, expected = args
    runtime = Path('/var/lib/workspacex-cn/runtime')
    root_cache = Path('/var/lib/workspacex-cn/source-cache.git')
    runner_cache = Path('/opt/workspacex-cn/release-origin-cache.git')
    repository = Path('/opt/workspacex-cn/repository')
    user = 'ghrunner'
    pwd.getpwnam(user)
    private_directory(runtime)
    verify_desired(revision)
    stage = Path(tempfile.mkdtemp(prefix='.auto-source-', dir=runtime))
    exchange = None
    try:
        bundle = stage / 'source.bundle'
        copy_input(sys.stdin.buffer, bundle, expected)
        validate_bundle(bundle, revision)
        cache = stage / 'verified.git'
        git(stage, 'init', '--bare', str(cache))
        git(cache, 'bundle', 'verify', str(bundle))
        git(cache, 'fetch', '--no-tags', str(bundle), REMOTE_REF + ':refs/heads/main')
        require(git(cache, 'rev-parse', 'refs/heads/main') == revision,
                'CN_AUTO_SOURCE_REVISION')
        verify_closure(cache)
        verify_installed(cache, revision)
        # Runner receives only already verified public Git objects, in a
        # root-owned read-only exchange; it never reads private runtime state.
        exchange = Path(tempfile.mkdtemp(prefix='workspacex-cn-auto-source-', dir='/run'))
        public_bundle = exchange / 'source.bundle'
        shutil.copyfile(bundle, public_bundle)
        os.chmod(public_bundle, 0o444)
        os.chmod(exchange, 0o755)
        with canonical_lock(runtime):
            maintenance_admission(runtime)
            verify_desired(revision)
            private_directory(root_cache)
            verify_closure(root_cache)
            baseline = git(runner_cache, 'rev-parse', 'refs/heads/main-cn', user=user)
            root_baseline = git(root_cache, 'rev-parse', 'refs/heads/main-cn')
            require(SHA.fullmatch(baseline) and
                    git(repository, 'remote', 'get-url', 'origin', user=user) == str(runner_cache) and
                    git(repository, 'rev-parse', 'refs/remotes/origin/main-cn', user=user) == baseline,
                    'CN_AUTO_SOURCE_ACCEPTED_REF_DRIFT')
            git(cache, 'merge-base', '--is-ancestor', baseline, revision)
            before_head = git(repository, 'rev-parse', 'HEAD', user=user)
            old_root = git(root_cache, 'rev-parse', 'refs/heads/main')
            old_runner = git(runner_cache, 'rev-parse', 'refs/heads/main', user=user)
            import_objects(root_cache, bundle, revision, old_root)
            import_objects(runner_cache, public_bundle, revision, old_runner, user=user)
            git(repository, 'fetch', '--no-tags', str(runner_cache),
                'refs/heads/main:refs/remotes/origin/main', user=user)
            require(git(repository, 'rev-parse', 'HEAD', user=user) == before_head and
                    git(repository, 'rev-parse', 'refs/remotes/origin/main-cn', user=user) == baseline and
                    git(runner_cache, 'rev-parse', 'refs/heads/main-cn', user=user) == baseline and
                    git(root_cache, 'rev-parse', 'refs/heads/main-cn') == root_baseline,
                    'CN_AUTO_SOURCE_ACCEPTED_REF_CHANGED')
        print(json.dumps(dict(schemaVersion=1, sourceRevision=revision, attemptId=attempt,
                              acceptedRef=baseline, bundleSha256=expected,
                              sourceImported=True, productionActivated=False)))
    finally:
        if exchange is not None:
            shutil.rmtree(exchange)
        shutil.rmtree(stage)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except BaseException as error:
        code = str(error) if isinstance(error, Rejected) else 'CN_AUTO_SOURCE_IMPORT_FAILED'
        print(code, file=sys.stderr)
        sys.exit(1)
