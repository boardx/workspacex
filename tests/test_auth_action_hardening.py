import hashlib
import json
import subprocess
import shutil
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('harden',Path(__file__).parents[1]/'scripts/harden-aliyun-action.py')
h=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(h)
MAIN="""const scenario = JSON.parse(process.argv[2] || '{}');
// Synthetic sentinel for redaction/error tests; retain its exact bytes.
const secret = ['SENSITIVE_TOK', 'EN_BODY_STACK'].join('');
const core = {
 getIDToken: async () => { if (scenario.tokenError) throw new Error(secret); return secret; },
 setFailed: () => { process.exitCode = 1; }
};
const fsx = {
 writeFile: async () => { if (scenario.writeError) throw new Error(secret); },
 unlink: async () => { if (scenario.cleanup) { const e = new Error(secret); e.code = scenario.cleanup; throw e; } }
};
class Config {}
class CredentialClient {
 async getCredential() {
  const response = {statusCode: scenario.status || 200, headers: scenario.headers || {}, body: Buffer.from(scenario.body || '{}')};
  if (response.statusCode !== 200) {
   throw new Error(`get sts token failed with OIDC: ${response.body.toString('utf8')}`);
  }
  return {accessKeyId: secret, accessKeySecret: secret, securityToken: secret};
 }
}
function setOutput() { if (scenario.exportError) throw new Error(secret); }
async function run() {
  if (true) {
    const audience = 'test';
    const idToken = await core.getIDToken(audience);
    const oidcTokenFilePath = 'mock-token';
    await fsx.writeFile(oidcTokenFilePath, idToken);
    const config = new Config({
      type: 'oidc_role_arn',
    });
    const client = new CredentialClient(config);
    const {accessKeyId, accessKeySecret, securityToken} = await client.getCredential();
    setOutput(accessKeyId, accessKeySecret, securityToken);
    return;
  }

  const config = new Config({
    type: 'ecs_ram_role'
  });
}
run().catch((err) => {
 console.log(err.stack);
 core.setFailed(err.message);
});
"""
class HardenTests(unittest.TestCase):
 def fixture(self,root):
  contents={'dist/main/index.js':MAIN,'dist/cleanup/index.js':'clearEnvironment();'}
  for name,content in contents.items():
   p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content)
  return {k:hashlib.sha256(v.encode()).hexdigest() for k,v in contents.items()}
 def test_failure_logging_and_token_cleanup(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);hashes=self.fixture(root)
   with patch.object(h,'HASHES',hashes):h.harden(root)
   main=(root/'dist/main/index.js').read_text()
   self.assertNotIn('err.stack',main);self.assertNotIn('err.message',main)
   self.assertIn('{mode: 0o600}',main);self.assertIn('finally {',main);self.assertIn('await fsx.unlink(oidcTokenFilePath)',main)
   self.assertIn("e.code !== 'ENOENT'",(root/'dist/cleanup/index.js').read_text())
 def test_source_drift_does_not_partially_patch(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);hashes=self.fixture(root);main=(root/'dist/main/index.js').read_bytes()
   (root/'dist/cleanup/index.js').write_text('changed')
   with patch.object(h,'HASHES',hashes),self.assertRaises(ValueError):h.harden(root)
   self.assertEqual(main,(root/'dist/main/index.js').read_bytes())
 def test_symlink_source_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);hashes=self.fixture(root);p=root/'dist/main/index.js';p.rename(root/'original');p.symlink_to(root/'original')
   with patch.object(h,'HASHES',hashes),self.assertRaises(ValueError):h.harden(root)

 def execute(self, scenario):
  self.assertIsNotNone(shutil.which('node'), 'Node is required for runtime security tests')
  with tempfile.TemporaryDirectory() as t:
   root=Path(t); hashes=self.fixture(root)
   with patch.object(h,'HASHES',hashes): h.harden(root)
   r=subprocess.run(['node',str(root/'dist/main/index.js'),json.dumps(scenario)],capture_output=True,text=True,timeout=10)
   self.assertNotIn('SENSITIVE_TOKEN_BODY_STACK',r.stdout+r.stderr)
   self.assertEqual(r.stderr,'')
   return r.returncode, json.loads(r.stdout) if r.stdout else None
 def test_real_js_sts_allowlist_and_cleanup_preserves_primary(self):
  code,result=self.execute(dict(status=403,body=json.dumps({'Code':'NoPermission','Message':'SENSITIVE_TOKEN_BODY_STACK'}),cleanup='EACCES'))
  self.assertEqual(code,1)
  self.assertEqual({k:result[k] for k in ('stage','category','httpStatus','cleanupFailed')},dict(stage='STS_EXCHANGE',category='NoPermission',httpStatus=403,cleanupFailed=True))
 def test_real_js_unknown_provider_code_never_echoed(self):
  for body in ('not json SENSITIVE_TOKEN_BODY_STACK', json.dumps({'Code':'SENSITIVE_TOKEN_BODY_STACK'})):
   with self.subTest(body=body):
    code,result=self.execute(dict(status=400,body=body))
    self.assertEqual(code,1);self.assertIn(result['category'],('OTHER','NON_JSON_RESPONSE'));self.assertEqual(result['httpStatus'],400)
 def test_real_js_cleanup_idempotence_and_failure(self):
  self.assertEqual(self.execute(dict(cleanup='ENOENT')),(0,None))
  code,result=self.execute(dict(cleanup='EACCES'))
  self.assertEqual(code,1);self.assertEqual(result['stage'],'TOKEN_CLEANUP');self.assertTrue(result['cleanupFailed'])
 def test_real_js_stage_failures(self):
  for flag,stage in [('tokenError','TOKEN_REQUEST'),('writeError','TOKEN_WRITE'),('exportError','CREDENTIAL_EXPORT')]:
   with self.subTest(flag=flag):
    code,result=self.execute({flag:True});self.assertEqual(code,1);self.assertEqual(result['stage'],stage)
 def test_real_js_status_is_bounded_integer(self):
  for status in (99,600,'403'):
   with self.subTest(status=status):
    code,result=self.execute(dict(status=status));self.assertEqual(code,1);self.assertIsNone(result['httpStatus'])
 def test_missing_shape_does_not_partially_patch(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t); hashes=self.fixture(root);p=root/'dist/main/index.js'
   p.write_text(p.read_text().replace('async function run() {','async function changed() {'))
   raw=p.read_bytes();hashes['dist/main/index.js']=hashlib.sha256(raw).hexdigest()
   with patch.object(h,'HASHES',hashes),self.assertRaises(ValueError):h.harden(root)
   self.assertEqual(p.read_bytes(),raw)

 def test_response_structure_and_known_codes(self):
  for body,presence,kind,category in [
   ('{"code":"invalid_token"}','LOWER','STRING','invalid_token'),
   ('{"Code":"Unauthorized"}','UPPER','STRING','Unauthorized'),
   ('{"Code":42}','UPPER','NUMBER','OTHER'),
   ('{"Code":null}','UPPER','NULL','OTHER'),
   ('{"Code":[]}','UPPER','ARRAY','OTHER'),
   ('{"Code":{}}','UPPER','OBJECT','OTHER'),
   ('{"Code":true}','UPPER','BOOLEAN','OTHER'),
   ('{}','NONE','MISSING','OTHER'),
   ('{"Code":"NoPermission","code":"invalid_token"}','BOTH','STRING','OTHER')]:
   with self.subTest(body=body):
    _,r=self.execute(dict(status=401,body=body,headers={'content-type':'application/json; charset=utf-8','content-encoding':'gzip'}))
    self.assertTrue(r['jsonParsed']);self.assertTrue(r['topLevelObject']);self.assertEqual(r['codeFieldPresence'],presence);self.assertEqual(r['codeType'],kind);self.assertEqual(r['category'],category);self.assertEqual(r['contentType'],'JSON');self.assertEqual(r['contentEncoding'],'GZIP')
 def test_non_json_response_shapes_never_echo_payload(self):
  for body,mime,category in [
   ('<html>SENSITIVE_TOKEN_BODY_STACK</html>','text/html','HTML_RESPONSE'),
   ('<Error><Code>InvalidIdentityToken</Code><Message>SENSITIVE_TOKEN_BODY_STACK</Message></Error>','application/xml','XML_RESPONSE'),
   ('<Error><Code>SENSITIVE_TOKEN_BODY_STACK</Code></Error>','text/xml','XML_RESPONSE'),
   ('Unauthorized','text/plain','Unauthorized'),
   ('SENSITIVE_TOKEN_BODY_STACK','text/plain','TEXT_RESPONSE'),
   ('SENSITIVE_TOKEN_BODY_STACK','SENSITIVE_TOKEN_BODY_STACK','NON_JSON_RESPONSE')]:
   with self.subTest(category=category):
    _,r=self.execute(dict(status=401,body=body,headers={'content-type':mime,'content-encoding':'SENSITIVE_TOKEN_BODY_STACK'}))
    self.assertFalse(r['jsonParsed']);self.assertEqual(r['category'],category);self.assertEqual(r['contentEncoding'],'OTHER')
 def test_json_primitive_and_large_body(self):
  for body in ('null','[]','"SENSITIVE_TOKEN_BODY_STACK"'):
   _,r=self.execute(dict(status=401,body=body));self.assertTrue(r['jsonParsed']);self.assertFalse(r['topLevelObject'])
  _,r=self.execute(dict(status=401,body='x'*65537));self.assertEqual(r['category'],'BODY_UNCLASSIFIED')

 def test_official_oidc_401_codes(self):
  codes = ('AuthenticationFail.OIDCToken.AudienceNotMatch', 'AuthenticationFail.OIDCToken.Expired', 'AuthenticationFail.OIDCToken.Invalid', 'AuthenticationFail.OIDCToken.InvalidSignature', 'AuthenticationFail.OIDCToken.IssuerConfigurationBroken', 'AuthenticationFail.OIDCToken.IssuerNotMatch', 'AuthenticationFail.OIDCToken.PublicKeyFingerprintMismatch')
  for code in codes:
   with self.subTest(code=code):
    status,r=self.execute(dict(status=401,body=json.dumps({"Code":code,"Message":"SENSITIVE_TOKEN_BODY_STACK"})))
    self.assertEqual(status,1);self.assertEqual(r["category"],code);self.assertEqual(r["httpStatus"],401)

 def test_xml_embedded_or_conflicting_codes_are_not_provider_codes(self):
  for body in ("<Error><Message><Code>NoPermission</Code></Message></Error>", "<Error><Code>unknown</Code><Code>NoPermission</Code></Error>", "<Error><!-- <Code>NoPermission</Code> --></Error>"):
   _,r=self.execute(dict(status=401,body=body,headers={"content-type":"application/xml"}))
   self.assertEqual(r["category"],"XML_RESPONSE")

 def test_all_39_documented_sts_codes(self):
  public_codes = ('AuthenticationFail.NoPermission', 'AuthenticationFail.OIDCToken.AudienceNotMatch', 'AuthenticationFail.OIDCToken.Expired', 'AuthenticationFail.OIDCToken.HttpsUrlInvalid', 'AuthenticationFail.OIDCToken.Invalid', 'AuthenticationFail.OIDCToken.InvalidSignature', 'AuthenticationFail.OIDCToken.IssuerConfigurationBroken', 'AuthenticationFail.OIDCToken.IssuerNotMatch', 'AuthenticationFail.OIDCToken.PublicKeyFingerprintMismatch', 'AuthenticationFail.SAMLAssertion.Expired', 'AuthenticationFail.SAMLAssertion.Invalid', 'EntityNotExist.Role', 'EntityNotExist.SAMLProvider', 'EntityNotExist.Ticket', 'EntityNotExist.User', 'InternalError', 'InvalidParameter', 'InvalidParameter.AssumeRoleFor', 'InvalidParameter.Conditions', 'InvalidParameter.DurationSeconds', 'InvalidParameter.ExternalId', 'InvalidParameter.Policy.StarCount', 'InvalidParameter.PolicyGrammar', 'InvalidParameter.PolicySize', 'InvalidParameter.RoleArn', 'InvalidParameter.RoleSessionName', 'InvalidParameter.SourceIdentity', 'InvalidParameter.UserSessionName', 'InvalidVersion', 'ISVAuthenticationFail.SignatureNotMatch', 'MissingAccessKeyId', 'MissingParameter.OIDCProviderArn', 'MissingParameter.RoleArn', 'MissingParameter.RoleSessionName', 'MissingParameter.SAMLAssertion', 'MissingParameter.SAMLProviderArn', 'NoPermission', 'NoPermission.NotTrusted', 'NotSupported')
  self.assertEqual(len(set(public_codes)),39)
  for code in public_codes:
   with self.subTest(code=code):
    status,r=self.execute(dict(status=401,body=json.dumps({'Code':code,'Message':'SENSITIVE_TOKEN_BODY_STACK'})))
    self.assertEqual(status,1);self.assertEqual(r['category'],code);self.assertEqual(r['unknownCodeState'],'NONE');self.assertIsNone(r['unknownCodeSha256'])
 def test_exact_safe_message_categories(self):
  cases=[('AuthenticationFail.NoPermission','No such OIDC Provider registered.','OIDC_PROVIDER_NOT_REGISTERED'),('AuthenticationFail.NoPermission','There is no permission','PERMISSION_DENIED'),('AuthenticationFail.OIDCToken.HttpsUrlInvalid','Invoke url failed due to certificate chain validation','CERTIFICATE_CHAIN_VALIDATION_FAILED')]
  for code,message,expected in cases:
   with self.subTest(code=code,message=message):
    _,r=self.execute(dict(status=401,body=json.dumps({'Code':code,'Message':message})));self.assertEqual(r['messageCategory'],expected)
    for altered in (message+'SENSITIVE_TOKEN_BODY_STACK', 'SENSITIVE_TOKEN_BODY_STACK'+message, {'secret':'SENSITIVE_TOKEN_BODY_STACK'}):
     _,r=self.execute(dict(status=401,body=json.dumps({'Code':code,'Message':altered})));self.assertEqual(r['messageCategory'],'OTHER')
  _,r=self.execute(dict(status=401,body=json.dumps({'Code':'NoPermission','Message':cases[0][1]})));self.assertEqual(r['messageCategory'],'OTHER')
 def test_unknown_code_fingerprint_only(self):
  for field in ('Code','code'):
   for value in ('SENSITIVE_TOKEN_BODY_STACK','x'*256,'é'*128):
    with self.subTest(field=field,value=value):
     _,r=self.execute(dict(status=401,body=json.dumps({field:value,'Message':'SENSITIVE_TOKEN_BODY_STACK'})))
     self.assertEqual(r['category'],'OTHER');self.assertEqual(r['unknownCodeState'],'FINGERPRINTED');self.assertEqual(r['unknownCodeBytes'],len(value.encode()));self.assertEqual(r['unknownCodeSha256'],hashlib.sha256(value.encode()).hexdigest())
  for value in ('','x'*257,'é'*129):
   _,r=self.execute(dict(status=401,body=json.dumps({'Code':value})));self.assertEqual(r['unknownCodeState'],'OUT_OF_BOUNDS');self.assertIsNone(r['unknownCodeBytes']);self.assertIsNone(r['unknownCodeSha256'])
  for body in ({'Code':None},{'Code':42},{'Code':['SENSITIVE_TOKEN_BODY_STACK']},{'Code':'unknown','code':'conflict'},{'Message':'SENSITIVE_TOKEN_BODY_STACK'}):
   _,r=self.execute(dict(status=401,body=json.dumps(body)));self.assertEqual(r['unknownCodeState'],'NONE');self.assertIsNone(r['unknownCodeSha256'])
