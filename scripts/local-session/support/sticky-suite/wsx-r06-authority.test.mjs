import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {verifyStickySuiteAuthority,verifyStickyAuthorityBytes,stickyAuthorityPath} from './wsx-r06-authority.mjs';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
test('committed historical authority binds all eighteen executors without claiming current approval',()=>{
 const receipt=verifyStickySuiteAuthority(root);
 assert.equal(receipt.caseIds.length,18);
 assert.equal(receipt.historicalSnapshot,true);
 assert.equal(receipt.currentApproval,false);
});
test('changed or omitted authority behavior cannot be silently accepted by a dynamic hash',()=>{
 const bytes=readFileSync(new URL('../../../../'+stickyAuthorityPath,import.meta.url));
 assert.throws(()=>verifyStickyAuthorityBytes(Buffer.concat([bytes,Buffer.from('\nchanged')])),/authority bytes changed/);
 assert.throws(()=>verifyStickyAuthorityBytes(Buffer.from(bytes.toString().replace(/^\| S18 .*$/m,''))),/authority bytes changed/);
});
