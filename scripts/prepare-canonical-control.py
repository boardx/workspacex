#!/usr/bin/env python3
"""Prepare a fixed portable control closure; generated configs are review candidates.

CI runs without --review-config and consumes an independently reviewed configuration.
This script never installs dependencies or reads source from the candidate checkout.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

FILES = (
    'package.json', 'packages/cloud-deploy/package.json',
    'packages/cloud-deploy/src/release.ts',
    'packages/cloud-deploy/src/image-reference.ts',
    'packages/cloud-deploy/src/release-manifest.ts',
    'packages/cloud-deploy/src/release-manifest-cli.ts',
    'packages/cloud-deploy/src/release-candidate.ts',
    'packages/cloud-deploy/src/release-candidate-cli.ts',
)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--control', required=True, type=Path)
    parser.add_argument('--runtime', required=True, type=Path)
    parser.add_argument('--node', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--review-config', type=Path)
    args = parser.parse_args()
    control, runtime, output = (p.resolve() for p in (args.control, args.runtime, args.output))
    node = args.node.resolve()
    version = subprocess.check_output([str(node), '--version'], text=True).strip()
    if version != 'v22.20.0':
        raise ValueError('CONTROL_NODE_VERSION_MISMATCH')
    package = json.loads((runtime / 'package.json').read_text())
    if package['dependencies'] != {'tsx': '4.19.0', 'zod': '3.25.76'}:
        raise ValueError('CONTROL_RUNTIME_VERSION_MISMATCH')
    lock = json.loads((runtime / 'package-lock.json').read_text())
    if lock['packages']['']['dependencies'] != package['dependencies']:
        raise ValueError('CONTROL_RUNTIME_LOCK_MISMATCH')
    if output.exists():
        raise ValueError('CONTROL_OUTPUT_ALREADY_EXISTS')
    if not (runtime / 'node_modules/tsx/package.json').is_file():
        raise ValueError('CONTROL_RUNTIME_NOT_INSTALLED')
    output.mkdir(parents=True)
    for relative in FILES:
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(control / relative, destination)
    # Dereference npm links so the reviewed snapshot contains only concrete bytes.
    shutil.copytree(runtime / 'node_modules', output / 'node_modules', symlinks=False)
    node_copy = output / 'tools/node/bin/node'
    node_copy.parent.mkdir(parents=True)
    shutil.copyfile(node, node_copy)
    node_copy.chmod(0o700)
    # Use a byte-for-byte source lock, not an ambient monorepo dependency graph.
    shutil.copyfile(runtime / 'package-lock.json', output / 'control-runtime.package-lock.json')
    if args.review_config:
        config_path = args.review_config.resolve()
        config = {
            'schemaVersion': 1,
            'nodeExecutable': node_copy.relative_to(config_path.parent).as_posix(),
            'nodeSha256': sha(node_copy),
            'checkoutDirectory': output.relative_to(config_path.parent).as_posix(),
            'fileSha256': {p.relative_to(output).as_posix(): sha(p)
                          for p in sorted(output.rglob('*')) if p.is_file()},
        }
        with config_path.open('x') as handle:
            json.dump(config, handle, indent=2, sort_keys=True)
            handle.write('\n')
        provenance = {
            'reviewStatus': 'draft-unapproved', 'nodeVersion': version,
            'configurationSha256': sha(config_path),
            'runtimeLockSha256': sha(runtime / 'package-lock.json'),
            'sourceFiles': {name: sha(control / name) for name in FILES},
        }
        with config_path.with_suffix('.provenance.json').open('x') as handle:
            json.dump(provenance, handle, indent=2, sort_keys=True)
            handle.write('\n')
        print('CONTROL_REVIEW_CANDIDATE_GENERATED')
    else:
        print('CONTROL_CLOSURE_PREPARED_REQUIRES_INDEPENDENT_CONFIG')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('CONTROL_PREPARATION_REJECTED', file=sys.stderr)
        sys.exit(1)
