"""Secret-safe projection tests; not a database or startup acceptance claim."""
import json,subprocess,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class Diagnostic(unittest.TestCase):
    def test_real_exception_projection_and_secret_counterexamples(self):
        js=r'''
import assert from 'node:assert/strict';
import {startupDiagnostic}from './tests/fixtures/cn-api-startup/diagnostic.ts';
const secret='SYNTHETIC_SECRET_NOT_FOR_OUTPUT';
for(const message of ['postgres://fixture:'+secret+'@localhost/db','Bearer '+secret,'SELECT password FROM users WHERE token='+secret,'x'.repeat(100000)+secret]){
 const e=new Error(message);e.code=secret;e.stack+='\n at /missing/'+secret+'.ts:1:2';
 const d=startupDiagnostic(e),raw=JSON.stringify(d);
 assert(!raw.includes(secret));assert(!raw.includes('postgres://'));assert(!raw.includes('SELECT password'));assert(raw.length<4096);assert.equal(d.errorCode,null);
 assert.equal(d.messageBytes,Buffer.byteLength(message));assert.match(d.messageSha256,/^[a-f0-9]{64}$/);
}
const e=new Error('Cannot find package synthetic');e.code='ERR_MODULE_NOT_FOUND';
e.stack='Error: hidden\n at '+process.cwd()+'/apps/api/src/main.ts:59:21';
const d=startupDiagnostic(e);assert.equal(d.errorCode,'ERR_MODULE_NOT_FOUND');assert(d.categories.moduleResolution);
assert.deepEqual(d.frames,[{file:'apps/api/src/main.ts',line:59,column:21}]);
const pg=new Error('sensitive SQL');pg.code='42501';assert.equal(startupDiagnostic(pg).errorCode,'42501');
assert.equal(startupDiagnostic('raw token '+secret).errorType,'Unknown');
console.log(JSON.stringify({verified:true,productionAccepted:false}));
'''
        r=subprocess.run(['node','--import',str(ROOT/'apps/api/node_modules/tsx/dist/loader.mjs'),'--input-type=module','-e',js],cwd=ROOT,capture_output=True,text=True,timeout=30)
        self.assertEqual(r.returncode,0,r.stderr);self.assertTrue(json.loads(r.stdout)['verified'])
if __name__=='__main__':unittest.main()
