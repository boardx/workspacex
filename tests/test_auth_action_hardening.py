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
const secret = 'SENSITIVE_TOKEN_BODY_STACK';
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
  const response = {statusCode: scenario.status || 200, body: Buffer.from(scenario.body || '{}')};
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
  self.assertEqual(result,dict(stage='STS_EXCHANGE',category='NoPermission',httpStatus=403,cleanupFailed=True))
 def test_real_js_unknown_provider_code_never_echoed(self):
  for body in ('not json SENSITIVE_TOKEN_BODY_STACK', json.dumps({'Code':'SENSITIVE_TOKEN_BODY_STACK'})):
   with self.subTest(body=body):
    code,result=self.execute(dict(status=400,body=body))
    self.assertEqual(code,1);self.assertEqual(result['category'],'OTHER');self.assertEqual(result['httpStatus'],400)
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
