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
 def replace_once(old, new):
  nonlocal main
  if main.count(old) != 1:
   raise ValueError('AUTH_ACTION_PATCH_SHAPE_MISMATCH')
  main = main.replace(old, new)
 # Values emitted below come only from literals, an exact enum, or an integer.
 codes = ('InvalidParameter.OIDCToken', 'InvalidIdentityToken', 'InvalidParameter',
          'NoPermission', 'Forbidden', 'EntityNotExist.Role', 'EntityNotExist.OIDCProvider',
          'InvalidOIDCToken', 'InvalidParameter.DurationSeconds')
 import json
 provider_error = "throw new Error(`get sts token failed with OIDC: ${response.body.toString('utf8')}`);"
 replace_once(provider_error, """const safeError = new Error('AUTH_STS_RESPONSE_REJECTED');
            safeError.authHttpStatus = Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599 ? response.statusCode : null;
            safeError.authCategory = 'OTHER';
            try {
                const parsed = JSON.parse(response.body.toString('utf8'));
                const allowed = """ + json.dumps(codes) + """;
                if (parsed && allowed.includes(parsed.Code)) safeError.authCategory = parsed.Code;
            } catch (_) { /* Never expose provider response bytes. */ }
            throw safeError;""")
 diagnostic = """let authStage = 'INITIALIZE';
let authCleanupFailed = false;
function safeAuthDiagnostic(err) {
  const allowed = """ + json.dumps(codes) + """;
  const category = err && allowed.includes(err.authCategory) ? err.authCategory : 'OTHER';
  const status = err && Number.isInteger(err.authHttpStatus) && err.authHttpStatus >= 100 && err.authHttpStatus <= 599 ? err.authHttpStatus : null;
  return JSON.stringify({stage: authStage, category, httpStatus: status, cleanupFailed: authCleanupFailed});
}
async function run() {"""
 replace_once('async function run() {', diagnostic)
 replace_once('const idToken = await core.getIDToken(audience);', "authStage = 'TOKEN_REQUEST';\n    const idToken = await core.getIDToken(audience);")
 replace_once('await fsx.writeFile(oidcTokenFilePath, idToken);', "authStage = 'TOKEN_WRITE';\n    await fsx.writeFile(oidcTokenFilePath, idToken, {mode: 0o600});")
 replace_once('console.log(err.stack);', "console.log(safeAuthDiagnostic(err));")
 replace_once('core.setFailed(err.message);', "core.setFailed('ALIBABA_CLOUD_AUTHENTICATION_FAILED');")
 marker = "    const config = new Config({\n      type: 'oidc_role_arn',"
 replace_once(marker, "    let primaryFailure = false;\n    try {\n    authStage = 'STS_EXCHANGE';\n" + marker)
 end = "    setOutput(accessKeyId, accessKeySecret, securityToken);\n    return;\n  }\n\n  const config = new Config({\n    type: 'ecs_ram_role'"
 replace_once(end, """    authStage = 'CREDENTIAL_EXPORT';
    setOutput(accessKeyId, accessKeySecret, securityToken);
    } catch (err) {
      primaryFailure = true;
      throw err;
    } finally {
      try { await fsx.unlink(oidcTokenFilePath); }
      catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          authCleanupFailed = true;
          if (!primaryFailure) {
            authStage = 'TOKEN_CLEANUP';
            throw new Error('AUTH_TOKEN_CLEANUP_FAILED');
          }
        }
      }
    }
    return;
  }

  const config = new Config({
    type: 'ecs_ram_role'""")
 files['dist/main/index.js'] = main
 files['dist/cleanup/index.js'] += "\ntry { require('fs').unlinkSync(require('path').join(require('os').tmpdir(), 'token')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('AUTH_TOKEN_CLEANUP_FAILED'); }\n"
 for name, content in files.items():
  (root/name).write_text(content)

if __name__ == '__main__':
 p = argparse.ArgumentParser(); p.add_argument('--directory', required=True); a = p.parse_args()
 try: harden(a.directory)
 except (ValueError, OSError):
  print('AUTH_ACTION_HARDENING_REJECTED', file=sys.stderr); sys.exit(1)
