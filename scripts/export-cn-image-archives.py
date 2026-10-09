#!/usr/bin/env python3
"""Non-production five-image producer. No registry login/push or OSS upload."""
import argparse
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import selectors
import shutil
import signal
import stat
import time
import sys
import tarfile
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cn_image_archive as contract

# Reuse the existing Dockerfile/context/base contract, not a second service table.
spec = importlib.util.spec_from_file_location('hosted_release', Path(__file__).with_name('hosted-release.py'))
hosted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosted)


def run(argv, cwd=None, stdout=None):
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
           'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_NO_LAZY_FETCH': '1'}
    with tempfile.TemporaryDirectory(prefix='wsx-export-home-') as home:
        env['HOME'] = home
        process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True)
        selector = selectors.DefaultSelector(); buffers = {}; deadline = time.monotonic() + 3600
        try:
            for stream in (process.stdout, process.stderr):
                buffers[stream] = bytearray(); selector.register(stream, selectors.EVENT_READ)
            while selector.get_map():
                contract.require(time.monotonic() < deadline, 'EXPORT_COMMAND_TIMEOUT')
                for key, _ in selector.select(.2):
                    data = os.read(key.fileobj.fileno(), 8192)
                    if not data:
                        selector.unregister(key.fileobj); continue
                    contract.require(len(buffers[key.fileobj]) + len(data) <= 8 * 1024**2, 'EXPORT_OUTPUT_LIMIT')
                    buffers[key.fileobj].extend(data)
            contract.require(process.wait(timeout=1) == 0, 'EXPORT_COMMAND_FAILED_' + Path(argv[0]).name.upper())
            return bytes(buffers[process.stdout])
        finally:
            if process.poll() is None: os.killpg(process.pid, signal.SIGKILL)
            process.wait(); selector.close(); process.stdout.close(); process.stderr.close()



def normalize(saved, output, plan, service):
    """Keep only one image and its referenced regular payloads; never extract."""
    contract.require(Path(saved).stat().st_size <= plan['maxArchiveBytes'], 'ARCHIVE_SIZE_LIMIT')
    with tarfile.open(saved, 'r:') as source:
        index = contract.members(source)
        contract.require('manifest.json' in index, 'DOCKER_MANIFEST_MISSING')
        manifest = contract.decode(contract.small_member(source, index['manifest.json']))
        contract.require(type(manifest) is list and len(manifest) == 1, 'ONE_IMAGE_REQUIRED')
        item = manifest[0]
        contract.require(type(item) is dict and set(item) == {'Config', 'RepoTags', 'Layers'}, 'DOCKER_MANIFEST_FIELDS')
        contract.require(item['RepoTags'] == [contract.staging_tag(plan, service)], 'STAGING_TAG_MISMATCH')
        names = [item['Config'], *item['Layers']]
        contract.require(1 < len(names) <= 129 and len(set(names)) == len(names), 'LAYER_SET_INVALID')
        for name in names:
            contract.safe_name(name)
            contract.require(name in index and index[name].isfile(), 'ARCHIVE_MEMBER_MISSING')
        # Docker-save may carry harmless indexes/repositories; they do not enter
        # the normalized transport or its Docker load operation.
        with open(output, 'xb') as stream, tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as target:
            for name in names:
                member = index[name]
                header = tarfile.TarInfo(name)
                header.size = member.size; header.mode = 0o644
                with source.extractfile(member) as content:
                    target.addfile(header, content)
            raw = contract.json_bytes(manifest)
            header = tarfile.TarInfo('manifest.json'); header.size = len(raw); header.mode = 0o644
            target.addfile(header, io.BytesIO(raw))
    return contract.inspect_archive(output, plan, service)


def verify_control(plan, command=run):
    control = Path(__file__).resolve().parent.parent
    contract.require(command(['git', 'rev-parse', 'HEAD'], control).decode().strip() == plan['controlRevision'], 'CONTROL_SHA_MISMATCH')
    contract.require(not command(['git', 'status', '--porcelain', '--untracked-files=all'], control).strip(), 'CONTROL_DIRTY')
    for relative in ('scripts/export-cn-image-archives.py', 'scripts/cn_image_archive.py', 'scripts/hosted-release.py', 'scripts/canonical_control.py'):
        contract.require((control / relative).read_bytes() == command(['git', 'show', plan['controlRevision'] + ':' + relative], control), 'CONTROL_BYTES_MISMATCH')

def produce(plan, source, output, command=run, service=None):
    contract.validate_plan(plan)
    contract.require(service is None or service in contract.REPOSITORIES, 'SERVICE_INVALID')
    verify_control(plan, command)
    contract.require(command(['git', 'rev-parse', 'HEAD'], source).decode().strip() == plan['sourceRevision'], 'SOURCE_SHA_MISMATCH')
    contract.require(not command(['git', 'status', '--porcelain', '--untracked-files=all'], source).strip(), 'SOURCE_DIRTY')
    command(['git', 'merge-base', '--is-ancestor', plan['sourceRevision'], 'origin/main'], source)
    contract.require(set(hosted.SERVICES) == set(contract.REPOSITORIES), 'SERVICE_CONTRACT_DRIFT')
    output = Path(output)
    contract.require(shutil.disk_usage(output.parent).free >= (plan['maxTotalBytes'] if service is None else plan['maxArchiveBytes']) * 4 + plan['storageMarginBytes'], 'EXPORT_CAPACITY')
    contract.require(os.statvfs(output.parent).f_favail >= 4096, 'EXPORT_INODE_CAPACITY')
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    os.chmod(output, 0o700)
    single_service = service
    images = {}; total = 0
    try:
        with tempfile.TemporaryDirectory(prefix='wsx-archive-export-') as directory:
            root = Path(directory); archive = root / 'source.tar'
            command(['git', 'archive', '--format=tar', '--output', str(archive), plan['sourceRevision']], source)
            checkout = root / 'source'; checkout.mkdir()
            with tarfile.open(archive, 'r:') as contents:
                contents.extractall(checkout, filter='data')
            selected = hosted.SERVICES if service is None else {service: hosted.SERVICES[service]}
            for service, (repository, dockerfile, context, bases) in selected.items():
                contract.require(repository == contract.REPOSITORIES[service], 'SERVICE_CONTRACT_DRIFT')
                tag = contract.staging_tag(plan, service)
                argv = ['docker', 'buildx', 'build', '--load', '--platform', plan['platform'],
                        '--label', 'org.opencontainers.image.revision=' + plan['sourceRevision'],
                        '--label', 'org.workspacex.archive-build-identity=' + contract.build_identity(plan),
                        '-f', str(checkout / dockerfile), '-t', tag]
                mapping = {'node': 'NODE_IMAGE', 'python': 'PYTHON_IMAGE', 'postgres': 'PGVECTOR_IMAGE'}
                for base in bases:
                    argv += ['--build-arg', mapping[base] + '=' + plan['baseImages'][base]]
                argv += ['--build-arg', 'SOURCE_REVISION=' + plan['sourceRevision'], str(checkout / context)]
                command(argv)
                saved = root / (service + '.save.tar')
                command(['docker', 'image', 'save', '--output', str(saved), tag])
                target = output / (service + '.tar')
                metadata = normalize(saved, target, plan, service)
                size, digest = contract.file_digest(target, plan['maxArchiveBytes'])
                total += size; contract.require(total <= plan['maxTotalBytes'], 'ARCHIVE_TOTAL_LIMIT')
                images[service] = {'file': service + '.tar', 'size': size, 'sha256': digest, **metadata}
                saved.unlink()
        now = datetime.now(timezone.utc)
        value = {k: plan[k] for k in ('sourceRevision', 'controlRevision', 'release', 'attemptId', 'platform')}
        value.update(schemaVersion=1, receiptKind='cn-image-archive-set-v1' if single_service is None else 'cn-image-archive-fragment-v1', planSha256=contract.sha(contract.json_bytes(plan)),
                     producedAt=now.isoformat(), expiresAt=(now + timedelta(hours=1)).isoformat(), images=images,
                     ready=False, prepared=False, productionActivated=False)
        for file, data in (('build-plan.json', plan), ('archive-set.json' if single_service is None else 'archive-fragment.json', value)):
            with (output / file).open('xb') as stream:
                stream.write(contract.json_bytes(data))
        return value
    except BaseException:
        # Only this newly-created output directory; never Docker prune or source cleanup.
        for path in output.iterdir():
            if path.is_file() and not path.is_symlink():
                path.unlink()
        output.rmdir()
        raise


def produce_service(plan, source, output, service, command=run):
    """Same trusted producer, limited to one retained normalized archive."""
    return produce(plan, source, output, command=command, service=service)


def checked_path(path, directory=False):
    path = Path(os.path.abspath(path))
    for part in (path, *path.parents):
        contract.require(not part.is_symlink(), 'COLLECT_SYMLINK')
    mode = path.stat().st_mode
    contract.require(stat.S_ISDIR(mode) if directory else stat.S_ISREG(mode), 'COLLECT_PATH_TYPE')
    return path


def read_metadata(path, maximum):
    path = checked_path(path)
    contract.require(path.stat().st_size <= maximum, 'COLLECT_METADATA_SIZE')
    raw = path.read_bytes()
    contract.require(len(raw) <= maximum, 'COLLECT_METADATA_SIZE')
    return raw


def collect(plan, directory, output, now=None, command=run):
    """Validate five fixed fragments in place; never copy their large payloads.

    Archives are moved to a fresh flat output directory after complete validation.
    Fragment expiry is preserved, never refreshed by aggregation.
    """
    contract.validate_plan(plan)
    verify_control(plan, command)
    root = checked_path(directory, directory=True)
    output = Path(os.path.abspath(output))
    checked_path(output.parent, directory=True)
    contract.require(output != root and not output.exists() and not output.is_symlink(), 'COLLECT_OUTPUT_EXISTS')
    contract.require(output.parent.stat().st_dev == root.stat().st_dev, 'COLLECT_CROSS_FILESYSTEM')
    services = set(contract.REPOSITORIES)
    contract.require({p.name for p in root.iterdir()} == services, 'COLLECT_SERVICE_SET')
    images = {}; pinned = {}; issued = []; expires = []
    clock = now or datetime.now(timezone.utc)
    fields = {'schemaVersion', 'receiptKind', 'planSha256', 'producedAt', 'expiresAt', 'images',
              'ready', 'prepared', 'productionActivated', 'sourceRevision', 'controlRevision',
              'release', 'attemptId', 'platform'}
    for service in contract.REPOSITORIES:
        folder = checked_path(root / service, directory=True)
        contract.require({p.name for p in folder.iterdir()} ==
                         {service + '.tar', 'build-plan.json', 'archive-fragment.json'}, 'COLLECT_FRAGMENT_FILES')
        plan_raw = read_metadata(folder / 'build-plan.json', 16384)
        observed_plan = contract.decode(plan_raw)
        contract.require(observed_plan == plan and plan_raw == contract.json_bytes(plan), 'COLLECT_PLAN_MISMATCH')
        fragment = contract.decode(read_metadata(folder / 'archive-fragment.json', 256 * 1024))
        contract.require(type(fragment) is dict and set(fragment) == fields and
                         type(fragment['schemaVersion']) is int and fragment['schemaVersion'] == 1,
                         'COLLECT_FRAGMENT_FIELDS')
        contract.require(fragment['receiptKind'] == 'cn-image-archive-fragment-v1' and
                         fragment['planSha256'] == contract.sha(contract.json_bytes(plan)), 'COLLECT_PLAN_HASH')
        contract.require(all(fragment[k] == plan[k] for k in
                         ('sourceRevision', 'controlRevision', 'release', 'attemptId', 'platform')), 'COLLECT_IDENTITY')
        contract.require(all(fragment[k] is False for k in
                         ('ready', 'prepared', 'productionActivated')), 'COLLECT_PRIVILEGE')
        first = contract.timestamp(fragment['producedAt']); last = contract.timestamp(fragment['expiresAt'])
        contract.require(0 < (last - first).total_seconds() <= 3600 and first <= clock < last,
                         'COLLECT_FRAGMENT_EXPIRED')
        issued.append(first); expires.append(last)
        contract.require(type(fragment['images']) is dict and set(fragment['images']) == {service},
                         'COLLECT_FRAGMENT_SERVICE')
        images[service] = fragment['images'][service]
        pinned[service] = checked_path(folder / (service + '.tar'))
    value = {k: plan[k] for k in ('sourceRevision', 'controlRevision', 'release', 'attemptId', 'platform')}
    value.update(schemaVersion=1, receiptKind='cn-image-archive-set-v1',
                 planSha256=contract.sha(contract.json_bytes(plan)), images=images,
                 producedAt=min(issued).isoformat(), expiresAt=min(expires).isoformat(),
                 ready=False, prepared=False, productionActivated=False)
    raw = contract.json_bytes(value)
    contract.validate_set(root, raw, contract.sha(raw), plan, now=clock, pinned_paths=pinned)
    # Move already validated archives on the same filesystem: canonical flat
    # layout for the existing importer/OSS snapshot, without payload duplication.
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    moved = []; written = []
    try:
        for service in contract.REPOSITORIES:
            target = output / (service + '.tar')
            os.rename(pinned[service], target)
            moved.append((target, pinned[service]))
        contract.validate_set(output, raw, contract.sha(raw), plan, now=clock)
        for filename, data in (('build-plan.json', contract.json_bytes(plan)), ('archive-set.json', raw)):
            with (output / filename).open('xb') as stream:
                written.append(output / filename); stream.write(data)
        return value
    except BaseException:
        # Preserve the original failure even if cleanup fails; never publish a
        # receipt for partial output. Filesystem errors may require operator cleanup.
        for path in written:
            try: path.unlink()
            except OSError: pass
        for target, original in reversed(moved):
            try: os.rename(target, original)
            except OSError: pass
        try: output.rmdir()
        except OSError: pass
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', required=True); parser.add_argument('--plan-sha256'); parser.add_argument('--source'); parser.add_argument('--output', required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--service', choices=tuple(contract.REPOSITORIES)); modes.add_argument('--collect')
    args = parser.parse_args()
    def deadline(signum, frame):
        raise contract.Rejected('EXPORT_TOTAL_DEADLINE')
    signal.signal(signal.SIGALRM, deadline); signal.signal(signal.SIGTERM, deadline); signal.alarm(7200)
    contract.require(Path(args.plan).stat().st_size <= 16384, 'BUILD_PLAN_SIZE')
    raw = Path(args.plan).read_bytes(); contract.require(len(raw) <= 16384, 'BUILD_PLAN_SIZE')
    contract.require((args.service is None and args.collect is None) or args.plan_sha256 is not None, 'PLAN_RAW_HASH_REQUIRED')
    if args.plan_sha256 is not None:
        contract.require(contract.hex_string(args.plan_sha256, 64) and contract.sha(raw) == args.plan_sha256, 'PLAN_RAW_HASH_MISMATCH')
    if args.collect:
        contract.require(args.source is None, 'COLLECT_SOURCE_NOT_ALLOWED')
        collect(contract.decode(raw), args.collect, args.output)
    else:
        contract.require(args.source is not None, 'SOURCE_REQUIRED')
        produce(contract.decode(raw), Path(args.source).resolve(), args.output, service=args.service)
    print('CN_IMAGE_ARCHIVES_EXPORTED registryPublished=false productionReady=false')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('CN_IMAGE_ARCHIVE_EXPORT_REJECTED', file=sys.stderr)
        sys.exit(1)
