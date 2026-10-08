#!/usr/bin/env python3
"""Draft nonprivileged artifact producer; no production preparation or activation."""
import argparse
import contextlib
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import time
import urllib.parse

_control_path = Path(__file__).with_name('canonical_control.py')
_control_spec = importlib.util.spec_from_file_location('canonical_control', _control_path)
control = importlib.util.module_from_spec(_control_spec)
_control_spec.loader.exec_module(control)

SERVICES = {
    'api': ('api', 'deploy/aliyun/images/api.Dockerfile', '.', ('node',)),
    'web': ('web', 'deploy/aliyun/images/web.Dockerfile', '.', ('node',)),
    'agent': ('deep-agent', 'apps/deep-agent-service/Dockerfile', 'apps/deep-agent-service', ('python',)),
    'sandbox': ('skill-sandbox', 'apps/skill-sandbox/Dockerfile', 'apps/skill-sandbox', ('node', 'python')),
    'postgres': ('postgres-age', 'apps/api/docker/postgres-age/Dockerfile', 'apps/api/docker/postgres-age', ('postgres',)),
}
DIGEST = re.compile(r'^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$')
DEFAULT_SOURCES = dict(npmRegistry='https://registry.npmjs.org', pypiIndexUrl='https://pypi.org/simple', aptMirror='https://deb.debian.org', ageRepository='https://github.com/apache/age.git')
BUILD_IDENTITY_LABEL = 'org.workspacex.build-identity'

def build_identity(plan):
    """Stable content-input identity, independent of promotion and retry identity."""
    identity = {key: plan[key] for key in ('sourceRevision', 'platform', 'baseImages', 'packageSources')}
    identity['schemaVersion'] = 1
    return hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('utf-8')).hexdigest()

def reject(condition, code):
    if not condition:
        raise ValueError(code)

def run(argv, env=None, stdin=None, cwd=None):
    # Never relay command stderr: registry/provider failures can contain secrets.
    if argv[0] == 'git':
        env = dict(os.environ if env is None else env)
        for key in list(env):
            if key.startswith('GIT_'):
                del env[key]
        env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_NO_REPLACE_OBJECTS='1', GIT_NO_LAZY_FETCH='1')
    result = subprocess.run(argv, input=stdin, text=True, capture_output=True, env=env, cwd=cwd, timeout=3600)
    if result.returncode:
        raise RuntimeError('COMMAND_FAILED_' + Path(argv[0]).name.upper())
    return result.stdout

def read(path):
    return json.loads(Path(path).read_text())

def write(path, value):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('x') as stream:
        os.chmod(target, 0o600)
        json.dump(value, stream, indent=2)
        stream.write('\n')

def validate_input(value):
    required = {'schemaVersion', 'sourceRevision', 'release', 'attemptId', 'platform', 'registryPrefix', 'acrRegion', 'acrInstanceId', 'baseImages', 'registryProbeImage'}
    reject(isinstance(value, dict) and required <= value.keys() and value.keys() <= required | {'packageSources', 'acrEdition'}, 'INVALID_INPUT_FIELDS')
    reject(type(value['schemaVersion']) is int and value['schemaVersion'] == 1, 'INVALID_SCHEMA')
    reject(isinstance(value['sourceRevision'], str) and re.fullmatch('[a-f0-9]{40}', value['sourceRevision']), 'INVALID_SHA')
    reject(isinstance(value['release'], str) and re.fullmatch(r'v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?', value['release']), 'INVALID_RELEASE')
    reject(isinstance(value['attemptId'], str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', value['attemptId']), 'INVALID_ATTEMPT')
    reject(value['platform'] in ('linux/amd64', 'linux/arm64'), 'INVALID_PLATFORM')
    reject(isinstance(value['registryPrefix'], str) and re.fullmatch(r'[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9]+(?:[._-][a-z0-9]+)*', value['registryPrefix']), 'INVALID_REGISTRY')
    probe = value['registryProbeImage']
    reject(isinstance(probe, str) and DIGEST.fullmatch(probe) and probe.startswith(value['registryPrefix'] + '/'), 'TARGET_REGISTRY_PROBE_REQUIRED')
    reject(value['acrRegion'] == 'cn-hongkong', 'HK_REGION_REQUIRED')
    edition = value.get('acrEdition', 'enterprise')
    reject(edition in ('personal', 'enterprise'), 'INVALID_ACR_EDITION')
    if edition == 'personal':
        reject(value['acrInstanceId'] == '', 'PERSONAL_ACR_INSTANCE_MUST_BE_EMPTY')
    else:
        reject(isinstance(value['acrInstanceId'], str) and re.fullmatch(r'cri-[a-zA-Z0-9]+', value['acrInstanceId']), 'INVALID_ACR_INSTANCE')
    bases = value['baseImages']
    reject(isinstance(bases, dict) and set(bases) == {'node', 'python', 'postgres', 'redis'}, 'INVALID_BASE_SET')
    reject(all(isinstance(v, str) and DIGEST.fullmatch(v) for v in bases.values()), 'REVIEWED_DIGEST_REQUIRED')
    sources = value.get('packageSources', {})
    reject(isinstance(sources, dict) and sources.keys() <= DEFAULT_SOURCES.keys(), 'INVALID_PACKAGE_SOURCES')
    for url in sources.values():
        reject(isinstance(url, str), 'INVALID_PACKAGE_URL')
        parsed = urllib.parse.urlsplit(url)
        reject(parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment, 'INVALID_PACKAGE_URL')
    return {**value, 'packageSources': {**DEFAULT_SOURCES, **sources}}

def checkout(plan):
    reject(run(['git', 'rev-parse', 'HEAD']).strip() == plan['sourceRevision'], 'CHECKOUT_SHA_MISMATCH')
    reject(not run(['git', 'status', '--porcelain', '--untracked-files=all']).strip(), 'CHECKOUT_DIRTY')
    reject(run(['git', 'rev-parse', '--is-shallow-repository']).strip() == 'false', 'SHALLOW_CHECKOUT')
    config = run(['git', 'config', '--local', '--list']).lower()
    reject('extensions.partialclone=' not in config and '.promisor=true' not in config, 'PARTIAL_CHECKOUT')
    run(['git', 'fsck', '--full', '--no-reflogs'])
    run(['git', 'merge-base', '--is-ancestor', plan['sourceRevision'], 'origin/main'])

def load_plan(path):
    plan_bytes = Path(path).read_bytes()
    value = json.loads(plan_bytes)
    services = value.pop('services', None)
    plan = validate_input(value)
    reject(services == list(SERVICES), 'INVALID_SERVICE_MATRIX')
    checkout(plan)
    plan['_planSha256'] = hashlib.sha256(plan_bytes).hexdigest()
    return plan

@contextlib.contextmanager
def auth(plan):
    username, token = os.environ.get('ACR_USERNAME'), os.environ.get('ACR_TOKEN')
    reject(bool(username and token), 'ACR_AUTH_MISSING')
    with tempfile.TemporaryDirectory(prefix='wsx-docker-') as directory:
        env = dict(os.environ, DOCKER_CONFIG=directory, GIT_NO_LAZY_FETCH='1')
        for key in tuple(env):
            if key in ('ACR_TOKEN', 'ACR_USERNAME', 'ACR_PASSWORD', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'GITHUB_TOKEN', 'GH_TOKEN') or key.startswith(('ALIBABA_CLOUD_', 'ALIYUN_', 'ALICLOUD_')):
                env.pop(key, None)
        registry = plan['registryPrefix'].split('/')[0]
        try:
            run(['docker', 'login', '--username', username, '--password-stdin', registry], env, token)
            # A reviewed existing target-namespace manifest proves target read access.
            # Public external Redis is not evidence of authorization on this registry.
            probe = run(['docker', 'buildx', 'imagetools', 'inspect', plan['registryProbeImage']], env)
            match = re.search(r'^Digest:\s+(sha256:[a-f0-9]{64})\s*$', probe, re.M)
            reject(match and match[1] == plan['registryProbeImage'].split('@')[1], 'TARGET_REGISTRY_PROBE_MISMATCH')
            yield env
        finally:
            subprocess.run(['docker', 'logout', registry], env=env, capture_output=True, timeout=30)

def inspection(image, plan, service, env):
    run(['docker', 'pull', '--platform', plan['platform'], image], env)
    values = json.loads(run(['docker', 'image', 'inspect', image], env))
    reject(isinstance(values, list) and len(values) == 1, 'INVALID_IMAGE_INSPECTION')
    value = values[0]
    reject(value.get('Os', '') + '/' + value.get('Architecture', '') == plan['platform'], 'IMAGE_PLATFORM_MISMATCH')
    if service != 'redis':
        reject((value.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision') == plan['sourceRevision'], 'IMAGE_REVISION_MISMATCH')
        reject((value.get('Config', {}).get('Labels') or {}).get(BUILD_IDENTITY_LABEL) == build_identity(plan), 'IMAGE_BUILD_IDENTITY_MISMATCH')
    repository = image.split('@')[0] if '@' in image else image.rsplit(':', 1)[0]
    digests = set(v for v in value.get('RepoDigests', []) if v.startswith(repository + '@sha256:') and DIGEST.fullmatch(v))
    reject(len(digests) == 1, 'IMAGE_DIGEST_NOT_UNIQUE')
    digest = next(iter(digests))
    reject('@' not in image or image == digest, 'IMAGE_DIGEST_MISMATCH')
    registry = run(['docker', 'buildx', 'imagetools', 'inspect', digest], env)
    match = re.search(r'^Digest:\s+(sha256:[a-f0-9]{64})\s*$', registry, re.M)
    reject(match and digest.split('@')[1] == match[1], 'REGISTRY_DIGEST_MISMATCH')
    return digest

def build(plan, service, output):
    reject(service in SERVICES, 'INVALID_SERVICE')
    reject(isinstance(plan.get('_planSha256'), str) and re.fullmatch('[a-f0-9]{64}', plan['_planSha256']), 'EXACT_PLAN_HASH_REQUIRED')
    repository, dockerfile, context, bases = SERVICES[service]
    tag = plan['registryPrefix'] + '/' + repository + ':' + plan['sourceRevision']
    with auth(plan) as env:
        # Distinguish missing manifest from network/auth failures; never build on arbitrary pull errors.
        probe = subprocess.run(['docker', 'manifest', 'inspect', tag], env=env, capture_output=True, text=True, timeout=60)
        if probe.returncode == 0:
            digest = inspection(tag, plan, service, env)
        else:
            reject(bool(re.search(r'manifest unknown|no such manifest|MANIFEST_UNKNOWN', probe.stderr, re.I)), 'TAG_EXISTENCE_UNVERIFIED')
            args = {'SOURCE_REVISION': plan['sourceRevision']}
            mapping = {'node': 'NODE_IMAGE', 'python': 'PYTHON_IMAGE', 'postgres': 'PGVECTOR_IMAGE'}
            args.update({mapping[b]: plan['baseImages'][b] for b in bases})
            source_mapping = {'npmRegistry': 'NPM_REGISTRY', 'pypiIndexUrl': 'PYPI_INDEX_URL', 'aptMirror': 'APT_MIRROR', 'ageRepository': 'AGE_REPOSITORY'}
            args.update({source_mapping[k]: v for k, v in plan['packageSources'].items()})
            # Git archive excludes ignored/untracked files from the Docker context.
            # This also reproduces the existing isolated agent source context.
            with tempfile.TemporaryDirectory(prefix='wsx-source-') as directory:
                root = Path(directory)
                archive = root / 'source.tar'
                run(['git', 'archive', '--format=tar', '--output', str(archive), plan['sourceRevision']], env)
                source = root / 'checkout'
                source.mkdir()
                with tarfile.open(archive) as contents:
                    contents.extractall(source, filter='data')
                command = ['docker', 'buildx', 'build', '--load', '--platform', plan['platform'], '--label', BUILD_IDENTITY_LABEL + '=' + build_identity(plan), '-f', str(source / dockerfile), '-t', tag]
                for key, value in args.items():
                    command += ['--build-arg', key + '=' + value]
                run(command + [str(source / context)], env)
            for attempt in range(4):
                pushed = subprocess.run(['docker', 'push', tag], env=env, capture_output=True, text=True, timeout=3600)
                if pushed.returncode == 0:
                    break
                # Lost response after commit: verify exact registry artifact before retry.
                try:
                    inspection(tag, plan, service, env)
                    break
                except RuntimeError:
                    pass
                transient = re.search(r'429|500|502|503|504|unexpected\s+EOF|connection reset|i/o timeout|TLS handshake timeout|temporary failure|no such host|network is unreachable', pushed.stderr, re.I)
                reject(transient and attempt < 3, 'REGISTRY_PUSH_FAILED')
                time.sleep(2 ** (attempt + 1))
            digest = inspection(tag, plan, service, env)
        write(output, {k: plan[k] for k in ('sourceRevision', 'attemptId', 'platform')} | {'service': service, 'image': digest, 'planSha256': plan['_planSha256']})

def aggregate(plan, directory, output, control_config=None, control_sha256=None):
    reject(isinstance(plan.get('_planSha256'), str) and re.fullmatch('[a-f0-9]{64}', plan['_planSha256']), 'EXACT_PLAN_HASH_REQUIRED')
    images = {}
    files = list(Path(directory).rglob('*.json'))
    reject(len(files) == len(SERVICES), 'RESULT_COUNT_MISMATCH')
    for path in files:
        value = read(path)
        reject(isinstance(value, dict) and set(value) == {'service', 'image', 'sourceRevision', 'attemptId', 'platform', 'planSha256'}, 'INVALID_RESULT_FIELDS')
        service = value['service']
        reject(service in SERVICES and service not in images, 'DUPLICATE_OR_UNKNOWN_SERVICE')
        reject(all(value[k] == plan[k] for k in ('sourceRevision', 'attemptId', 'platform')), 'RESULT_IDENTITY_MISMATCH')
        reject(value['planSha256'] == plan.get('_planSha256'), 'RESULT_PLAN_MISMATCH')
        image = value['image']
        reject(isinstance(image, str) and DIGEST.fullmatch(image) and image.split('@')[0] == plan['registryPrefix'] + '/' + SERVICES[service][0], 'RESULT_NAMESPACE_MISMATCH')
        images[service] = {'image': image}
    images['redis'] = {'image': plan['baseImages']['redis']}
    target = Path(output)
    target.mkdir(parents=True, exist_ok=False)
    # Independently pinned control closure is admitted before any registry access.
    with control.canonical_snapshot(control_config, control_sha256) as canonical, auth(plan) as env:
        for service, artifact in images.items():
            inspection(artifact['image'], plan, service, env)
        build_input = {k: plan[k] for k in ('schemaVersion', 'release', 'sourceRevision', 'platform')} | {'images': images}
        write(target / 'build-input.json', build_input)
        cli_env = control.canonical_environment(env)
        target = target.resolve()
        node = canonical['nodeExecutable']
        run([node, '--import', 'tsx', 'packages/cloud-deploy/src/release-manifest-cli.ts', str(target / 'build-input.json'), str(target / 'release.json')], cli_env, cwd=canonical['directory'])
        run([node, '--import', 'tsx', 'packages/cloud-deploy/src/release-candidate-cli.ts', 'seal', str(target / 'release.json'), str(target / 'release.sealed.json')], cli_env, cwd=canonical['directory'])
        run([node, '--import', 'tsx', 'packages/cloud-deploy/src/release-candidate-cli.ts', 'validate', str(target / 'release.json'), str(target / 'release.sealed.json'), plan['sourceRevision']], cli_env, cwd=canonical['directory'])
        plan_sha256 = plan['_planSha256']
        reject(isinstance(plan_sha256, str) and re.fullmatch('[a-f0-9]{64}', plan_sha256), 'EXACT_PLAN_HASH_REQUIRED')
        receipt = {k: plan[k] for k in ('release', 'platform', 'registryPrefix', 'acrRegion', 'acrInstanceId', 'attemptId', 'sourceRevision')}
        issued = datetime.now(timezone.utc)
        receipt.update(
            schemaVersion=1, receiptKind='hosted-artifact-build-draft-v1', stage='hosted-artifact-build',
            manifestSha256=hashlib.sha256((target / 'release.json').read_bytes()).hexdigest(),
            sealSha256=hashlib.sha256((target / 'release.sealed.json').read_bytes()).hexdigest(),
            planSha256=plan_sha256, controlToolSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            canonicalControlSha256=canonical['configurationSha256'], canonicalNodeSha256=canonical['nodeSha256'],
            canonicalVerifierSha256=hashlib.sha256(_control_path.read_bytes()).hexdigest(),
            issuedAt=issued.isoformat(), expiresAt=(issued + timedelta(hours=1)).isoformat(), clockSource='runner-system-clock-unattested',
            services=list(SERVICES) + ['redis'], artifactsVerified=True,
            ready=False, prepared=False, productionActivated=False)
        if plan.get('acrEdition', 'enterprise') == 'personal':
            receipt.update(receiptKind='hosted-personal-artifact-only-v1', acrEdition='personal', productionHandoffSupported=False)
        write(target / 'artifact-build.json', receipt)

def main(argv=None):
    parser = argparse.ArgumentParser()
    subs = parser.add_subparsers(dest='command', required=True)
    validate = subs.add_parser('validate'); validate.add_argument('--input', required=True); validate.add_argument('--output', required=True)
    for name in ('build', 'aggregate'):
        sub = subs.add_parser(name); sub.add_argument('--plan', required=True); sub.add_argument('--output', required=True)
        sub.add_argument('--service' if name == 'build' else '--results', required=True)
        if name == 'aggregate':
            sub.add_argument('--control', required=True)
            sub.add_argument('--control-sha256', required=True)
    args = parser.parse_args(argv)
    if args.command == 'validate':
        plan = validate_input(read(args.input)); checkout(plan); write(args.output, plan | {'services': list(SERVICES)})
    elif args.command == 'build':
        build(load_plan(args.plan), args.service, args.output)
    else:
        aggregate(load_plan(args.plan), args.results, args.output, args.control, args.control_sha256)

if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError, KeyError, TypeError):
        # Fixed failure output; no raw credential/provider exception strings.
        print('HOSTED_RELEASE_FAILED', file=__import__('sys').stderr)
        raise SystemExit(1)
