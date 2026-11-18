import hashlib
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
