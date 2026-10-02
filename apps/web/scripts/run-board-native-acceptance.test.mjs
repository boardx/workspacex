import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {acceptanceCommand,suiteResult,runtimeExitProof,runtimeSpawnState,screenshotProof} from './run-board-native-acceptance.mjs';
const base=['--','pnpm','--filter','web','exec','playwright','test','--config'];
test('only complete native connector and file configurations may execute',()=>{
  for(const config of ['e2e/board-connector-existing-runtime.config.ts','e2e/board-files-completion.config.ts'])assert.equal(acceptanceCommand([...base,config])[7],config);
  for(const args of [[...base,'e2e/other.config.ts'],[...base,'e2e/board-files-completion.config.ts','--list'],[...base,'e2e/board-files-completion.config.ts','--grep','plain'],['--','echo','passed'],[]])assert.throws(()=>acceptanceCommand(args));
});
const files=['board-files-boundaries.spec.ts','board-files-filenames.spec.ts','board-files-placement.spec.ts','board-files-retry.spec.ts'];
const report=()=>({stats:{expected:6,unexpected:0,flaky:0,skipped:0},errors:[],suites:[{specs:[0,1,1,2,2,3].map(index=>({file:files[index],ok:true,tests:[{status:'expected',results:[{status:'passed'}]}]}))}]});
test('empty, skipped, missing, foreign and unsuccessful reports cannot satisfy full suite',()=>{
  assert.equal(suiteResult('files',report()).expected,6);
  for(const mutate of [value=>value.suites=[],value=>value.stats.skipped=6,value=>value.suites[0].specs.pop(),value=>value.suites[0].specs[0].file='other.spec.ts',value=>value.stats.unexpected=1,value=>value.errors=[{}],value=>value.suites[0].specs[0].tests[0].results[0].status='skipped']){const value=report();mutate(value);assert.throws(()=>suiteResult('files',value));}
});
test('early runtime exit, failed stop and signal cannot prove cleanup',()=>{
  runtimeExitProof(0,null,true);
  for(const args of [[0,null,false],[1,null,true],[null,'SIGTERM',true]])assert.throws(()=>runtimeExitProof(...args));
});
test('actual missing runtime executable has a handled fail-closed spawn state',async()=>{
  const child=spawn('/definitely-not-present/wsx-native-runtime',{stdio:'ignore'}),state=runtimeSpawnState(child);
  await new Promise(resolve=>child.once('close',resolve));assert.equal(state.failed,true);
});
test('all required desktop, mobile, retry and native download PNGs are necessary',()=>{
  const names=['R09-placement-1440.png','R09-reloaded-1440.png','R09-placement-390.png','R09-reloaded-390.png','R09-real-backend-503.png','R09-real-backend-retry-refreshed.png',...Array.from({length:7},(_,index)=>`R09-native-download-${index}.png`)];
  const images=names.map(originalName=>({originalName,width:originalName.includes('390')?390:1440,bytes:100,height:900}));
  screenshotProof('files',images);
  for(const imagesToReject of [[],images.slice(1),images.filter(image=>image.width!==390),images.map(image=>({...image,bytes:0}))])assert.throws(()=>screenshotProof('files',imagesToReject));
});
