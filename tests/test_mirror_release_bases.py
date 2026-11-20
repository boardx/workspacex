import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class MirrorReleaseBases(unittest.TestCase):
    def test_first_copy_uses_digest_only_and_preserves_registry_port(self):
        script = Path(__file__).resolve().parents[1] / "scripts/mirror-release-bases.sh"
        manifest = b'{"schemaVersion":2}'
        digest = "sha256:" + hashlib.sha256(manifest).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "manifest").write_bytes(manifest)
            skopeo = root / "skopeo"
            skopeo.write_text("""#!/usr/bin/env bash
set -eu
case "$1" in
  login) cat >/dev/null ;;
  inspect) cat "$PROBE_DIR/copied" ;;
  copy)
    [[ ${@: -2:1} == "$EXPECTED_SOURCE" ]] || exit 42
    cp "$PROBE_DIR/manifest" "$PROBE_DIR/copied"
    ;;
esac
""")
            skopeo.chmod(0o755)
            registry = "test-registry.cn-shanghai.cr.aliyuncs.com"
            output = root / "output"
            env = dict(
                os.environ,
                PATH=f"{root}:{os.environ['PATH']}",
                PROBE_DIR=directory,
                EXPECTED_SOURCE=f"docker://registry.example:5000/library/node@{digest}",
                NODE_IMAGE=f"registry.example:5000/library/node:22-slim@{digest}",
                PYTHON_IMAGE="",
                PGVECTOR_IMAGE="",
                REGISTRY=registry,
                REGISTRY_PREFIX=f"{registry}/images",
                ACR_USERNAME="fixture",
                ACR_PASSWORD="fixture",
                GITHUB_OUTPUT=str(output),
            )
            result = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                output.read_text(),
                f"node_image=test-registry-vpc.cn-shanghai.cr.aliyuncs.com/images/build-base-node@{digest}\n",
            )

    def test_buildkit_copies_only_the_official_linux_amd64_manifest_by_digest(self):
        script = Path(__file__).resolve().parents[1] / "scripts/mirror-release-bases.sh"
        manifest = b'{"schemaVersion":2}'
        digest = "sha256:" + hashlib.sha256(manifest).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "manifest").write_bytes(manifest)
            (root / 'index').write_text(json.dumps({'schemaVersion': 2, 'manifests': [
                {'platform': {'os': 'linux', 'architecture': 'arm64'}, 'digest': 'sha256:' + 'b' * 64},
                {'platform': {'os': 'linux', 'architecture': 'amd64'}, 'digest': digest},
                {'platform': {'os': 'unknown', 'architecture': 'unknown'}, 'digest': 'sha256:' + 'c' * 64},
            ]}))
            skopeo = root / "skopeo"
            skopeo.write_text("""#!/usr/bin/env bash
set -eu
case "$1" in
  login) cat >/dev/null ;;
  inspect)
    if [[ ${@: -1} == docker://docker.io/moby/buildkit:buildx-stable-1 ]]; then
      cat "$PROBE_DIR/index"
    else
      cat "$PROBE_DIR/copied"
    fi
    ;;
  copy)
    [[ ${@: -2:1} == "docker://docker.io/moby/buildkit@$EXPECTED_DIGEST" ]] || exit 42
    [[ ${@: -1} == "docker://$REGISTRY/images/skill-sandbox:buildkit-base-${EXPECTED_DIGEST/:/-}" ]] || exit 43
    cp "$PROBE_DIR/manifest" "$PROBE_DIR/copied"
    ;;
esac
""")
            skopeo.chmod(0o755)
            registry = "test-registry.cn-shanghai.cr.aliyuncs.com"
            output = root / "output"
            env = dict(
                os.environ,
                PATH=f"{root}:{os.environ['PATH']}",
                PROBE_DIR=directory,
                EXPECTED_DIGEST=digest,
                MIRROR_BUILDKIT="true",
                BUILDKIT_REPOSITORY="skill-sandbox",
                NODE_IMAGE="",
                PYTHON_IMAGE="",
                UV_IMAGE="",
                PGVECTOR_IMAGE="",
                REGISTRY=registry,
                REGISTRY_PREFIX=f"{registry}/images",
                ACR_USERNAME="fixture",
                ACR_PASSWORD="fixture",
                GITHUB_OUTPUT=str(output),
            )
            result = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                output.read_text(),
                f"buildkit_image=test-registry-vpc.cn-shanghai.cr.aliyuncs.com/images/skill-sandbox@{digest}\n",
            )

    def test_invalid_buildkit_repository_stops_before_auth_or_publication(self):
        script = Path(__file__).resolve().parents[1] / "scripts/mirror-release-bases.sh"
        for repository in ('', '../other', 'other/namespace', 'repo;echo'):
            with self.subTest(repository=repository), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                skopeo = root / 'skopeo'
                skopeo.write_text('#!/bin/sh\ntouch "$PROBE_DIR/called"\n')
                skopeo.chmod(0o700)
                registry = 'test-registry.cn-shanghai.cr.aliyuncs.com'
                env = {**os.environ, 'PATH': f"{root}:{os.environ['PATH']}",
                       'PROBE_DIR': directory, 'REGISTRY': registry,
                       'REGISTRY_PREFIX': registry + '/images', 'MIRROR_BUILDKIT': 'true',
                       'BUILDKIT_REPOSITORY': repository, 'GITHUB_OUTPUT': str(root / 'output')}
                result = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((root / 'called').exists())
                self.assertFalse((root / 'output').exists())

    def test_invalid_or_ambiguous_platform_index_stops_before_copy(self):
        script = Path(__file__).resolve().parents[1] / 'scripts/mirror-release-bases.sh'
        row = {'platform': {'os': 'linux', 'architecture': 'amd64'}, 'digest': 'sha256:' + 'a' * 64}
        for manifests in ([], [row, row], [{**row, 'digest': 'not-a-digest'}]):
            with self.subTest(manifests=manifests), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'index').write_text(json.dumps({'schemaVersion': 2, 'manifests': manifests}))
                skopeo = root / 'skopeo'
                skopeo.write_text('#!/bin/sh\ncase "$1" in\nlogin) cat >/dev/null ;;\n'
                                  'inspect) cat "$PROBE_DIR/index" ;;\ncopy) touch "$PROBE_DIR/copied" ;;\nesac\n')
                skopeo.chmod(0o700)
                registry = 'test-registry.cn-shanghai.cr.aliyuncs.com'
                env = {**os.environ, 'PATH': f"{root}:{os.environ['PATH']}", 'PROBE_DIR': directory,
                       'REGISTRY': registry, 'REGISTRY_PREFIX': registry + '/images',
                       'MIRROR_BUILDKIT': 'true', 'BUILDKIT_REPOSITORY': 'skill-sandbox',
                       'ACR_USERNAME': 'fixture', 'ACR_PASSWORD': 'fixture',
                       'GITHUB_OUTPUT': str(root / 'output')}
                result = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((root / 'copied').exists())
                self.assertFalse((root / 'output').exists())
