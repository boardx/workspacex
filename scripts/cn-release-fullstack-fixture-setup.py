#!/usr/bin/env python3
"""GitHub Linux-only workspace dependency preparation for actual startApi tests.

Call once inside the root-owned disposable exact-source clone, before rounds.
The caller builds the repository PostgreSQL AGE/vector Dockerfile once and passes
its immutable local image ID. This helper never pulls/builds/runs containers.
Per-round databases/containers belong exclusively to the startup test owner.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import stat
import subprocess
import sys
import time


def need(value, code):
    if not value: raise RuntimeError(code)


def prepare(repo, output, image):
    need(sys.platform == 'linux' and os.geteuid() == 0 and os.environ.get('GITHUB_ACTIONS') == 'true'
         and re.fullmatch('[0-9]+', os.environ.get('GITHUB_RUN_ID', '')), 'GITHUB_LINUX_ROOT_ONLY')
    need(repo.is_absolute() and repo.resolve(strict=True) == repo, 'EXACT_PRIVATE_CHECKOUT_REQUIRED')
    for parent in (repo, *repo.parents):
        info = parent.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'PRIVATE_CHECKOUT_OWNER')
    need(re.fullmatch('sha256:[a-f0-9]{64}', image), 'IMMUTABLE_LOCAL_IMAGE_ID_REQUIRED')
    need(not output.exists() and output.is_absolute() and output.parent.resolve(strict=True) == output.parent,
         'NEW_OUTPUT_DIRECTORY_REQUIRED')
    need(not output.is_relative_to(repo), 'OUTPUT_MUST_BE_OUTSIDE_CHECKOUT')
    for parent in (output.parent, *output.parent.parents):
        info = parent.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'PRIVATE_OUTPUT_OWNER')
    output.mkdir(mode=0o700); home = output / 'home'; home.mkdir(mode=0o700)
    env = {'PATH': os.environ.get('PATH', os.defpath), 'HOME': str(home), 'LANG': 'C.UTF-8',
           'CI': 'true', 'GIT_TERMINAL_PROMPT': '0', 'GIT_CONFIG_NOSYSTEM': '1',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'DOCKER_CONFIG': str(home / '.docker')}
    def read(command):
        value = subprocess.check_output(command, cwd=repo, env=env, timeout=30, stderr=subprocess.DEVNULL)
        need(len(value) <= 65536, 'PREFLIGHT_OUTPUT_LIMIT')
        return value.decode().strip()
    started = time.monotonic()
    commit = read(['/usr/bin/git', 'rev-parse', 'HEAD'])
    need(re.fullmatch('[a-f0-9]{40}', commit), 'FIXED_COMMIT_REQUIRED')
    need(not read(['/usr/bin/git', 'status', '--porcelain', '--untracked-files=all']), 'CLEAN_SOURCE_REQUIRED')
    node = shutil.which('node', path=env['PATH']); pnpm = shutil.which('pnpm', path=env['PATH'])
    docker = shutil.which('docker', path=env['PATH'])
    need(node and pnpm and docker, 'EXISTING_CI_TOOLS_REQUIRED')
    package = json.loads((repo / 'package.json').read_text())
    need(package['packageManager'] == 'pnpm@' + read([pnpm, '--version']), 'PNPM_VERSION_MISMATCH')
    need(read([node, '--version']).split('.')[0] == 'v' + (repo / '.nvmrc').read_text().strip(), 'NODE_MAJOR_MISMATCH')
    actual = json.loads(read([docker, 'image', 'inspect', image, '--format', '{{json .}}']))
    need(actual['Id'] == image and actual['Os'] == 'linux' and actual['Architecture'] == 'amd64', 'PG_IMAGE_IDENTITY')
    need((actual.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision') == commit,
         'PG_IMAGE_SOURCE_REVISION_MISMATCH')
    lock_before = hashlib.sha256((repo / 'pnpm-lock.yaml').read_bytes()).hexdigest()
    need(not (repo / 'node_modules').exists(), 'FRESH_CLONE_DEPENDENCIES_REQUIRED')
    spec = importlib.util.spec_from_file_location('owned_domain', Path(__file__).with_name('cn_release_simulation_domain.py'))
    module = importlib.util.module_from_spec(spec)
    # Loading the helper must not create untracked __pycache__ in the exact clone.
    previous_bytecode = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous_bytecode
    domain = module.Domain(); process = None; cleanup = None; install_start = time.monotonic()
    try:
        process = domain.spawn([pnpm, 'install', '--frozen-lockfile', '--reporter=append-only',
                                '--store-dir', str(output / 'pnpm-store')], cwd=repo, env=env,
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               start_new_session=True)
        with (output / 'install.log').open('xb') as log:
            selector = selectors.DefaultSelector(); selector.register(process.stdout, selectors.EVENT_READ)
            total = 0
            try:
                while True:
                    need(time.monotonic() - install_start < 600, 'INSTALL_TIMEOUT')
                    if not selector.select(.1): continue
                    block = os.read(process.stdout.fileno(), 65536)
                    if not block: break
                    total += len(block); need(total <= 16 * 1024 * 1024, 'INSTALL_LOG_LIMIT')
                    log.write(block)
                need(process.wait(timeout=max(.01, 600 - (time.monotonic() - install_start))) == 0, 'WORKSPACE_INSTALL_FAILED')
            finally: selector.close()
    finally:
        try: cleanup = domain.close(process)
        finally:
            if process is not None and process.stdout is not None: process.stdout.close()
    install_seconds = time.monotonic() - install_start
    need(isinstance(cleanup, dict) and cleanup.get('verified') is True, 'INSTALL_CLEANUP_UNPROVEN')
    need(lock_before == hashlib.sha256((repo / 'pnpm-lock.yaml').read_bytes()).hexdigest(), 'LOCKFILE_CHANGED')
    need(read(['/usr/bin/git', 'rev-parse', 'HEAD']) == commit and
         not read(['/usr/bin/git', 'status', '--porcelain', '--untracked-files=all']), 'SOURCE_CHANGED')
    # Resolve from the real API workspace. Importing main/startApi belongs to the
    # per-round test only, after that test has created its fresh fixture database.
    resolved = json.loads(read([node, '--input-type=module', '-e',
        "import{createRequire}from'node:module';const r=createRequire(process.cwd()+'/apps/api/package.json');"
        "console.log(JSON.stringify({tsx:r.resolve('tsx'),pg:r.resolve('pg'),nest:r.resolve('@nestjs/core')}));"]))
    result = {'kind': 'cn-api-startup-fixture-setup-v1', 'prepared': True, 'commit': commit,
              'lockfileSha256': lock_before, 'postgresDockerfileSha256': hashlib.sha256((repo / 'apps/api/docker/postgres-age/Dockerfile').read_bytes()).hexdigest(),
              'postgresImageId': image, 'node': str(Path(node).resolve()), 'workspace': str(repo),
              'resolvedModules': resolved, 'dependencyInstallSeconds': round(install_seconds, 3),
              'totalSetupSeconds': round(time.monotonic() - started, 3), 'installProcessCleanup': cleanup,
              'roundDatabaseCreated': False, 'containersStarted': False, 'productionAccepted': False,
              'environment': {'CN_API_STARTUP_PG_IMAGE': image, 'CN_API_STARTUP_NODE': str(Path(node).resolve())},
              'cleanupOwner': 'Caller removes only its owned disposable clone/output after all rounds; dependency image is retained job-local.'}
    with (output / 'setup.json').open('x') as stream:
        json.dump(result, stream, sort_keys=True); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pg-image', required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.repo, args.output, args.pg_image), sort_keys=True))


if __name__ == '__main__': main()
