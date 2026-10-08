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
        value = subprocess.run(argv, cwd=cwd, env=env, stdout=stdout or subprocess.PIPE,
                               stderr=subprocess.PIPE, timeout=3600, check=False)
    contract.require(value.returncode == 0, 'EXPORT_COMMAND_FAILED_' + Path(argv[0]).name.upper())
    return value.stdout


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


def produce(plan, source, output, command=run):
    contract.validate_plan(plan)
    control = Path(__file__).resolve().parent.parent
    contract.require(command(['git', 'rev-parse', 'HEAD'], control).decode().strip() == plan['controlRevision'], 'CONTROL_SHA_MISMATCH')
    contract.require(not command(['git', 'status', '--porcelain', '--untracked-files=all'], control).strip(), 'CONTROL_DIRTY')
    for relative in ('scripts/export-cn-image-archives.py', 'scripts/cn_image_archive.py', 'scripts/hosted-release.py', 'scripts/canonical_control.py'):
        contract.require((control / relative).read_bytes() == command(['git', 'show', plan['controlRevision'] + ':' + relative], control), 'CONTROL_BYTES_MISMATCH')
    contract.require(command(['git', 'rev-parse', 'HEAD'], source).decode().strip() == plan['sourceRevision'], 'SOURCE_SHA_MISMATCH')
    contract.require(not command(['git', 'status', '--porcelain', '--untracked-files=all'], source).strip(), 'SOURCE_DIRTY')
    command(['git', 'merge-base', '--is-ancestor', plan['sourceRevision'], 'origin/main'], source)
    contract.require(set(hosted.SERVICES) == set(contract.REPOSITORIES), 'SERVICE_CONTRACT_DRIFT')
    output = Path(output); output.mkdir(mode=0o700, parents=False, exist_ok=False)
    os.chmod(output, 0o700)
    images = {}; total = 0
    try:
        with tempfile.TemporaryDirectory(prefix='wsx-archive-export-') as directory:
            root = Path(directory); archive = root / 'source.tar'
            command(['git', 'archive', '--format=tar', '--output', str(archive), plan['sourceRevision']], source)
            checkout = root / 'source'; checkout.mkdir()
            with tarfile.open(archive, 'r:') as contents:
                contents.extractall(checkout, filter='data')
            for service, (repository, dockerfile, context, bases) in hosted.SERVICES.items():
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
        value.update(schemaVersion=1, receiptKind='cn-image-archive-set-v1', planSha256=contract.sha(contract.json_bytes(plan)),
                     producedAt=now.isoformat(), expiresAt=(now + timedelta(hours=1)).isoformat(), images=images,
                     ready=False, prepared=False, productionActivated=False)
        for file, data in (('build-plan.json', plan), ('archive-set.json', value)):
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', required=True); parser.add_argument('--source', required=True); parser.add_argument('--output', required=True)
    args = parser.parse_args()
    raw = Path(args.plan).read_bytes(); contract.require(len(raw) <= 16384, 'BUILD_PLAN_SIZE')
    produce(contract.decode(raw), Path(args.source).resolve(), args.output)
    print('CN_IMAGE_ARCHIVES_EXPORTED registryPublished=false productionReady=false')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('CN_IMAGE_ARCHIVE_EXPORT_REJECTED', file=sys.stderr)
        sys.exit(1)
