import Reporter,{boardCiErrorReason} from './board-ci-reporter.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardSoakDiagnostics} from './board-soak-diagnostics.mjs';
test('retains phase and pool classifications without canary credentials, DSNs, exceptions or stacks',()=>{
 const canaries=['CANARY_BEARER_4176','CANARY_DSN_PASSWORD_4176','CANARY_EXCEPTION_4176','CANARY_STACK_4176'];
 const raw=`Authorization: Bearer ${canaries[0]}\npostgres://user:${canaries[1]}@private/db\nError: ${canaries[2]}\n at ${canaries[3]}\nBOARD_SOAK_PHASE initial-sync\ntimeout exceeded when trying to connect\nDEPENDENCY_UNAVAILABLE`;
 const report=boardSoakDiagnostics(raw,raw,1), retained=JSON.stringify(report);
 for(const secret of canaries)assert.equal(retained.includes(secret),false);
 assert.equal(report.phase,'initial-sync');assert.equal(report.pool.classification,'checkout-timeout');assert.equal(report.pool.checkoutTimeouts,2);
 assert.equal(retained.includes('postgres://'),false);assert.equal(retained.includes('Authorization'),false);
});
test('unknown diagnostic inputs and injected phase values cannot become retained strings',()=>{
 const retained=JSON.stringify(boardSoakDiagnostics('BOARD_SOAK_PHASE measurement CANARY\n','CANARY',{message:'CANARY'}));
 assert.equal(retained.includes('CANARY'),false);assert.equal(JSON.parse(retained).phase,'startup');assert.equal(JSON.parse(retained).exitCode,1);
});

test('reporter forwards only fixed phase markers and fixed pool classifications',()=>{
 const output=[],original=process.stdout.write;
 try{process.stdout.write=chunk=>{output.push(String(chunk));return true;};
  new Reporter().onStdOut('Bearer CANARY_TOKEN\nBOARD_SOAK_PHASE recovery\nError CANARY_STACK');
 }finally{process.stdout.write=original;}
 assert.equal(output.join(''),'BOARD_SOAK_PHASE recovery\n');
 assert.equal(boardCiErrorReason(new Error('timeout exceeded when trying to connect postgres://CANARY_DSN')),'POOL_CHECKOUT_TIMEOUT');
});
