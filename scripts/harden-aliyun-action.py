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
 # Official STS OIDC 401 codes (seven unique codes; response messages never emitted):
 # https://api.alibabacloud.com/api/product/error_codes?product=Sts&version=2015-04-01&pageNumber=1&lang=en_US
 codes = ('InvalidParameter.OIDCToken', 'InvalidIdentityToken', 'InvalidParameter',
          'NoPermission', 'Forbidden', 'EntityNotExist.Role', 'EntityNotExist.OIDCProvider',
          'InvalidOIDCToken', 'InvalidParameter.DurationSeconds',
          'invalid_token', 'invalid_request', 'unauthorized_client', 'access_denied',
          'invalid_grant', 'Unauthorized', 'AuthenticationFail',
          'AuthenticationFail.OIDCToken.AudienceNotMatch',
          'AuthenticationFail.OIDCToken.Expired',
          'AuthenticationFail.OIDCToken.Invalid',
          'AuthenticationFail.OIDCToken.InvalidSignature',
          'AuthenticationFail.OIDCToken.IssuerConfigurationBroken',
          'AuthenticationFail.OIDCToken.IssuerNotMatch',
          'AuthenticationFail.OIDCToken.PublicKeyFingerprintMismatch')
 import json
 provider_error = "throw new Error(`get sts token failed with OIDC: ${response.body.toString('utf8')}`);"
 replace_once(provider_error, """const safeError = new Error('AUTH_STS_RESPONSE_REJECTED');
            safeError.authHttpStatus = Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599 ? response.statusCode : null;
            const allowed = """ + json.dumps(codes) + """;
            const headers = response.headers || {};
            const mime = typeof headers['content-type'] === 'string' ? headers['content-type'].split(';')[0].trim().toLowerCase() : '';
            const contentType = !mime ? 'MISSING' : ['application/json', 'application/problem+json'].includes(mime) ? 'JSON' : ['application/xml', 'text/xml'].includes(mime) ? 'XML' : mime === 'text/html' ? 'HTML' : mime === 'text/plain' ? 'TEXT' : 'OTHER';
            const encoding = typeof headers['content-encoding'] === 'string' ? headers['content-encoding'].trim().toLowerCase() : '';
            const contentEncoding = !encoding ? 'MISSING' : ({identity:'IDENTITY',gzip:'GZIP',deflate:'DEFLATE',br:'BR'})[encoding] || 'OTHER';
            safeError.authShape = {jsonParsed:false, topLevelObject:false, codeFieldPresence:'NONE', codeType:'MISSING', contentType, contentEncoding};
            safeError.authCategory = 'NON_JSON_RESPONSE';
            if (Buffer.isBuffer(response.body) && response.body.length <= 65536) {
              const text = response.body.toString('utf8');
              try {
                const parsed = JSON.parse(text);
                safeError.authShape.jsonParsed = true;
                safeError.authShape.topLevelObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
                safeError.authCategory = 'OTHER';
                if (safeError.authShape.topLevelObject) {
                  const upper = Object.prototype.hasOwnProperty.call(parsed, 'Code');
                  const lower = Object.prototype.hasOwnProperty.call(parsed, 'code');
                  safeError.authShape.codeFieldPresence = upper && lower ? 'BOTH' : upper ? 'UPPER' : lower ? 'LOWER' : 'NONE';
                  const code = upper ? parsed.Code : parsed.code;
                  safeError.authShape.codeType = !upper && !lower ? 'MISSING' : code === null ? 'NULL' : Array.isArray(code) ? 'ARRAY' : ({string:'STRING',number:'NUMBER',boolean:'BOOLEAN',object:'OBJECT'})[typeof code] || 'OTHER';
                  if (allowed.includes(code) && !(upper && lower && parsed.Code !== parsed.code)) safeError.authCategory = code;
                }
              } catch (_) {
                safeError.authCategory = ({XML:'XML_RESPONSE',HTML:'HTML_RESPONSE',TEXT:'TEXT_RESPONSE'})[contentType] || 'NON_JSON_RESPONSE';
                // XML remains structural only; text matches cannot establish a provider Code.
                if (text.trim() === 'Unauthorized') safeError.authCategory = 'Unauthorized';
              }
            } else safeError.authCategory = 'BODY_UNCLASSIFIED';
            throw safeError;""")
 diagnostic = """let authStage = 'INITIALIZE';
let authCleanupFailed = false;
function safeAuthDiagnostic(err) {
  const allowed = """ + json.dumps(codes) + """;
  const categories = allowed.concat(['OTHER','NON_JSON_RESPONSE','XML_RESPONSE','HTML_RESPONSE','TEXT_RESPONSE','BODY_UNCLASSIFIED']);
  const category = err && categories.includes(err.authCategory) ? err.authCategory : 'OTHER';
  const status = err && Number.isInteger(err.authHttpStatus) && err.authHttpStatus >= 100 && err.authHttpStatus <= 599 ? err.authHttpStatus : null;
  const shape = err && err.authShape || {};
  const select = (value, values, fallback) => values.includes(value) ? value : fallback;
  return JSON.stringify({
    stage: select(authStage, ['INITIALIZE','TOKEN_REQUEST','TOKEN_WRITE','STS_EXCHANGE','CREDENTIAL_EXPORT','TOKEN_CLEANUP'], 'INITIALIZE'),
    category, httpStatus: status, cleanupFailed: authCleanupFailed === true,
    jsonParsed: shape.jsonParsed === true, topLevelObject: shape.topLevelObject === true,
    codeFieldPresence: select(shape.codeFieldPresence, ['NONE','UPPER','LOWER','BOTH'], 'NONE'),
    codeType: select(shape.codeType, ['MISSING','NULL','ARRAY','STRING','NUMBER','BOOLEAN','OBJECT','OTHER'], 'MISSING'),
    contentType: select(shape.contentType, ['JSON','XML','HTML','TEXT','OTHER','MISSING'], 'MISSING'),
    contentEncoding: select(shape.contentEncoding, ['IDENTITY','GZIP','DEFLATE','BR','OTHER','MISSING'], 'MISSING')
  });
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
