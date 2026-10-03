import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {STICKY_CASE_IDS,stickyCaseExecutors} from './wsx-r06-suite-orchestration.mjs';

export const stickyAuthorityPath='docs/design/board-acceptance-history/sticky-mural-acceptance.md';
export const stickyAuthoritySha256='51009eb7337c68b874c7d0451c177f75866ce6d15237fa4625ef61a11f78bb1c';

export function verifyStickyAuthorityBytes(bytes){
 assert.equal(createHash('sha256').update(bytes).digest('hex'),stickyAuthoritySha256,'reviewed Sticky authority bytes changed');
 const rows=bytes.toString().split('\n').filter(line=>/^\| S\d{2} /.test(line)).map(line=>line.match(/^\| (S\d{2}) /)[1]);
 assert.deepEqual(rows,STICKY_CASE_IDS,'all eighteen authority cases are required');
 assert.deepEqual(Object.keys(stickyCaseExecutors),rows,'each authority row requires its existing executor');
 return{sha256:stickyAuthoritySha256,caseIds:rows,historicalSnapshot:true,currentApproval:false};
}

export function verifyStickySuiteAuthority(root){
 const path=join(root,stickyAuthorityPath);
 return{path,...verifyStickyAuthorityBytes(readFileSync(path))};
}
