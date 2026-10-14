#!/usr/bin/env python3
"""Produce an immutable Linux source/dependency package; never install it."""
import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

HEX = re.compile(r'[a-f0-9]{40}')
ADAPTERS = ('apps/api/scripts/platform-content-release.ts',
            'apps/api/scripts/platform-content-release-core.ts',
            'apps/api/scripts/platform-schema-readback.ts',
            'apps/api/scripts/platform-schema-readback-core.ts',
            'apps/api/src/infrastructure/db/pg-config.ts',
            'apps/api/src/infrastructure/db/pg-database.ts',
            'packages/cloud-deploy/src/release-manifest-cli.ts',
            'packages/cloud-deploy/src/release-candidate-cli.ts',
            'packages/cloud-deploy/src/cn-candidate-compose-source-cli.ts',
            'packages/cloud-deploy/src/cn-migration-completion-cli.ts')
MAX_FILE = 33554432
MAX_PACKAGE = 2147483648


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def run(args, cwd, data=None):
    result = subprocess.run(args, cwd=cwd, input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=180, check=False)
    if result.returncode:
        raise ValueError('PACKAGE_COMMAND_FAILED:' + Path(args[0]).name)
    return result.stdout


def relative(name):
    path = Path(name)
    if path.is_absolute() or '..' in path.parts or not path.parts:
        raise ValueError('PACKAGE_PATH')
    return path


def copy_file(root, name, dest):
    rel = relative(name); source = root / rel
    if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(root.resolve()):
        raise ValueError('PACKAGE_FILE_UNSAFE')
    if source.stat().st_size > MAX_FILE:
        raise ValueError('PACKAGE_FILE_LIMIT')
    target = dest / rel; target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes())
    target.chmod(0o700 if source.stat().st_mode & 0o111 else 0o600)


def source_files(root, revision):
    raw = run(['git', 'ls-tree', '-r', '-z', '--full-tree', revision,
               '--', 'apps/api/migrations', 'skills/starter-packs'], root)
    result = {}
    for record in raw.split(b'\0'):
        if not record: continue
        header, name = record.decode().split('\t', 1)
        mode, kind, blob = header.split()
        if mode != '100644' or kind != 'blob': raise ValueError('SOURCE_FILE_KIND')
        if not (name.endswith('.sql') or name.endswith('.json')): continue
        relative(name)
        result[name] = run(['git', 'show', revision + ':' + name], root)
    if not any(name.endswith('.sql') for name in result): raise ValueError('SOURCE_MIGRATIONS_EMPTY')
    return result


def minimal_git(root, revision, dest):
    """One exact commit and its complete tree/blob closure, with no old history/config."""
    if not HEX.fullmatch(revision): raise ValueError('GIT_REVISION')
    run(['git', 'cat-file', '-e', revision + '^{commit}'], root)
    objects = run(['git', 'rev-list', '--objects', '--no-object-names', revision + '^{tree}'], root)
    ids = [revision] + objects.decode().splitlines()
    if not all(HEX.fullmatch(value) for value in ids): raise ValueError('GIT_OBJECT_IDS')
    packed = run(['git', 'pack-objects', '--stdout'], root, ('\n'.join(ids) + '\n').encode())
    run(['git', 'init', '-q', str(dest)], root)
    git = dest / '.git'
    for child in git.iterdir():
        if child.name not in ('objects',):
            if child.is_dir(): shutil.rmtree(child)
            else: child.unlink()
    (git / 'refs').mkdir()
    (git / 'config').write_text('[core]\nrepositoryformatversion = 0\nbare = false\nfilemode = true\n')
    (git / 'HEAD').write_text(revision + '\n')
    (git / 'shallow').write_text(revision + '\n')
    run(['git', 'index-pack', '--stdin'], dest, packed)
    run(['git', 'read-tree', revision], dest)
    actual = run(['git', 'rev-parse', 'HEAD'], dest).decode().strip()
    if actual != revision: raise ValueError('GIT_STAGE_IDENTITY')
    run(['git', 'cat-file', '-e', revision + '^{tree}'], dest)
    return len(set(ids))


def manifest(root, exclude_git=False):
    root = root.resolve()
    result = {}
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if exclude_git and '.git' in rel.parts: continue
        if path.is_symlink():
            if not path.resolve().exists() or not path.resolve().is_relative_to(root):
                raise ValueError('PACKAGE_LINK_ESCAPE_OR_MISSING')
        if path.is_file(): result[str(rel)] = digest(path.read_bytes())
    return result


def make_archive(payload, archive):
    total = sum(path.stat().st_size for path in payload.rglob('*') if path.is_file() and not path.is_symlink())
    if total > MAX_PACKAGE: raise ValueError('PACKAGE_TOTAL_LIMIT')
    with archive.open('xb') as stream, gzip.GzipFile(fileobj=stream, mode='wb', mtime=0, filename='') as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.PAX_FORMAT) as tar:
            for path in sorted(payload.rglob('*')):
                rel = str(path.relative_to(payload)); info = tar.gettarinfo(str(path), arcname=rel)
                if info.islnk() or not (info.isdir() or info.isfile() or info.issym()):
                    raise ValueError('PACKAGE_MEMBER_KIND')
                info.uid = info.gid = 0; info.uname = info.gname = ''; info.mtime = 0
                if info.isfile():
                    with path.open('rb') as file: tar.addfile(info, file)
                else: tar.addfile(info)
    return total


def build(control, source, revision, source_revision, output, helper):
    if os.uname().sysname != 'Linux' or os.uname().machine != 'x86_64': raise ValueError('LINUX_X64_REQUIRED')
    if not HEX.fullmatch(revision) or not HEX.fullmatch(source_revision): raise ValueError('SOURCE_IDENTITY')
    if run(['git','rev-parse','HEAD'], control).decode().strip() != revision: raise ValueError('CONTROL_CHECKOUT')
    if run(['git','rev-parse','HEAD'], source).decode().strip() != source_revision: raise ValueError('SOURCE_CHECKOUT')
    output.mkdir(parents=True, exist_ok=False); payload = output / 'payload'; runtime = payload / 'control'
    runtime.mkdir(parents=True)
    args = ['node', str(helper), '--root', str(control)]
    for entry in ADAPTERS: args += ['--entry', entry]
    dynamic = [{'importer':'packages/cloud-deploy/src/cn-migration-plan.ts',
                'expression':'pathToFileURL(join(root, migratorPath)).href',
                'target':'apps/api/src/infrastructure/db/migrator.ts',
                'sourceRoot':'/usr/local/lib/workspacex-cn/release-source/'+source_revision}]
    args += ['--reviewed-dynamic-imports', json.dumps(dynamic,separators=(',', ':'))]
    closure = json.loads(run(args, control))
    files = set(closure['sourceFiles']) | {'package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.nvmrc'}
    for name in tuple(files):
        for parent in (Path(name).parent, *Path(name).parents):
            config = parent/'tsconfig.json'
            if (control/config).is_file(): files.add(str(config))
    spec = importlib.util.spec_from_file_location('fixed_closure', control/'scripts/cn-release-installation-closure.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    canonical = module.inventory(control); files.update(canonical)
    data = source_files(source, source_revision)
    for name, raw in data.items():
        if run(['git','show',revision+':'+name],control) != raw: raise ValueError('CONTROL_SOURCE_DATA_MISMATCH')
        files.add(name)
        path = payload/'source'/name; path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw);path.chmod(0o600)
    for name in sorted(files): copy_file(control, name, runtime)
    for name in closure['packageFiles']: copy_file(control,name,runtime)
    for name,target in closure['links'].items():
        rel=relative(name); destination=runtime/rel; destination.parent.mkdir(parents=True,exist_ok=True)
        if destination.exists() or destination.is_symlink(): raise ValueError('PACKAGE_LINK_COLLISION')
        destination.symlink_to(target)
    git_objects=minimal_git(control,revision,runtime)
    # Execute actual unprivileged imports from the pruned package, not the build checkout.
    probe="await import('./apps/api/scripts/platform-content-release-core.ts');await import('./apps/api/scripts/platform-schema-readback-core.ts');await import('./apps/api/src/infrastructure/db/pg-database.ts');await import('./apps/api/src/infrastructure/db/pg-config.ts');console.log('IMPORT_CLOSURE_OK')"
    if b'IMPORT_CLOSURE_OK' not in run(['node','--import','tsx','--input-type=module','-e',probe],runtime): raise ValueError('STAGED_IMPORT_FAILED')
    for name in canonical: copy_file(control,name,payload/'entry-control')
    for entry in ('release','evidence','prepare'):
        path=payload/'entries'/entry;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(module.fixed_wrapper(canonical,entry));path.chmod(0o700)
    meta=payload/'manifests';meta.mkdir()
    meta.joinpath('control-runtime.json').write_bytes(encode(manifest(runtime,exclude_git=True)))
    meta.joinpath('source-files.json').write_bytes(encode({name:digest(raw)for name,raw in data.items()}))
    meta.joinpath('git-files.json').write_bytes(encode(manifest(runtime/'.git')))
    links={str(p.relative_to(runtime)):os.readlink(p) for p in runtime.rglob('*') if p.is_symlink()}
    meta.joinpath('links.json').write_bytes(encode(links))
    meta.joinpath('dynamic-bindings.json').write_bytes(encode(closure['dynamicBindings']))
    archive=output/'runtime.tar.gz';total=make_archive(payload,archive)
    summary={'schemaVersion':1,'controlRevision':revision,'sourceRevision':source_revision,
             'producerRevision':run(['git','rev-parse','HEAD'],helper.parent.parent).decode().strip(),
             'eventRevision':os.environ.get('GITHUB_SHA'),'runId':os.environ.get('GITHUB_RUN_ID'),
             'runAttempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'platform':'linux-x64',
             'archiveSha256':digest(archive.read_bytes()),'archiveBytes':archive.stat().st_size,'unpackedBytes':total,
             'lockfileSha256':digest((control/'pnpm-lock.yaml').read_bytes()),'fixedControlBundleSha256':module.digest(canonical),
             'runtimeManifestSha256':digest(meta.joinpath('control-runtime.json').read_bytes()),
             'sourceFilesSha256':digest(meta.joinpath('source-files.json').read_bytes()),
             'gitManifestSha256':digest(meta.joinpath('git-files.json').read_bytes()),'gitObjectCount':git_objects,
             'npmPackageCount':len(closure['packageDirectories']),'sourceDataFiles':len(data),
             'dynamicBindings':closure['dynamicBindings'],
             'stagedImportsPassed':True,'controlSourceDataMatched':True,'productionChanges':False,
             'credentialsIncluded':False,'installationAuthorized':False}
    output.joinpath('summary.json').write_bytes(encode(summary))
    print(json.dumps(summary,sort_keys=True))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('control','source','revision','source-revision','output','helper'): parser.add_argument('--'+key,required=True)
    args=parser.parse_args()
    build(Path(args.control).resolve(),Path(args.source).resolve(),args.revision,args.source_revision,Path(args.output),Path(args.helper).resolve())
