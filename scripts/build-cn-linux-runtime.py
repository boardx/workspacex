#!/usr/bin/env python3
"""Build proposal material on an isolated Linux CI runner; never install it."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

PLAN = '.github/release-plans/linux-runtime-package'
SOURCES = ['scripts/build-cn-business-runtime.cjs', 'scripts/cn-release-business-entry.ts',
           'scripts/cn-release-business-runner.ts', '.harness/scripts/vm/cn-maintenance-browser.cjs',
           'packages/cloud-deploy/src/cn-release-browser-contract.ts',
           'packages/cloud-deploy/src/cn-maintenance-host/acceptance_contract.ts']

def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for block in iter(lambda: f.read(1048576), b''):
            h.update(block)
    return h.hexdigest()

def write(p, value):
    with open(p, 'x') as f:
        json.dump(value, f, indent=2, sort_keys=True)
        f.write('\n')
    os.chmod(p, 0o600)

def run(args, **kw):
    try:
        return subprocess.run([str(x) for x in args], check=True, timeout=900,
                              text=True, capture_output=True, **kw).stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        # No raw tool output: even dependency tools may inherit authenticated URLs.
        raw = error.stderr or b''
        if isinstance(raw, str):
            raw = raw.encode('utf-8', errors='replace')
        print(json.dumps({'stageCommand': Path(str(args[0])).name, 'failure': type(error).__name__,
                          'exitCode': getattr(error, 'returncode', None),
                          'stderrBytes': len(raw), 'stderrSha256': hashlib.sha256(raw).hexdigest()}), file=sys.stderr)
        raise RuntimeError('BUILD_STEP_FAILED') from None

def tree(root, limit, chrome_relative=None):
    if chrome_relative is not None and (limit != 256 * 1024**2 or chrome_relative not in ('chrome', 'chromium/chrome')):
        raise ValueError('CHROME_EXCEPTION_SCOPE')
    result = {}
    for p in sorted(root.rglob('*')):
        s = p.lstat()
        if stat.S_ISLNK(s.st_mode) or not (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)):
            raise ValueError('SPECIAL_OR_LINK')
        if s.st_mode & 0o022:
            raise ValueError('WRITABLE_TREE')
        if p.is_file():
            file_limit = 512 * 1024**2 if p.relative_to(root).as_posix() == chrome_relative else limit
            if s.st_nlink != 1 or s.st_size > file_limit:
                print(json.dumps({'stage': 'tree-admission', 'tree': root.name, 'fileBytes': s.st_size,
                                  'fileLimitBytes': file_limit, 'linkCount': s.st_nlink}), file=sys.stderr)
                raise ValueError('FILE_BOUND_OR_HARDLINK')
            result[p.relative_to(root).as_posix()] = sha(p)
    if not result:
        raise ValueError('EMPTY_TREE')
    return result

def normalize(root):
    for p in [root, *root.rglob('*')]:
        s = p.lstat()
        if stat.S_ISLNK(s.st_mode) or not (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)):
            raise ValueError('SPECIAL_OR_LINK')
        if p.is_file() and s.st_nlink != 1:
            raise ValueError('HARDLINK')
        p.chmod(0o700 if p.is_dir() or s.st_mode & 0o111 else 0o600)

def download(url, expected, dest, bound):
    if not re.fullmatch('[0-9a-f]{64}', expected):
        raise ValueError('HASH')
    allowed = ('https://nodejs.org/', 'https://files.pythonhosted.org/')
    if not url.startswith(allowed):
        raise ValueError('DOWNLOAD_ORIGIN')
    with urllib.request.urlopen(url, timeout=60) as response, open(dest, 'xb') as f:
        if not response.url.startswith(allowed):
            raise ValueError('REDIRECT_ORIGIN')
        size = 0
        while block := response.read(1048576):
            size += len(block)
            if size > bound:
                raise ValueError('DOWNLOAD_BOUND')
            f.write(block)
    if sha(dest) != expected:
        raise ValueError('DOWNLOAD_HASH')

def node_extract(archive, dest):
    # Only the exact two required ordinary members; npm is a CI build tool.
    with tarfile.open(archive) as tf:
        for name, target in [('node-v22.20.0-linux-x64/bin/node', 'node'),
                             ('node-v22.20.0-linux-x64/LICENSE', 'LICENSE')]:
            members = [m for m in tf.getmembers() if m.name == name]
            if len(members) != 1 or not members[0].isfile() or members[0].size > 150 * 1024**2:
                raise ValueError('NODE_ARCHIVE_MEMBER')
            with tf.extractfile(members[0]) as src, open(dest / target, 'xb') as out:
                shutil.copyfileobj(src, out)
    (dest / 'node').chmod(0o700)

def verify_recipe(root, expected):
    manifest = root / PLAN / 'recipe-files.json'
    if sha(manifest) != expected:
        raise ValueError('RECIPE_HASH')
    rows = json.loads(manifest.read_text())
    required = set(SOURCES + ['scripts/build-cn-linux-runtime.py', 'scripts/check-cn-linux-runtime.py',
        '.github/workflows/cn-linux-runtime-package.yml', 'tests/test_cn_linux_runtime_package.py',
        'docs/operations/cn-release-entry/linux-runtime-package.md', 'scripts/cn-release-business-state.py',
        'tests/test_cn_release_business_state.py'] + [PLAN + '/' + name for name in
        ['package.json', 'package-lock.json', 'rds-requirements.lock', 'rds-sources.json', 'build-tools.lock', 'upstream.json']])
    if not isinstance(rows, dict) or set(rows) != required:
        raise ValueError('RECIPE_CLOSURE')
    for name, digest in rows.items():
        if Path(name).is_absolute() or '..' in Path(name).parts or sha(root / name) != digest:
            raise ValueError('RECIPE_FILE')
    return rows

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--control-sha', required=True)
    ap.add_argument('--recipe-sha256', required=True)
    ap.add_argument('--output', type=Path, required=True)
    a = ap.parse_args()
    root = Path(__file__).resolve().parent.parent
    if platform.system() != 'Linux' or platform.machine() != 'x86_64' or sys.version_info[:2] != (3, 12):
        raise ValueError('LINUX_X64_CP312_REQUIRED')
    if not re.fullmatch('[0-9a-f]{40}', a.control_sha) or run(['git', 'rev-parse', 'HEAD'], cwd=root) != a.control_sha:
        raise ValueError('CONTROL_IDENTITY')
    if run(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=root):
        raise ValueError('CONTROL_DIRTY')
    recipe = verify_recipe(root, a.recipe_sha256)
    pins = json.loads((root / PLAN / 'upstream.json').read_text())
    out = a.output.resolve()
    out.mkdir(mode=0o700)  # exclusive: no overwrite or retry into partial output
    with tempfile.TemporaryDirectory(prefix='cn-runtime-') as temp:
        work = Path(temp)
        (out / 'node').mkdir(mode=0o700)
        archive = work / 'node.tar.xz'
        download(pins['nodeUrl'], pins['nodeSha256'], archive, 100 * 1024**2)
        node_extract(archive, out / 'node')
        node = out / 'node/node'
        if run([node, '--version']) != 'v22.20.0':
            raise ValueError('NODE_VERSION')
        deps = work / 'deps'
        deps.mkdir()
        for name in ['package.json', 'package-lock.json']:
            shutil.copyfile(root / PLAN / name, deps / name)
        env = dict(os.environ, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1', npm_config_cache=str(work / 'npm-cache'),
                   NODE_PATH=str(deps / 'node_modules'), PYTHONDONTWRITEBYTECODE='1')
        # setup-node provides npm only; all runtime/build JS executes with the proposed Node.
        npm_cli = Path(shutil.which('npm')).resolve()
        run([node, npm_cli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=deps, env=env)
        staged = work / 'source'
        staged.mkdir()
        for name in SOURCES:
            (staged / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / name, staged / name)
        (staged / 'node_modules').symlink_to(deps / 'node_modules', target_is_directory=True)
        run([node, staged / SOURCES[0], out / 'business', deps / 'node_modules/playwright'], env=env)
        browser = run([node, '-e', "process.stdout.write(require('playwright').chromium.executablePath())"],
                      env=dict(env, PLAYWRIGHT_BROWSERS_PATH='/ms-playwright'), cwd=deps)
        if not re.fullmatch(r'/ms-playwright/chromium-\d+/(chrome-linux|chrome-linux64)/chrome', browser):
            raise ValueError('CHROMIUM_PATH')
        image = pins['chromiumImage']
        if not re.fullmatch(r'mcr.microsoft.com/playwright@sha256:[0-9a-f]{64}', image):
            raise ValueError('IMAGE_PIN')
        run(['docker', 'pull', '--platform', 'linux/amd64', image])
        if run(['docker', 'image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', image]) != 'linux/amd64':
            raise ValueError('IMAGE_ARCHITECTURE')
        container = run(['docker', 'create', '--network', 'none', image, '/bin/true'])
        try:
            run(['docker', 'cp', container + ':' + str(Path(browser).parent) + '/.', out / 'chromium'])
        finally:
            run(['docker', 'rm', container])
        venv = work / 'venv'
        run([sys.executable, '-m', 'venv', venv])
        py = venv / 'bin/python'
        run([py, '-m', 'pip', 'install', '--require-hashes', '--no-deps', '-r', root / PLAN / 'build-tools.lock'])
        sources = json.loads((root / PLAN / 'rds-sources.json').read_text())
        local = []
        for row in sources:
            file = work / row['filename']
            if file.parent != work:
                raise ValueError('SOURCE_NAME')
            download(row['url'], row['sha256'], file, row['bytes'])
            if file.stat().st_size != row['bytes']:
                raise ValueError('SOURCE_SIZE')
            local.append(str(file) + ' --hash=sha256:' + row['sha256'])
        req = work / 'local.lock'
        req.write_text('\n'.join(local) + '\n')
        run([py, '-m', 'pip', 'install', '--no-index', '--no-deps', '--no-build-isolation', '--no-compile',
             '--require-hashes', '--target', out / 'rds-sdk', '-r', req])
        run([py, '-I', '-B', root / 'scripts/check-cn-linux-runtime.py', out])
        normalize(out)
        business = tree(out / 'business', 256 * 1024**2)
        # Match the consumer's existing 512 MiB pin only for the exact Chrome executable.
        print(json.dumps({'stage': 'chromium-size-admission',
                          'chromiumBytes': (out / 'chromium/chrome').stat().st_size,
                          'fileLimitBytes': 512 * 1024**2}), flush=True)
        chromium = tree(out / 'chromium', 256 * 1024**2, 'chrome')
        sdk = tree(out / 'rds-sdk', 32 * 1024**2)
        sdk_manifest = {'kind': 'cn-rds-sdk-manifest-v1', 'sdkRoot': '/usr/local/lib/workspacex-cn/rds-sdk', 'filesSha256': sdk}
        if len(sdk) > 10000 or len(json.dumps(sdk_manifest).encode()) > 1024**2:
            raise ValueError('SDK_MANIFEST_BOUND')
        write(out / 'rds-sdk-manifest.json', sdk_manifest)
        write(out / 'proposal.json', {'kind': 'cn-linux-runtime-proposal-v1', 'controlSha': a.control_sha,
              'recipeSha256': a.recipe_sha256, 'recipeFiles': recipe, 'installationPerformed': False,
              'productionProfileReady': False, 'requiredTargetFacts': ['pythonSha256', 'dockerSha256', 'holdHelperSha256',
                  'installedNodePathAndSha256', 'rootOwnershipAndTargetCompatibility'],
              'proposedNodeSha256': sha(node), 'businessFilesSha256': business, 'chromiumFilesSha256': chromium,
              'chromiumBytes': (out / 'chromium/chrome').stat().st_size,
              'target': pins['target'], 'smokePassed': True})
        files = tree(out, 256 * 1024**2, 'chromium/chrome')
        file_manifest = out.parent / (out.name + '.files.json')
        write(file_manifest, files)
        packed = out.parent / (out.name + '.tar.gz')
        with tarfile.open(packed, 'x:gz') as tf:
            tf.add(out, arcname=out.name)
            tf.add(file_manifest, arcname=file_manifest.name)
        summary = {'kind': 'cn-linux-runtime-build-summary-v1', 'controlSha': a.control_sha,
            'recipeSha256': a.recipe_sha256, 'tarSha256': sha(packed), 'tarBytes': packed.stat().st_size,
            'fileManifestSha256': sha(file_manifest), 'treeFileCount': len(files),
            'chromiumBytes': (out / 'chromium/chrome').stat().st_size,
            'smoke': {'builtEntryRejectionProtocol': True, 'chromiumRenderAndClick': True,
                      'rdsOfflineImports': True, 'installedDependencyClosure': True},
            'installationPerformed': False, 'productionProfileReady': False}
        if len(json.dumps(summary).encode()) > 256 * 1024:
            raise ValueError('SUMMARY_BOUND')
        write(out.parent / (out.name + '.summary.json'), summary)

if __name__ == '__main__':
    main()
