import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixedNativeFailure,parseNativeFailure} from '../e2e/support/board-native-failure-stage.mjs';
import {fixedFilesFailure,parseFilesFailure} from '../e2e/support/board-files-failure-diagnostic.mjs';
import {readNativeReceipts,nativeReceiptVerdict,verifyNativeReceipts,safeNativeReceiptSummary} from '../../../.harness/scripts/lib/board-native-receipts.mjs';
test('native markers expose only fixed stage and retain no primary text',()=>{
 for(const [suite,file] of [['R01','board-r01-native-matrix.spec.ts'],['R08','board-peer-origin-close.spec.ts']]){
  const message='AggregateError: '+fixedNativeFailure(suite,'SETUP')+'\nsecret-token /private/report';
  assert.deepEqual(parseNativeFailure(message,file),{suite,stage:'SETUP',primaryFailure:'PRIVATE_REPORT_RETAINED'});
  assert(!JSON.stringify(parseNativeFailure(message,file)).includes('secret-token'));
  assert.equal(parseNativeFailure(message,'foreign.spec.ts'),null);
  assert.equal(parseNativeFailure(`${suite}_NATIVE_FAILURE SECRET_VALUE`,file),null);
 }
});
test('file marker preserves phase despite private reporter suffix',()=>{
 const message='AggregateError: '+fixedFilesFailure('DOWNLOAD_HEADERS',2,0,0)+'\nprivate-stack';
 assert.deepEqual(parseFilesFailure(message,{source:'ASSERTION',file:'board-files-filenames.spec.ts',line:68}),{phase:'DOWNLOAD_HEADERS',ordinal:2,deleteFailures:0,identityFailures:0});
 assert.equal(parseFilesFailure(message,{source:'ASSERTION',file:'foreign.ts',line:68}),null);
});
test('missing connectors never erases two measured failures and cannot pass',()=>{
 const root=mkdtempSync(join(tmpdir(),'board-receipts-'));const sha='a'.repeat(40);
 try{
  for(const [lane,config] of [['files','e2e/board-files-completion.config.ts'],['sync','e2e/board-peer-existing-runtime.config.ts']]){
   mkdirSync(join(root,lane));writeFileSync(join(root,lane,'receipt.json'),JSON.stringify({schemaVersion:1,sourceHead:sha,suiteConfig:config,status:'FAILED',failureReason:'ACCEPTANCE_FAILED',actualRuntimeExecution:true,requiredSuiteComplete:false,phase:'ACCEPTANCE'}));
  }
  const receipts=readNativeReceipts(root);assert.equal(receipts.connectors.status,'MISSING');assert.equal(receipts.files.failureReason,'ACCEPTANCE_FAILED');assert.equal(receipts.sync.failureReason,'ACCEPTANCE_FAILED');assert.equal(nativeReceiptVerdict(receipts,sha),'failure');assert.throws(()=>verifyNativeReceipts(receipts,sha));
  writeFileSync(join(root,'files','receipt.json'),'invalid json');assert.throws(()=>readNativeReceipts(root));
 }finally{rmSync(root,{recursive:true});}
});
test('connector workflow survives earlier failures but never runs after failed preparation',()=>{
 const workflow=readFileSync(new URL('../../../.github/workflows/board-native-acceptance.yml',import.meta.url),'utf8');
 assert.match(workflow,/- name: Create exact connector source checkout\n        id: connector_prepare\n        if: always\(\) && needs.batch.outputs.run == 'true'/);
 assert.match(workflow,/- name: Run complete native connector acceptance\n        if: always\(\) && needs.batch.outputs.run == 'true' && steps.connector_prepare.outcome == 'success'/);
});

test('public receipt summary rejects arbitrary values before verdict validation',()=>{
 const result=safeNativeReceiptSummary({connectors:{status:'SECRET_TOKEN',failureReason:'PRIVATE_PASSWORD',actualRuntimeExecution:'PRIVATE',requiredSuiteComplete:{secret:'PRIVATE'}}});
 assert.deepEqual(result.connectors,{status:'INVALID',failureReason:'UNRECOGNIZED_FAILURE',actualRuntimeExecution:null,requiredSuiteComplete:null});assert(!JSON.stringify(result).includes('PRIVATE'));assert(!JSON.stringify(result).includes('SECRET'));
});
test('R01 final proof preserves original stage with a separate secondary marker',()=>{
 assert.deepEqual(parseNativeFailure('AggregateError: R01_NATIVE_FAILURE LOGIN FINAL_PROOF','board-r01-native-matrix.spec.ts'),{suite:'R01',stage:'LOGIN',primaryFailure:'PRIVATE_REPORT_RETAINED',secondaryStage:'FINAL_PROOF'});
});
