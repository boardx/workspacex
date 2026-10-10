#!/usr/bin/env python3
"""Prepare a review-only Linux-x64 canonical closure; never installs or executes it."""
import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile

SOURCES = ('package.json', 'packages/cloud-deploy/package.json',
    'packages/cloud-deploy/src/release.ts', 'packages/cloud-deploy/src/image-reference.ts',
    'packages/cloud-deploy/src/release-manifest.ts', 'packages/cloud-deploy/src/release-manifest-cli.ts',
    'packages/cloud-deploy/src/release-candidate.ts', 'packages/cloud-deploy/src/release-candidate-cli.ts')
DEPENDENCIES = {'tsx': '4.20.6', 'zod': '3.25.76'}
MAX_FILE = 160 * 1024**2
MAX_TOTAL = 256 * 1024**2


def need(value, code):
    if not value: raise ValueError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def encoded(value): return (json.dumps(value, sort_keys=True, indent=2)+'\n').encode()


def regular(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as handle:
        before = os.fstat(handle.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
             and 0 <= before.st_size <= MAX_FILE, 'RUNTIME_FILE_TYPE_SIZE')
        content = handle.read(MAX_FILE + 1)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(len(content) <= MAX_FILE and identity(before) == identity(os.fstat(handle.fileno()))
             == identity(path.lstat()), 'RUNTIME_FILE_CHANGED')
        return content


def linux_x64(raw):
    need(len(raw) >= 20 and raw[:6] == b'\x7fELF\x02\x01'
         and raw[18:20] == b'\x3e\x00', 'LINUX_X64_EXECUTABLE_REQUIRED')


def source_files(repo, revision):
    need(re.fullmatch('[a-f0-9]{40}', revision), 'EXACT_CONTROL_REQUIRED')
    env = dict(os.environ, GIT_NO_LAZY_FETCH='1', GIT_NO_REPLACE_OBJECTS='1',
               GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0')
    # No working tree bytes, dependency installation, Git hooks or moving refs.
    result = {}
    for name in SOURCES:
        command = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
                   '-C', str(repo), 'show', revision+':'+name]
        run = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        need(run.returncode == 0 and 0 < len(run.stdout) <= 1024**2, 'CONTROL_SOURCE_UNAVAILABLE')
        result[name] = run.stdout
    return result


def runtime_files(runtime, lock_sha, tarballs):
    root = Path(runtime).resolve(strict=True)
    lock_raw = regular(root/'package-lock.json')
    need(sha(lock_raw) == lock_sha, 'RUNTIME_LOCK_HASH')
    lock = json.loads(lock_raw); package_raw = regular(root/'package.json'); package = json.loads(package_raw)
    need(package.get('dependencies') == DEPENDENCIES
         and lock.get('lockfileVersion') == 3 and lock['packages']['']['dependencies'] == DEPENDENCIES,
         'RUNTIME_PINNED_DEPENDENCIES')
    modules = root/'node_modules'; need(modules.is_dir() and not modules.is_symlink(), 'RUNTIME_MODULES')
    allowed = {'tsx', 'zod', 'esbuild', 'get-tsconfig', 'resolve-pkg-maps', '@esbuild/linux-x64'}
    need({p.name for p in modules.iterdir()} <= {'.bin','.package-lock.json','@esbuild',
         'tsx','zod','esbuild','get-tsconfig','resolve-pkg-maps'}, 'RUNTIME_EXTRA_ROOT')
    need({p.name for p in (modules/'@esbuild').iterdir()} == {'linux-x64'}, 'RUNTIME_NATIVE_SET')
    need({p.name for p in (modules/'.bin').iterdir()} == {'tsx','esbuild'}, 'RUNTIME_SHIM_SET')
    result = {'control-runtime.package-lock.json': lock_raw, 'control-runtime.package.json': package_raw}
    provenance = {}
    for name in sorted(allowed):
        item = lock['packages']['node_modules/'+name]; version = item['version']
        if name in DEPENDENCIES: need(version == DEPENDENCIES[name], 'RUNTIME_PACKAGE_VERSION')
        filename = name.replace('@','').replace('/','-')+'-'+version+'.tgz'
        packed = regular(Path(tarballs)/filename)
        integrity = 'sha512-'+base64.b64encode(hashlib.sha512(packed).digest()).decode()
        need(item.get('integrity') == integrity, 'RUNTIME_TARBALL_INTEGRITY')
        expected = {}
        with tarfile.open(fileobj=io.BytesIO(packed),mode='r:gz') as archive:
            for entry in archive:
                need(entry.name.startswith('package/') and entry.isfile() and entry.name not in expected
                     and not entry.pax_headers and 0 <= entry.size <= MAX_FILE, 'RUNTIME_TARBALL_MEMBER')
                relative=entry.name[len('package/'):]
                need(relative and not Path(relative).is_absolute() and '..' not in Path(relative).parts
                     and '\\' not in relative, 'RUNTIME_TARBALL_PATH')
                need(relative not in expected, 'RUNTIME_TARBALL_DUPLICATE')
                expected[relative]=archive.extractfile(entry).read(MAX_FILE+1)
        installed=modules/name
        need(installed.is_dir() and not installed.is_symlink(), 'RUNTIME_PACKAGE_DIRECTORY')
        actual={}
        for path in installed.rglob('*'):
            need(not path.is_symlink(), 'RUNTIME_PACKAGE_SYMLINK')
            if path.is_dir(): continue
            actual[path.relative_to(installed).as_posix()]=regular(path)
        need(actual == expected, 'RUNTIME_INSTALLED_BYTES_MISMATCH')
        info=json.loads(expected['package.json'])
        need(info.get('name') == name and info.get('version') == version, 'RUNTIME_PACKAGE_IDENTITY')
        result.update({'node_modules/'+name+'/'+key:value for key,value in expected.items()})
        provenance[name]={'version':version,'integrity':integrity,'tarballSha256':sha(packed),'fileCount':len(expected)}
    for shim,target in {'tsx':'tsx/dist/cli.mjs','esbuild':'esbuild/bin/esbuild'}.items():
        path=modules/'.bin'/shim
        need(path.is_symlink() and path.resolve() == (modules/target).resolve(), 'RUNTIME_SHIM_TARGET')
        result['node_modules/.bin/'+shim]=regular(path.resolve())
    linux_x64(result['node_modules/@esbuild/linux-x64/bin/esbuild'])
    return result, provenance


def produce(repo, revision, node_path, node_sha, runtime, lock_sha, tarballs, source, attempt, output):
    need(re.fullmatch('[a-f0-9]{40}', source) and re.fullmatch('[a-z0-9][a-z0-9-]{0,63}', attempt),
         'CANDIDATE_IDENTITY')
    need(re.fullmatch('[a-f0-9]{64}', node_sha) and re.fullmatch('[a-f0-9]{64}', lock_sha), 'EXTERNAL_HASH_REQUIRED')
    node = regular(node_path); need(sha(node) == node_sha, 'NODE_HASH'); linux_x64(node)
    sources = source_files(repo, revision)
    dependencies, dependency_provenance = runtime_files(runtime, lock_sha, tarballs)
    closure = dict(sources, **dependencies)
    need(len(closure) <= 4096 and len(node)+sum(len(x) for x in closure.values()) <= MAX_TOTAL, 'RUNTIME_TOTAL_LIMIT')
    target = '/etc/workspacex-cn/candidate-publish/'+source+'/'+attempt
    config = dict(schemaVersion=1, nodeExecutable=target+'/node', nodeSha256=node_sha,
                  checkoutDirectory=target+'/canonical-source', fileSha256={k:sha(v) for k,v in sorted(closure.items())})
    payload = {'canonical-control.json': encoded(config)}
    payload.update({'canonical-source/'+k:v for k,v in closure.items()})
    manifest = dict(kind='cn-candidate-canonical-runtime-review-v1', schemaVersion=1,
        controlRevision=revision, sourceRevision=source, buildAttemptId=attempt,
        architecture='linux/amd64', targetDirectory=target, runtimeDependencies=DEPENDENCIES,
        runtimeLockSha256=lock_sha, nodeSha256=node_sha,
        existingNode=dict(path='/usr/bin/node',sha256=node_sha,size=len(node),mode='0755'),
        dependencyProvenance=dependency_provenance, canonicalConfigurationSha256=sha(payload['canonical-control.json']),
        sourceFiles={k:sha(v) for k,v in sources.items()},
        files={k:dict(sha256=sha(v), size=len(v), mode='0600' if k=='canonical-control.json' else '0700')
               for k,v in sorted(payload.items())},
        reviewStatus='draft-unapproved', installed=False, runtimeExecuted=False, prepared=False, productionActivated=False)
    out = Path(output); out.mkdir(parents=False, exist_ok=False)
    # Exact hashes are available outside the archive for independent review.
    (out/'manifest.json').write_bytes(encoded(manifest))
    tar_path = out/'runtime.tar.gz'
    with tar_path.open('xb') as target_file:
        with gzip.GzipFile(fileobj=target_file, mode='wb', mtime=0, filename='') as compressed:
            with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.USTAR_FORMAT) as archive:
                for name, raw in sorted(payload.items()):
                    entry=tarfile.TarInfo(name); entry.size=len(raw); entry.mode=int(manifest['files'][name]['mode'],8)
                    entry.uid=entry.gid=entry.mtime=0
                    archive.addfile(entry,io.BytesIO(raw))
    receipt = dict(manifestSha256=sha((out/'manifest.json').read_bytes()),
                   packageSha256=sha(tar_path.read_bytes()), packageBytes=tar_path.stat().st_size,
                   canonicalConfigurationSha256=manifest['canonicalConfigurationSha256'], fileCount=len(payload),
                   installed=False, runtimeExecuted=False)
    (out/'package-receipt.json').write_bytes(encoded(receipt))
    return receipt


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for field in ('repo','control','node','node-sha','runtime','lock-sha','tarballs','source','attempt','output'):
        parser.add_argument('--'+field,required=True)
    args=parser.parse_args()
    print(json.dumps(produce(args.repo,args.control,args.node,args.node_sha,args.runtime,args.lock_sha,args.tarballs,
                             args.source,args.attempt,args.output),sort_keys=True))

if __name__=='__main__':
    try: main()
    except Exception:
        print('CN_CANDIDATE_RUNTIME_PACKAGE_REJECTED',file=__import__('sys').stderr)
        raise SystemExit(1)
