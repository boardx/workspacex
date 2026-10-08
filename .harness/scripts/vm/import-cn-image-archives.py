#!/usr/bin/env python3
"""Explicit, approval-bound image publication only. No build/prepare/activation.

Invocation: python3 -I -S -B <installed entry> --check-plan|--publish SHA ATTEMPT PLAN_SHA256
The plan/inbox/installed helpers must be staged by a separately approved operator.
No workflow invokes this entry and it has no upload/download/installation fallback.
"""
from contextlib import contextmanager, ExitStack
from datetime import datetime, timezone
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

TOOLS = Path('/usr/local/lib/workspacex-cn')
ALIYUN = '/usr/local/lib/workspacex-diagnostics-aliyun-3.0.277/aliyun'
ALIYUN_SHA = 'f8726dbe5a88c45e0745e308ba23234d928519b9cb33c96a4bff0bbee1c85c05'
ROLE = 'WorkspacexCnProductionEcsRole'
ACCOUNT = '1177216024653153'
RUNTIME = Path('/var/lib/workspacex-cn/runtime')


class Rejected(ValueError):
    pass


def need(v, code):
    if not v:
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


@contextmanager
def protected_stream(path, maximum):
    path = Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'PROTECTED_PATH_INVALID')
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in path.parts[1:-1]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory); directory = child
            st = os.fstat(directory)
            need(st.st_uid == 0 and st.st_gid == 0 and not st.st_mode & 0o022, 'PROTECTED_PARENT_TRUST')
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno())
            need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_gid == 0 and before.st_nlink == 1
                 and stat.S_IMODE(before.st_mode) == 0o600 and 0 < before.st_size <= maximum, 'INBOX_ARCHIVE_TRUST')
            yield stream
            identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
            need(identity(before) == identity(os.fstat(stream.fileno())) == identity(os.stat(path.name, dir_fd=directory, follow_symlinks=False)), 'PROTECTED_FILE_CHANGED')
    finally:
        os.close(directory)


def load_helper(file, expected):
    need(isinstance(expected, str) and re.fullmatch('[a-f0-9]{64}', expected), 'HELPER_HASH_REQUIRED')
    raw = protected(TOOLS / file, 1024**2, expected, 0o700)
    # Execute exactly the verified bytes, not a second path lookup.
    module = type(sys)(file.replace('.', '_'))
    module.__file__ = str(TOOLS / file)
    exec(compile(raw, module.__file__, 'exec'), module.__dict__)
    return module


def validate_approval(plan, c, source, attempt, now=None):
    fields = {'schemaVersion', 'buildPlan', 'archiveSetSha256', 'issuedAt', 'expiresAt', 'publishAuthorized',
              'accountId', 'ecsInstanceId', 'region', 'instanceId', 'registryPrefix', 'immutableRepositories', 'immutableEvidence',
              'transport', 'installedToolSha256', 'canonicalConfigurationSha256', 'binaries', 'maxPublishSeconds'}
    need(type(plan) is dict and set(plan) == fields and type(plan['schemaVersion']) is int and plan['schemaVersion'] == 1, 'APPROVAL_FIELDS')
    c.validate_plan(plan['buildPlan'])
    need(plan['buildPlan']['sourceRevision'] == source and plan['buildPlan']['attemptId'] == attempt, 'APPROVAL_IDENTITY')
    need(plan['publishAuthorized'] is True, 'PUBLISH_NOT_AUTHORIZED')
    need(plan['accountId'] == ACCOUNT and plan['ecsInstanceId'] == 'i-uf6ga92ewloganobbln6'
         and plan['region'] == 'cn-shanghai' and plan['instanceId'] == c.INSTANCE and plan['registryPrefix'] == c.PREFIX, 'APPROVAL_TARGET')
    need(type(plan['immutableRepositories']) is list and len(plan['immutableRepositories']) == 5
         and set(plan['immutableRepositories']) == set(c.REPOSITORIES.values()), 'ALL_REPOSITORY_IMMUTABILITY_REQUIRED')
    evidence = plan['immutableEvidence']
    need(type(evidence) is dict and set(evidence) == {'observedAt', 'accountId', 'instanceId', 'region', 'namespace', 'repositories', 'providerResponseSha256'}, 'IMMUTABILITY_EVIDENCE_REQUIRED')
    need(evidence['accountId'] == ACCOUNT and evidence['instanceId'] == c.INSTANCE and evidence['region'] == 'cn-shanghai'
         and evidence['namespace'] == 'workspacex-prod' and c.hex_string(evidence['providerResponseSha256'], 64), 'IMMUTABILITY_TARGET')
    need(type(evidence['repositories']) is dict and set(evidence['repositories']) == set(c.REPOSITORIES.values()), 'IMMUTABILITY_REPOSITORY_SET')
    for item in evidence['repositories'].values():
        need(type(item) is dict and set(item) == {'repositoryId', 'immutable'} and item['immutable'] is True
             and isinstance(item['repositoryId'], str) and re.fullmatch('crr-[a-z0-9]+', item['repositoryId']), 'IMMUTABILITY_NOT_PROVEN')
    clock = now or datetime.now(timezone.utc)
    need(0 <= (clock-c.timestamp(evidence['observedAt'])).total_seconds() <= 3600, 'IMMUTABILITY_EVIDENCE_EXPIRED')
    need(type(plan['maxPublishSeconds']) is int and 30 <= plan['maxPublishSeconds'] <= 1200, 'PUBLISH_DEADLINE_INVALID')
    issued = c.timestamp(plan['issuedAt']); expiry = c.timestamp(plan['expiresAt']); clock = now or datetime.now(timezone.utc)
    need(0 < (expiry-issued).total_seconds() <= 3600 and issued <= clock < expiry, 'APPROVAL_EXPIRED')
    need(c.hex_string(plan['archiveSetSha256'], 64) and c.hex_string(plan['canonicalConfigurationSha256'], 64), 'APPROVAL_HASH_REQUIRED')
    tools = plan['installedToolSha256']
    need(type(tools) is dict and set(tools) == {'import-cn-image-archives.py', 'cn_image_archive.py', 'canonical_control.py'}
         and all(c.hex_string(x, 64) for x in tools.values()), 'INSTALLED_CLOSURE_REQUIRED')
    binaries = plan['binaries']
    need(type(binaries) is dict and set(binaries) == {'docker', 'buildx', 'aliyun'}, 'BINARY_SET_REQUIRED')
    for key in binaries:
        need(type(binaries[key]) is dict and set(binaries[key]) == {'path', 'sha256'} and c.hex_string(binaries[key]['sha256'], 64), 'BINARY_HASH_REQUIRED')
    need(binaries['docker']['path'] == '/usr/bin/docker', 'DOCKER_PATH_INVALID')
    need(binaries['buildx']['path'] in ('/usr/libexec/docker/cli-plugins/docker-buildx', '/usr/lib/docker/cli-plugins/docker-buildx'), 'BUILDX_PATH_INVALID')
    need(binaries['aliyun'] == {'path': ALIYUN, 'sha256': ALIYUN_SHA}, 'ALIYUN_IDENTITY_INVALID')


@contextmanager
def release_lock():
    protected(RUNTIME / 'release.lock', 4096, mode=0o600)
    fd = os.open(RUNTIME / 'release.lock', os.O_RDWR | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd); named = os.lstat(RUNTIME / 'release.lock')
        need((s.st_dev, s.st_ino) == (named.st_dev, named.st_ino), 'LOCK_CHANGED')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Rejected('RELEASE_LOCK_BUSY') from None
        yield
    finally:
        os.close(fd)


def image_matches(image, entry, build, c):
    need(type(image) is dict and image.get('Id') == entry['imageId'], 'LOCAL_IMAGE_ID_MISMATCH')
    need(image.get('Os') == 'linux' and image.get('Architecture') == 'amd64', 'LOCAL_IMAGE_PLATFORM_MISMATCH')
    labels = image.get('Config', {}).get('Labels') or {}
    need(labels.get('org.opencontainers.image.revision') == build['sourceRevision']
         and labels.get('org.workspacex.archive-build-identity') == c.build_identity(build), 'LOCAL_IMAGE_LABEL_MISMATCH')


def publish_images(plan, archive_set, bundle, adapter, c):
    """Testable sequence. Adapter is the only credential/Docker/write boundary."""
    build = plan['buildPlan']; owned = []
    try:
        # Detect all local tag collisions before loading even the first archive.
        for service, entry in archive_set['images'].items():
            tag = entry['stagingTag']; existing = adapter.local(tag)
            if existing is not None:
                image_matches(existing, entry, build, c)
            target = c.PREFIX + '/' + c.REPOSITORIES[service] + ':' + build['sourceRevision']
            existing = adapter.local(target)
            if existing is not None:
                image_matches(existing, entry, build, c)
        adapter.protect_running_targets(archive_set, build)
        adapter.authenticate()
        # Probe every target before any image-store mutation or registry push.
        for service, entry in archive_set['images'].items():
            target = c.PREFIX + '/' + c.REPOSITORIES[service] + ':' + build['sourceRevision']
            remote_id = adapter.remote_config_id(target)
            need(remote_id is None or remote_id == entry['imageId'], 'REMOTE_IMAGE_ID_MISMATCH')
        results = {}
        for service, entry in archive_set['images'].items():
            tag = entry['stagingTag']; target = c.PREFIX + '/' + c.REPOSITORIES[service] + ':' + build['sourceRevision']
            remote = adapter.pull_optional(target)
            if remote is None:
                if adapter.local(tag) is None:
                    # Register ownership before load: a failed load can still commit a tag.
                    owned.append((tag, entry))
                    adapter.load(Path(bundle) / entry['file'])
                image_matches(adapter.local(tag), entry, build, c)
                adapter.tag(tag, target)
                pushed = adapter.push(target)
                # Verify after both success and lost acknowledgement. Never blindly retry.
                remote = adapter.pull_optional(target)
                need(remote is not None, 'REGISTRY_PUSH_UNCONFIRMED' if not pushed else 'REGISTRY_READBACK_MISSING')
            image_matches(remote, entry, build, c)
            results[service] = adapter.registry_digest(target, remote)
        redis = build['baseImages']['redis']
        adapter.pull_required(redis)
        results['redis'] = adapter.registry_digest(redis, adapter.local(redis))
        value = {k: build[k] for k in ('release', 'sourceRevision', 'platform')}
        value.update(schemaVersion=1, images={key: {'image': results[key]} for key in ('web', 'api', 'agent', 'sandbox', 'postgres', 'redis')})
        # Original TypeScript generator/validator/sealer, not a Python imitation.
        return adapter.canonical_publish(value)
    finally:
        for tag, entry in reversed(owned):
            # Only references introduced here; never rmi an image ID or prune shared layers.
            adapter.remove_owned_tag(tag, entry['imageId'])


class Commands:
    def __init__(self, plan, c, canonical, canonical_path, work):
        self.plan = plan; self.c = c; self.canonical = canonical; self.canonical_path = canonical_path
        self.work = Path(work); self.docker = plan['binaries']['docker']['path']
        self.env = {'PATH': '/usr/bin:/bin', 'HOME': str(self.work), 'LANG': 'C',
                    'DOCKER_CONFIG': str(self.work / 'docker'), 'ALIBABA_CLOUD_IGNORE_PROFILE': 'TRUE'}
        (self.work / 'docker' / 'cli-plugins').mkdir(parents=True, mode=0o700)
        plugin = protected(plan['binaries']['buildx']['path'], 128 * 1024**2, plan['binaries']['buildx']['sha256'], 0o755)
        plugin_path = self.work / 'docker' / 'cli-plugins' / 'docker-buildx'
        plugin_path.write_bytes(plugin); plugin_path.chmod(0o700)

    def command(self, argv, stdin=None, accepted=()):
        p = subprocess.Popen(argv, env=self.env, cwd='/', stdin=stdin or subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        buffers = {}; selector = selectors.DefaultSelector(); deadline = time.monotonic() + 300
        try:
            for stream in (p.stdout, p.stderr):
                selector.register(stream, selectors.EVENT_READ); buffers[stream] = bytearray()
            while selector.get_map():
                need(time.monotonic() < deadline, 'COMMAND_TIMEOUT')
                for key, _ in selector.select(.2):
                    data = os.read(key.fileobj.fileno(), 8192)
                    if not data:
                        selector.unregister(key.fileobj); continue
                    need(len(buffers[key.fileobj]) + len(data) <= 1024**2, 'COMMAND_OUTPUT_LIMIT')
                    buffers[key.fileobj].extend(data)
            code = p.wait(timeout=1); stdout = bytes(buffers[p.stdout]); stderr = bytes(buffers[p.stderr])
            if code != 0:
                need(any(re.search(pattern, stderr, re.I) for pattern in accepted), 'COMMAND_FAILED')
                return None
            return stdout
        finally:
            if p.poll() is None:
                os.killpg(p.pid, signal.SIGKILL)
            p.wait(); selector.close(); p.stdout.close(); p.stderr.close()

    def local(self, image):
        raw = self.command([self.docker, 'image', 'inspect', image], accepted=(rb'No such image',))
        if raw is None:
            return None
        value = self.c.decode(raw); need(type(value) is list and len(value) == 1, 'DOCKER_INSPECT_SHAPE')
        return value[0]

    def authenticate(self):
        common = ['--region', 'cn-shanghai', '--mode', 'EcsRamRole', '--ram-role-name', ROLE,
                  '--read-timeout', '4', '--connect-timeout', '2', '--retry-count', '0']
        caller = self.c.decode(self.command([ALIYUN, 'sts', 'GetCallerIdentity', *common]))
        need(caller.get('AccountId') == ACCOUNT, 'ACCOUNT_MISMATCH')
        token = self.c.decode(self.command([ALIYUN, 'cr', 'GetAuthorizationToken', '--InstanceId', self.c.INSTANCE, *common]))
        username = token.get('TempUsername'); password = token.get('AuthorizationToken'); expires = token.get('ExpireTime')
        need(isinstance(username, str) and 0 < len(username) <= 256 and isinstance(password, str) and 0 < len(password.encode()) <= 4096
             and not any(ord(x) < 32 for x in username + password), 'ACR_TOKEN_SHAPE')
        need(type(expires) is int and expires > (time.time() + self.plan['maxPublishSeconds'] + 60) * 1000, 'ACR_TOKEN_EXPIRY')
        # Anonymous pipe, never argv/environment/persistent credentials or command output.
        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, password.encode()); os.close(write_fd); write_fd = None
            with os.fdopen(read_fd, 'rb') as stream:
                read_fd = None
                self.command([self.docker, 'login', self.c.HOST, '--username', username, '--password-stdin'], stdin=stream)
        finally:
            if read_fd is not None: os.close(read_fd)
            if write_fd is not None: os.close(write_fd)

    def protect_running_targets(self, archive_set, build):
        forbidden = {entry['stagingTag'] for entry in archive_set['images'].values()}
        forbidden.update(self.c.PREFIX + '/' + repository + ':' + build['sourceRevision'] for repository in self.c.REPOSITORIES.values())
        raw = self.command([self.docker, 'ps', '--no-trunc', '--format', '{{json .}}'])
        for line in raw.splitlines():
            value = self.c.decode(line)
            need(value.get('Image') not in forbidden, 'RUNNING_CONTAINER_TARGET_COLLISION')

    def remote_config_id(self, target):
        raw = self.command([self.docker, 'buildx', 'imagetools', 'inspect', '--raw', target],
                           accepted=(rb'manifest unknown', rb'MANIFEST_UNKNOWN', rb'no such manifest'))
        if raw is None:
            return None
        value = self.c.decode(raw)
        need(value.get('schemaVersion') == 2 and value.get('mediaType') in
             ('application/vnd.docker.distribution.manifest.v2+json', 'application/vnd.oci.image.manifest.v1+json'), 'REMOTE_SINGLE_PLATFORM_REQUIRED')
        config = value.get('config', {}).get('digest')
        need(isinstance(config, str) and re.fullmatch('sha256:[a-f0-9]{64}', config), 'REMOTE_CONFIG_DIGEST_REQUIRED')
        return config

    def pull_optional(self, image):
        result = self.command([self.docker, 'pull', '--platform', 'linux/amd64', image],
                              accepted=(rb'manifest unknown', rb'MANIFEST_UNKNOWN', rb'no such manifest'))
        return None if result is None else self.local(image)

    def pull_required(self, image):
        self.command([self.docker, 'pull', '--platform', 'linux/amd64', image])

    def load(self, archive):
        with open(archive, 'rb') as stream:
            self.command([self.docker, 'image', 'load'], stdin=stream)

    def tag(self, source, target):
        self.command([self.docker, 'image', 'tag', source, target])

    def push(self, target):
        # All nonzero pushes need independent exact readback, not an automatic second push.
        try:
            self.command([self.docker, 'push', target])
            return True
        except Rejected as error:
            if str(error) != 'COMMAND_FAILED': raise
            return False

    def registry_digest(self, target, image):
        need(type(image) is dict and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64', 'READBACK_PLATFORM')
        repository = target.split('@')[0] if '@' in target else target.rsplit(':', 1)[0]
        digests = image.get('RepoDigests')
        need(type(digests) is list, 'REGISTRY_DIGEST_MISSING')
        matches = {x for x in digests if isinstance(x, str) and re.fullmatch(re.escape(repository) + '@sha256:[a-f0-9]{64}', x)}
        need(len(matches) == 1, 'REGISTRY_DIGEST_AMBIGUOUS')
        reference = next(iter(matches))
        need('@' not in target or reference == target, 'REGISTRY_DIGEST_MISMATCH')
        raw = self.command([self.docker, 'buildx', 'imagetools', 'inspect', reference])
        match = re.search(rb'^Digest:\s+(sha256:[a-f0-9]{64})\s*$', raw, re.M)
        need(match and match[1].decode() == reference.split('@')[1], 'REGISTRY_REMOTE_DIGEST_MISMATCH')
        return reference

    def remove_owned_tag(self, tag, image_id):
        try:
            image = self.local(tag)
            if image and image.get('Id') == image_id:
                self.command([self.docker, 'image', 'rm', '--no-prune', tag])
        except Exception:
            # Do not mask the original failure or prune/kill shared resources.
            raise Rejected('OWNED_TAG_CLEANUP_UNCERTAIN') from None

    def canonical_publish(self, build_input):
        input_path = self.work / 'build-input.json'; input_path.write_bytes(self.c.json_bytes(build_input))
        manifest = self.work / 'release.json'; seal = self.work / 'release.sealed.json'
        with self.canonical.canonical_snapshot(self.canonical_path, self.plan['canonicalConfigurationSha256']) as snapshot:
            node = snapshot['nodeExecutable']; checkout = snapshot['directory']
            self.command([node, '--import', str(Path(checkout) / 'node_modules/tsx/dist/loader.mjs'),
                          str(Path(checkout) / 'packages/cloud-deploy/src/release-manifest-cli.ts'), str(input_path), str(manifest)])
            self.command([node, '--import', str(Path(checkout) / 'node_modules/tsx/dist/loader.mjs'),
                          str(Path(checkout) / 'packages/cloud-deploy/src/release-candidate-cli.ts'), 'seal', str(manifest), str(seal)])
            self.command([node, '--import', str(Path(checkout) / 'node_modules/tsx/dist/loader.mjs'),
                          str(Path(checkout) / 'packages/cloud-deploy/src/release-candidate-cli.ts'), 'validate', str(manifest), str(seal), build_input['sourceRevision']])
        # Artifact-only result, not prepared receipts or canonical activation pointers.
        output = Path('/var/lib/workspacex-cn/archive-published') / build_input['sourceRevision'] / self.plan['buildPlan']['attemptId']
        need(not output.exists(), 'PUBLISHED_RECEIPT_ALREADY_EXISTS')
        output.mkdir(parents=True, mode=0o700)
        for name, source in (('release.json', manifest), ('release.sealed.json', seal)):
            with (output / name).open('xb') as stream:
                stream.write(source.read_bytes())
            (output / name).chmod(0o600)
        receipt = dict(schemaVersion=1, receiptKind='cn-archive-published-v1', sourceRevision=build_input['sourceRevision'],
                       archiveSetSha256=self.plan['archiveSetSha256'], manifestSha256=digest(manifest.read_bytes()),
                       sealSha256=digest(seal.read_bytes()), registryPrefix=self.c.PREFIX, ready=False, prepared=False, productionActivated=False)
        with (output / 'published.json').open('xb') as stream:
            stream.write(self.c.json_bytes(receipt))
        return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=('--check-plan', '--publish'))
    parser.add_argument('source'); parser.add_argument('attempt'); parser.add_argument('plan_sha256')
    # Leading -- operation is intentional and must never become an implicit default.
    argv = sys.argv[1:]; need(len(argv) == 4 and argv[0] in ('--check-plan', '--publish'), 'EXPLICIT_OPERATION_REQUIRED')
    operation, source, attempt, expected = argv
    # Review checkpoint: publication stays disabled until all independent blockers
    # and the real canonical Node closure fixture have been resolved in code.
    need(operation != '--publish', 'ARCHIVE_BRIDGE_REVIEW_INCOMPLETE')
    need(os.geteuid() == 0 and os.getegid() == 0 and sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode, 'ISOLATED_ROOT_REQUIRED')
    need(re.fullmatch('[a-f0-9]{40}', source) and re.fullmatch('[a-z0-9][a-z0-9-]{0,63}', attempt)
         and re.fullmatch('[a-f0-9]{64}', expected), 'INVOCATION_IDENTITY')
    directory = Path('/etc/workspacex-cn/archive-publish') / source / attempt
    raw = protected(directory / 'plan.json', 256 * 1024, expected, 0o600)
    def pairs(items):
        value = {}
        for key, item in items:
            need(key not in value, 'DUPLICATE_JSON_KEY'); value[key] = item
        return value
    plan = json.loads(raw, object_pairs_hook=pairs)
    need(type(plan) is dict, 'APPROVAL_FIELDS')
    tools = plan.get('installedToolSha256', {})
    need(digest(protected(Path(__file__), 1024**2, mode=0o700)) == tools.get('import-cn-image-archives.py'), 'ENTRY_HASH_MISMATCH')
    c = load_helper('cn_image_archive.py', tools.get('cn_image_archive.py'))
    validate_approval(plan, c, source, attempt)
    canonical = load_helper('canonical_control.py', tools['canonical_control.py'])
    canonical_path = directory / 'canonical-control.json'
    config = c.decode(protected(canonical_path, 256 * 1024, plan['canonicalConfigurationSha256'], 0o600))
    need(config.get('checkoutDirectory') == str(directory / 'canonical-source') and config.get('nodeExecutable') == str(directory / 'node'), 'CANONICAL_LOCATION_BOUNDARY')
    protected(config['nodeExecutable'], 128 * 1024**2, config.get('nodeSha256'), 0o700)
    for relative, expected_file in config.get('fileSha256', {}).items():
        c.safe_name(relative)
        protected(Path(config['checkoutDirectory']) / relative, 64 * 1024**2, expected_file)
    for binary in plan['binaries'].values():
        protected(binary['path'], 256 * 1024**2, binary['sha256'], 0o755)
    inbox = Path('/var/lib/workspacex-cn/archive-inbox') / source / attempt
    manifest_raw = protected(inbox / 'archive-set.json', 256 * 1024, plan['archiveSetSha256'], 0o600)
    archive_set = c.decode(manifest_raw)
    c.validate_transport(plan['transport'], archive_set, plan['archiveSetSha256'])
    def deadline(signum, frame):
        raise Rejected('PUBLISH_DEADLINE')
    signal.signal(signal.SIGALRM, deadline); signal.signal(signal.SIGTERM, deadline)
    signal.alarm(plan['maxPublishSeconds'])
    # Keep all original files pinned; validation/check mode creates no temporary files.
    with ExitStack() as pinned:
        streams = {service: pinned.enter_context(protected_stream(inbox / (service + '.tar'), plan['buildPlan']['maxArchiveBytes'])) for service in c.REPOSITORIES}
        paths = {service: Path('/proc/self/fd') / str(stream.fileno()) for service, stream in streams.items()}
        archive_set, total = c.validate_set(inbox, manifest_raw, plan['archiveSetSha256'], plan['buildPlan'], pinned_paths=paths)
        if operation == '--check-plan':
            print('CN_ARCHIVE_PLAN_VALIDATED sideEffects=false'); return
        need(shutil.disk_usage(tempfile.gettempdir()).free >= total * 4 + plan['buildPlan']['storageMarginBytes'], 'SPOOL_CAPACITY')
        need(shutil.disk_usage('/var/lib/docker').free >= total * 4 + plan['buildPlan']['storageMarginBytes'], 'DOCKER_CAPACITY')
        work_context = pinned.enter_context(tempfile.TemporaryDirectory(prefix='wsx-archive-publish-'))
        work = work_context
        bundle = Path(work) / 'archives'; bundle.mkdir(mode=0o700)
        for service, stream in streams.items():
            stream.seek(0)
            with (bundle / (service + '.tar')).open('xb') as target:
                shutil.copyfileobj(stream, target, 1024**2)
        # Repeat against the private snapshots before Docker consumes them.
        archive_set, total = c.validate_set(bundle, manifest_raw, plan['archiveSetSha256'], plan['buildPlan'])
        with release_lock():
            adapter = Commands(plan, c, canonical, canonical_path, work)
            receipt = publish_images(plan, archive_set, bundle, adapter, c)
        print('CN_ARCHIVE_PUBLISHED=' + json.dumps(receipt, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, Rejected) else 'LOCAL_INPUT_OR_OPERATION_REJECTED'
        print('CN_ARCHIVE_PUBLISH_REJECTED=' + code, file=sys.stderr)
        sys.exit(1)
