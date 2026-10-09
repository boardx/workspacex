#!/usr/bin/env python3
"""Apply reviewed, hash-bound logging/token cleanup fixes to the pinned action."""
import argparse
import hashlib
from pathlib import Path
import sys

HASHES = {
 'dist/main/index.js': '2ef4f76558d87c3154fe1c18a3d927abe03247241a7ab4e2dca26cd4263b42ba',
 'dist/cleanup/index.js': 'a48dec45fe2b1c337705406154e5956b842735d0c9947ec8f2d8dbea35203661',
}

def harden(directory):
 root = Path(directory)
 files = {}
 for name, expected in HASHES.items():
  path = root/name
  if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
   raise ValueError('AUTH_ACTION_SOURCE_MISMATCH')
  files[name] = path.read_text()
 main = files['dist/main/index.js']
 old = "await fsx.writeFile(oidcTokenFilePath, idToken);"
 if main.count(old) != 1 or main.count('console.log(err.stack);') != 1:
  raise ValueError('AUTH_ACTION_PATCH_SHAPE_MISMATCH')
 main = main.replace(old, "await fsx.writeFile(oidcTokenFilePath, idToken, {mode: 0o600});")
 main = main.replace('console.log(err.stack);', '// Raw credential-provider errors must never enter logs.')
 main = main.replace('core.setFailed(err.message);', "core.setFailed('ALIBABA_CLOUD_AUTHENTICATION_FAILED');")
 # The upstream fixed token path must be removed on both success and failure.
 marker = "    const config = new Config({\n      type: 'oidc_role_arn',"
 end = "    setOutput(accessKeyId, accessKeySecret, securityToken);\n    return;\n  }\n\n  const config = new Config({\n    type: 'ecs_ram_role'"
 if main.count(marker) != 1 or main.count(end) != 1:
  raise ValueError('AUTH_ACTION_PATCH_SHAPE_MISMATCH')
 main = main.replace(marker, "    try {\n" + marker)
 main = main.replace(end, "    setOutput(accessKeyId, accessKeySecret, securityToken);\n    } finally {\n      await fsx.unlink(oidcTokenFilePath);\n    }\n    return;\n  }\n\n  const config = new Config({\n    type: 'ecs_ram_role'")
 files['dist/main/index.js'] = main
 files['dist/cleanup/index.js'] += "\ntry { require('fs').unlinkSync(require('path').join(require('os').tmpdir(), 'token')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('AUTH_TOKEN_CLEANUP_FAILED'); }\n"
 for name, content in files.items():
  (root/name).write_text(content)

if __name__ == '__main__':
 p = argparse.ArgumentParser(); p.add_argument('--directory', required=True); a = p.parse_args()
 try: harden(a.directory)
 except (ValueError, OSError):
  print('AUTH_ACTION_HARDENING_REJECTED', file=sys.stderr); sys.exit(1)
