#!/usr/bin/env python3
"""Manual, credential-free candidate measurement; never a production receipt."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import subprocess
import tarfile
import tempfile
import time

BASES = {'node': 'docker.io/library/node:22-bookworm-slim',
         'python': 'docker.io/library/python:3.11-slim',
         'postgres': 'docker.io/pgvector/pgvector:pg16'}
SERVICES = {
    'api': ('deploy/aliyun/images/api.Dockerfile', '.', ('node',)),
    'web': ('deploy/aliyun/images/web.Dockerfile', '.', ('node',)),
    'agent': ('apps/deep-agent-service/Dockerfile', 'apps/deep-agent-service', ('python',)),
    'sandbox': ('apps/skill-sandbox/Dockerfile', 'apps/skill-sandbox', ('node', 'python')),
    'postgres': ('apps/api/docker/postgres-age/Dockerfile', 'apps/api/docker/postgres-age', ('postgres',)),
}
CONTROL = Path(__file__).resolve().parents[1]
MAX_ARCHIVE = 2 * 1024**3
MARGIN = 4 * 1024**3
MAX_SOURCE = 512 * 1024**2
DEADLINE = None
MEASUREMENT = None


def require(ok, code):
    if not ok:
        raise ValueError(code)


def exact_sha(value):
    require(isinstance(value, str) and re.fullmatch('[a-f0-9]{40}', value), 'EXACT_SHA_REQUIRED')
    return value


def sample_disk():
    if MEASUREMENT is not None:
        free = shutil.disk_usage(Path.cwd()).free
        MEASUREMENT['minimumSampledFreeBytes'] = min(MEASUREMENT['minimumSampledFreeBytes'], free)
        MEASUREMENT['samples'] += 1
        require(free >= MARGIN, 'BUILD_ONLY_STORAGE_MARGIN')


def execute(argv, env):
    deadline = min(time.monotonic() + 3300, DEADLINE or float('inf'))
    require(time.monotonic() < deadline, 'BUILD_ONLY_DEADLINE')
    process = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    selector = selectors.DefaultSelector()
    buffers = {process.stdout: bytearray(), process.stderr: bytearray()}
    try:
        for stream in buffers:
            selector.register(stream, selectors.EVENT_READ)
        while selector.get_map():
            require(time.monotonic() < deadline, 'BUILD_ONLY_DEADLINE')
            sample_disk()
            for key, _ in selector.select(.2):
                data = os.read(key.fileobj.fileno(), 65536)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                buffers[key.fileobj].extend(data)
                require(sum(map(len, buffers.values())) <= 16 * 1024**2, 'BUILD_ONLY_OUTPUT_LIMIT')
        process.wait(timeout=max(.001, deadline - time.monotonic()))
        require(process.returncode == 0, 'BUILD_ONLY_COMMAND_FAILED')
        return bytes(buffers[process.stdout]).decode().strip()
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass
        selector.close()
        process.stdout.close()
        process.stderr.close()


def save(path, value):
    payload = json.dumps(value, sort_keys=True, indent=2) + '\n'
    require(len(payload.encode()) <= 16384, 'BUILD_ONLY_REPORT_TOO_LARGE')
    with Path(path).open('x') as stream:
        stream.write(payload)
    return hashlib.sha256(payload.encode()).hexdigest()


def validate(value):
    require(type(value) is dict and set(value) == {'schemaVersion', 'sourceRevision', 'controlRevision',
            'platform', 'baseImages', 'maxArchiveBytes', 'storageMarginBytes'}, 'INVALID_BUILD_ONLY_FIELDS')
    require(type(value['schemaVersion']) is int and value['schemaVersion'] == 2
            and value['platform'] == 'linux/amd64', 'INVALID_BUILD_ONLY_IDENTITY')
    exact_sha(value['sourceRevision']); exact_sha(value['controlRevision'])
    require(type(value['maxArchiveBytes']) is int and value['maxArchiveBytes'] == MAX_ARCHIVE
            and type(value['storageMarginBytes']) is int and value['storageMarginBytes'] == MARGIN,
            'INVALID_MEASUREMENT_BUDGET')
    require(type(value['baseImages']) is dict and set(value['baseImages']) == set(BASES), 'INVALID_BASE_SET')
    for key, tag in BASES.items():
        base = value['baseImages'][key]
        require(isinstance(base, str) and re.fullmatch(re.escape(tag.rsplit(':', 1)[0]) +
                r'@sha256:[a-f0-9]{64}', base), 'INVALID_PUBLIC_BASE_DIGEST')
    return value


def identity(revision, env, control=False):
    prefix = ['git', '-C', str(CONTROL)] if control else ['git']
    require(execute(prefix + ['rev-parse', 'HEAD'], env) == revision, 'WRONG_CONTROL_HEAD' if control else 'WRONG_APPLICATION_HEAD')
    require(not execute(prefix + ['status', '--porcelain', '--untracked-files=no'], env), 'DIRTY_TRACKED_SOURCE')


def plan(output, env, source_sha, control_sha):
    global DEADLINE
    DEADLINE = time.monotonic() + 300
    exact_sha(source_sha); exact_sha(control_sha); identity(control_sha, env, True)
    bases = {}
    for key, tag in BASES.items():
        manifest = json.loads(execute(['docker', 'buildx', 'imagetools', 'inspect', tag,
                                      '--format', '{{json .Manifest}}'], env))
        bases[key] = tag.rsplit(':', 1)[0] + '@' + manifest['digest']
    value = validate(dict(schemaVersion=2, sourceRevision=source_sha, controlRevision=control_sha,
                          platform='linux/amd64', baseImages=bases, maxArchiveBytes=MAX_ARCHIVE,
                          storageMarginBytes=MARGIN))
    identity(control_sha, env, True)
    return save(output, value)


def decode_plan(raw, expected_hash):
    require(len(raw) <= 16384 and isinstance(expected_hash, str) and
            re.fullmatch('[a-f0-9]{64}', expected_hash), 'INVALID_PLAN_INPUT')
    require(hashlib.sha256(raw).hexdigest() == expected_hash, 'PLAN_HASH_MISMATCH')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'DUPLICATE_PLAN_KEY')
            result[key] = value
        return result
    return validate(json.loads(raw, object_pairs_hook=pairs))


def file_hash(path):
    size = 0; digest = hashlib.sha256()
    with path.open('rb') as stream:
        while data := stream.read(1024**2):
            size += len(data)
            require(size <= MAX_ARCHIVE, 'MEASUREMENT_ARCHIVE_LIMIT')
            digest.update(data)
    return size, digest.hexdigest()


def build(value, service, output, env, plan_hash, source_sha, control_sha):
    global DEADLINE, MEASUREMENT
    DEADLINE = time.monotonic() + 3300
    validate(value)
    require(value['sourceRevision'] == exact_sha(source_sha) and value['controlRevision'] == exact_sha(control_sha), 'PLAN_IDENTITY_MISMATCH')
    require(isinstance(plan_hash, str) and re.fullmatch('[a-f0-9]{64}', plan_hash), 'INVALID_PLAN_HASH')
    require(service in SERVICES, 'INVALID_SERVICE')
    identity(control_sha, env, True); identity(source_sha, env)
    initial = shutil.disk_usage(Path.cwd()).free
    require(initial >= 4 * MAX_ARCHIVE + MARGIN, 'BUILD_ONLY_CAPACITY')
    require(os.statvfs(Path.cwd()).f_favail >= 4096, 'BUILD_ONLY_INODE_CAPACITY')
    MEASUREMENT = {'minimumSampledFreeBytes': initial, 'samples': 0}
    started = time.monotonic()
    try:
        dockerfile, context, bases = SERVICES[service]
        arguments = {'SOURCE_REVISION': source_sha, 'NPM_REGISTRY': 'https://registry.npmjs.org',
                     'PYPI_INDEX_URL': 'https://pypi.org/simple', 'APT_MIRROR': 'https://deb.debian.org',
                     'AGE_REPOSITORY': 'https://github.com/apache/age.git'}
        arguments.update({{'node': 'NODE_IMAGE', 'python': 'PYTHON_IMAGE', 'postgres': 'PGVECTOR_IMAGE'}[key]: value['baseImages'][key] for key in bases})
        tag = 'wsx-build-only/' + service + ':' + source_sha
        with tempfile.TemporaryDirectory(prefix='wsx-frozen-source-') as temporary:
            root = Path(temporary); archive = root / 'source.tar'
            execute(['git', 'archive', '--format=tar', '--output', str(archive), source_sha], env)
            require(archive.stat().st_size <= MAX_SOURCE, 'SOURCE_ARCHIVE_LIMIT')
            source = root / 'source'; source.mkdir()
            with tarfile.open(archive) as contents:
                require(all(member.isfile() or member.isdir() or member.issym() for member in contents.getmembers()), 'SOURCE_LINK_REJECTED')
                contents.extractall(source, filter='data')
            require((source / dockerfile).is_file() and not (source / dockerfile).is_symlink()
                    and (source / dockerfile).resolve().is_relative_to(source.resolve())
                    and (source / context).is_dir()
                    and (source / context).resolve().is_relative_to(source.resolve()), 'BUILD_CONTEXT_MISSING')
            sample_disk()
            command = ['docker', 'buildx', 'build', '--load', '--platform', value['platform'],
                       '--label', 'org.opencontainers.image.revision=' + source_sha,
                       '--label', 'org.workspacex.scope=build-only', '-f', str(source / dockerfile), '-t', tag]
            for key, val in arguments.items():
                command += ['--build-arg', key + '=' + val]
            execute(command + [str(source / context)], env)
            image = json.loads(execute(['docker', 'image', 'inspect', tag], env))[0]
            require(image.get('Os') == 'linux' and image.get('Architecture') == 'amd64'
                    and image['Config']['Labels'].get('org.opencontainers.image.revision') == source_sha
                    and image['Config']['Labels'].get('org.workspacex.scope') == 'build-only'
                    and re.fullmatch(r'sha256:[a-f0-9]{64}', image['Id'])
                    and type(image.get('Size')) is int and 0 <= image['Size'] <= MAX_ARCHIVE, 'LOCAL_IMAGE_IDENTITY_OR_SIZE_MISMATCH')
            saved = root / 'measurement.save.tar'
            execute(['docker', 'image', 'save', '--output', str(saved), tag], env)
            archive_size, archive_hash = file_hash(saved)
            sample_disk()
        identity(source_sha, env); identity(control_sha, env, True)
        report = dict(schemaVersion=2, mode='build-only-measurement', service=service,
                      sourceRevision=source_sha, controlRevision=control_sha, planSha256=plan_hash,
                      platform=value['platform'], baseImages=value['baseImages'], localImageId=image['Id'],
                      localImageSizeBytes=image['Size'], dockerSaveSizeBytes=archive_size,
                      dockerSaveSha256=archive_hash, dockerSaveRetained=False,
                      initialFreeBytes=initial, **MEASUREMENT,
                      sampledWorkspaceDiskIncreaseBytes=max(0, initial-MEASUREMENT['minimumSampledFreeBytes']),
                      diskMeasurementScope='sampled workspace filesystem; not a guaranteed peak or all Docker storage',
                      elapsedSeconds=round(time.monotonic()-started, 3), ready=False, pushed=False,
                      sealed=False, prepared=False, productionActivated=False, runtimeVerified=False)
        save(output, report)
    finally:
        MEASUREMENT = None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['plan', 'build'])
    parser.add_argument('--source-sha', required=True); parser.add_argument('--control-sha', required=True)
    parser.add_argument('--plan'); parser.add_argument('--plan-sha256')
    parser.add_argument('--service', choices=SERVICES); parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        with tempfile.TemporaryDirectory(prefix='wsx-public-docker-') as temporary:
            env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': temporary, 'LANG': 'C',
                   'DOCKER_CONFIG': temporary, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                   'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_NO_LAZY_FETCH': '1'}
            Path(temporary, 'config.json').write_text('{"auths":{}}')
            if args.operation == 'plan':
                print(plan(args.output, env, args.source_sha, args.control_sha))
            else:
                require(args.plan is not None and args.service is not None, 'BUILD_ARGUMENTS_REQUIRED')
                with Path(args.plan).open('rb') as stream:
                    value = decode_plan(stream.read(16385), args.plan_sha256)
                build(value, args.service, args.output, env, args.plan_sha256, args.source_sha, args.control_sha)
    except Exception:
        # Provider output and command arguments never become a CI error artifact.
        print('BUILD_ONLY_FAILED')
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
