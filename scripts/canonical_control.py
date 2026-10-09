"""Verified, isolated canonical CLI closure shared by producer and handoff verifier.

The expected configuration digest is supplied independently of release artifacts.
Only files named by that configuration enter the execution directory.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile

REQUIRED_SOURCE = {
    'package.json',
    'packages/cloud-deploy/package.json',
    'packages/cloud-deploy/src/release.ts',
    'packages/cloud-deploy/src/image-reference.ts',
    'packages/cloud-deploy/src/release-manifest.ts',
    'packages/cloud-deploy/src/release-manifest-cli.ts',
    'packages/cloud-deploy/src/release-candidate.ts',
    'packages/cloud-deploy/src/release-candidate-cli.ts',
}

def require(condition, code):
    if not condition:
        raise ValueError(code)

def digest(value):
    return hashlib.sha256(value).hexdigest()

def decode_configuration(config_path, expected_sha256):
    require(isinstance(expected_sha256, str) and re.fullmatch('[a-f0-9]{64}', expected_sha256), 'CONTROL_EXPECTED_HASH_REQUIRED')
    raw = Path(config_path).read_bytes()
    require(digest(raw) == expected_sha256, 'CONTROL_CONFIGURATION_HASH_MISMATCH')
    config = json.loads(raw)
    require(isinstance(config, dict) and set(config) == {'schemaVersion', 'nodeExecutable', 'nodeSha256', 'checkoutDirectory', 'fileSha256'}, 'INVALID_CONTROL_CONFIGURATION')
    require(type(config['schemaVersion']) is int and config['schemaVersion'] == 1, 'INVALID_CONTROL_SCHEMA')
    for field in ('nodeExecutable', 'checkoutDirectory'):
        value = config[field]
        require(isinstance(value, str) and bool(value), 'INVALID_CONTROL_LOCATION')
        if not Path(value).is_absolute():
            relative = PurePosixPath(value)
            require(value == str(relative) and '..' not in relative.parts and '\\' not in value, 'INVALID_CONTROL_LOCATION')
    require(isinstance(config['nodeSha256'], str) and re.fullmatch('[a-f0-9]{64}', config['nodeSha256']), 'INVALID_NODE_HASH')
    files = config['fileSha256']
    require(isinstance(files, dict) and REQUIRED_SOURCE <= files.keys(), 'INCOMPLETE_CANONICAL_SOURCE_CLOSURE')
    require({'node_modules/tsx/package.json', 'node_modules/zod/package.json'} <= files.keys(), 'INCOMPLETE_CANONICAL_DEPENDENCY_CLOSURE')
    for relative, sha256 in files.items():
        require(isinstance(relative, str), 'INVALID_CONTROL_PATH')
        path = PurePosixPath(relative)
        require(not path.is_absolute() and relative == str(path) and '..' not in path.parts and '\\' not in relative, 'INVALID_CONTROL_PATH')
        require(isinstance(sha256, str) and re.fullmatch('[a-f0-9]{64}', sha256), 'INVALID_CONTROL_FILE_HASH')
    return config

def control_location(config_path, configured):
    path = Path(configured)
    return path if path.is_absolute() else Path(config_path).resolve().parent / path

@contextmanager
def canonical_snapshot(config_path, expected_sha256):
    """Yield immutable-by-construction verified copies, never original source files.

    Missing transitive dependencies fail at execution; no ambient node_modules are
    copied or resolved through NODE_PATH. Host OS shared libraries remain trusted.
    """
    config = decode_configuration(config_path, expected_sha256)
    with tempfile.TemporaryDirectory(prefix='wsx-canonical-control-') as directory:
        root = Path(directory)
        node_bytes = control_location(config_path, config['nodeExecutable']).read_bytes()
        require(digest(node_bytes) == config['nodeSha256'], 'CONTROL_NODE_HASH_MISMATCH')
        node = root / 'bin' / 'node'
        node.parent.mkdir()
        node.write_bytes(node_bytes)
        node.chmod(0o700)
        closure = root / 'closure'
        closure.mkdir()
        # Node's normal dependency search climbs parent directories even with
        # NODE_PATH empty. Refuse any ambient ancestor dependency/config tree.
        for parent in closure.parents:
            require(not (parent / 'node_modules').exists(), 'AMBIENT_NODE_MODULES_REJECTED')
            require(not (parent / 'tsconfig.json').exists(), 'AMBIENT_TSCONFIG_REJECTED')
        original = control_location(config_path, config['checkoutDirectory'])
        for relative, expected in config['fileSha256'].items():
            source = original / relative
            require(source.is_file(), 'CONTROL_FILE_MISSING')
            content = source.read_bytes()
            require(digest(content) == expected, 'CONTROL_FILE_HASH_MISMATCH')
            destination = closure / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
            # Native esbuild executables need execution permission. No unreviewed
            # executable is added; every byte of every copied file was pinned.
            destination.chmod(0o700)
        yield {'nodeExecutable': str(node), 'directory': str(closure),
               'configurationSha256': expected_sha256, 'nodeSha256': config['nodeSha256'],
               'fileCount': len(config['fileSha256'])}

def canonical_environment(environment):
    env = dict(environment)
    for key in list(env):
        if key.startswith(('NODE_', 'TSX_', 'TS_NODE_', 'ESBUILD_')) or key in ('ACR_TOKEN', 'ACR_USERNAME'):
            del env[key]
    env['NODE_PATH'] = ''
    return env
