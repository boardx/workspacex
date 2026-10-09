#!/usr/bin/env python3
"""Credential-free frozen-source build rehearsal; never creates release receipts."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile

APP = 'ee7e682805c27a38e9fd601c4aca66f11763ba91'
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

def execute(argv, env):
    return subprocess.check_output(argv, env=env, text=True, timeout=3600).strip()

def save(path, value):
    payload = json.dumps(value, indent=2) + '\n'
    if len(payload.encode('utf-8')) > 16384:
        raise ValueError('BUILD_ONLY_REPORT_TOO_LARGE')
    with Path(path).open('x') as stream:
        stream.write(payload)

def validate(plan):
    if set(plan) != {'schemaVersion', 'sourceRevision', 'platform', 'baseImages'} or plan['schemaVersion'] != 1 or plan['sourceRevision'] != APP or plan['platform'] != 'linux/amd64':
        raise ValueError('INVALID_BUILD_ONLY_IDENTITY')
    if set(plan['baseImages']) != set(BASES):
        raise ValueError('INVALID_BASE_SET')
    for key, tag in BASES.items():
        repository = tag.rsplit(':', 1)[0]
        if not re.fullmatch(re.escape(repository) + r'@sha256:[a-f0-9]{64}', plan['baseImages'][key]):
            raise ValueError('INVALID_PUBLIC_BASE_DIGEST')

def plan(output, env):
    bases = {}
    for key, tag in BASES.items():
        manifest = json.loads(execute(['docker', 'buildx', 'imagetools', 'inspect', tag, '--format', '{{json .Manifest}}'], env))
        bases[key] = tag.rsplit(':', 1)[0] + '@' + manifest['digest']
    value = dict(schemaVersion=1, sourceRevision=APP, platform='linux/amd64', baseImages=bases)
    validate(value)
    save(output, value)

def build(value, service, output, env):
    validate(value)
    if service not in SERVICES:
        raise ValueError('INVALID_SERVICE')
    if execute(['git', 'rev-parse', 'HEAD'], env) != APP:
        raise ValueError('WRONG_APPLICATION_HEAD')
    dockerfile, context, bases = SERVICES[service]
    arguments = {'SOURCE_REVISION': APP, 'NPM_REGISTRY': 'https://registry.npmjs.org',
                 'PYPI_INDEX_URL': 'https://pypi.org/simple', 'APT_MIRROR': 'https://deb.debian.org',
                 'AGE_REPOSITORY': 'https://github.com/apache/age.git'}
    names = {'node': 'NODE_IMAGE', 'python': 'PYTHON_IMAGE', 'postgres': 'PGVECTOR_IMAGE'}
    arguments.update({names[key]: value['baseImages'][key] for key in bases})
    tag = 'wsx-build-only/' + service + ':' + APP
    with tempfile.TemporaryDirectory(prefix='wsx-frozen-source-') as temporary:
        root = Path(temporary)
        archive = root / 'source.tar'
        execute(['git', 'archive', '--format=tar', '--output', str(archive), APP], env)
        source = root / 'source'
        source.mkdir()
        with tarfile.open(archive) as contents:
            contents.extractall(source, filter='data')
        command = ['docker', 'buildx', 'build', '--load', '--platform', value['platform'],
                   '--label', 'org.opencontainers.image.revision=' + APP,
                   '--label', 'org.workspacex.scope=build-only',
                   '-f', str(source / dockerfile), '-t', tag]
        for key, val in arguments.items():
            command.extend(['--build-arg', key + '=' + val])
        execute(command + [str(source / context)], env)
    image = json.loads(execute(['docker', 'image', 'inspect', tag], env))[0]
    if image['Config']['Labels'].get('org.opencontainers.image.revision') != APP or not re.fullmatch(r'sha256:[a-f0-9]{64}', image['Id']):
        raise ValueError('LOCAL_IMAGE_IDENTITY_MISMATCH')
    save(output, dict(schemaVersion=1, mode='build-only', service=service, sourceRevision=APP,
                      platform=value['platform'], baseImages=value['baseImages'], localImageId=image['Id'],
                      localImageSizeBytes=image['Size'], pushed=False, sealed=False, prepared=False,
                      productionActivated=False, runtimeVerified=False))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['plan', 'build'])
    parser.add_argument('--plan')
    parser.add_argument('--service', choices=SERVICES)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    # Empty Docker credential store; no host/cloud credentials forwarded to tools.
    with tempfile.TemporaryDirectory(prefix='wsx-public-docker-') as temporary:
        env = {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR') if key in os.environ}
        env.update(DOCKER_CONFIG=temporary, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null',
                   GIT_NO_REPLACE_OBJECTS='1', GIT_NO_LAZY_FETCH='1')
        Path(temporary, 'config.json').write_text('{"auths":{}}')
        if args.operation == 'plan':
            plan(args.output, env)
        else:
            build(json.loads(Path(args.plan).read_text()), args.service, args.output, env)

if __name__ == '__main__':
    main()
