const {test}=require('node:test'),assert=require('node:assert/strict'),{finishedRun,validatePlan}=require('./cn-maintenance-browser.cjs');
test('requires actual finished SSE and persisted run identity',()=>assert.equal(finishedRun('data: '+JSON.stringify({type:'CUSTOM',name:'execution_event',value:{runId:'run1'}})+'\ndata: '+JSON.stringify({type:'RUN_FINISHED'})),'run1'));
test('failed or empty stream never claims hello',()=>{assert.throws(()=>finishedRun(''));assert.throws(()=>finishedRun('data: '+JSON.stringify({type:'RUN_ERROR'})));});
test('passed flags cannot supply browser inputs',()=>assert.throws(()=>validatePlan({login:true,hello:true,asr:true,pdfDownload:true})));
