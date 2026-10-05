#!/usr/bin/env python3
"""Read-only local review-package integrity check; never admits host installation."""
import importlib.util
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('cn_install_package_producer', HERE / 'prepare-cn-tool-install.py')
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)


def precheck(repo, package, manifest_sha256, tool, application, main):
    require = producer.require
    for revision in (tool, application, main):
        require(isinstance(revision, str) and re.fullmatch('[a-f0-9]{40}', revision), 'EXACT_REVISION')
    require(isinstance(manifest_sha256, str) and re.fullmatch('[a-f0-9]{64}', manifest_sha256), 'MANIFEST_PIN_FORMAT')
    package = pathlib.Path(package).absolute()
    raw = producer.safe_file(package / 'manifest.json')
    require(producer.sha(raw) == manifest_sha256, 'MANIFEST_PIN')
    require(producer.safe_file(package / 'COMPLETE') == (manifest_sha256 + '\n').encode(), 'PACKAGE_COMPLETE')
    manifest = json.loads(raw)
    require(manifest.get('schemaVersion') == 1 and manifest.get('mode') == 'review-package-only', 'REVIEW_PACKAGE')
    require(all(manifest.get(key) is False for key in ('ready', 'installed', 'installationAuthorized')), 'REVIEW_AUTHORITY')
    require((manifest.get('toolRevision'), manifest.get('applicationRevision'), manifest.get('localAncestryMainRevision')) == (tool, application, main), 'PACKAGE_IDENTITY')
    metadata = producer.trusted_local_git(repo)
    git = producer.execute_git
    require(git(repo, 'rev-parse', main + '^{commit}').decode().strip() == main, 'MAIN_OBJECT')
    git(repo, 'merge-base', '--is-ancestor', tool, main)
    require(git(repo, 'rev-parse', application + '^{commit}').decode().strip() == application, 'APP_OBJECT')
    identity = git(repo, 'show', tool + ':.harness/scripts/vm/cn-build-tool-identity.py')
    files = producer.allowlist(identity)
    require(manifest.get('toolRoot') == producer.tool_root_contract(identity, tool), 'TOOL_ROOT')
    rows = manifest.get('files')
    require(isinstance(rows, dict) and set(rows) == set(files), 'FILES_CLOSURE')
    payload = package / 'payload'
    require(payload.is_dir() and not payload.is_symlink(), 'PAYLOAD_DIRECTORY')
    actual = set()
    for path in payload.rglob('*'):
        require(not path.is_symlink(), 'PAYLOAD_SYMLINK')
        if path.is_file():
            actual.add(str(path.relative_to(payload)))
        else:
            require(path.is_dir(), 'PAYLOAD_MEMBER')
    require(actual == set(files), 'PAYLOAD_CLOSURE')
    for source, target in files.items():
        row = rows[source]
        require(isinstance(row, dict) and row.get('target') == target and row.get('mode') == ('0700' if target else '0600'), 'TARGET_AUTHORITY')
        data = producer.safe_file(payload / source)
        require(data == git(repo, 'show', tool + ':' + source), 'PAYLOAD_GIT_BINDING')
        require(row.get('newSha256') == producer.sha(data) and type(row.get('bytes')) is int and row['bytes'] == len(data), 'PAYLOAD_METADATA')
    closure = manifest.get('trustedGitClosure', {})
    require(closure.get('toolRevision') == tool and closure.get('inventorySha256') == producer.sha(git(repo, 'ls-tree', '-r', '-z', tool)), 'TREE_CLOSURE_BINDING')
    require(producer.trusted_local_git(repo) == metadata, 'GIT_METADATA_CHANGED')
    require(producer.safe_file(package / 'manifest.json') == raw, 'MANIFEST_CHANGED')
    return {'schemaVersion': 1, 'mode': 'local-review-package-precheck', 'packageIntegrityVerified': True,
            'manifestSha256': manifest_sha256, 'toolRevision': tool, 'applicationRevision': application,
            'fileCount': len(files), 'installationAuthorized': False, 'installed': False, 'ready': False,
            'blockers': ['HOST_TRUST_AND_INVENTORY_REVALIDATION_REQUIRED', 'PRODUCTION_INSTALL_APPROVAL_MISSING']}


if __name__ == '__main__':
    try:
        producer.require(len(sys.argv) == 8 and sys.argv[1] == '--review-package', 'USAGE_REVIEW_PACKAGE_REPO_PACKAGE_HASH_TOOL_APP_MAIN')
        print(json.dumps(precheck(*sys.argv[2:]), sort_keys=True))
    except Exception:
        print('CN_TOOL_PACKAGE_PRECHECK_REJECTED', file=sys.stderr)
        sys.exit(1)
