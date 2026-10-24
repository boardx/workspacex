const {test}=require('node:test'),assert=require('node:assert/strict'),{finishedRun,validatePlan}=require('./cn-maintenance-browser.cjs');
test('requires actual finished SSE and persisted run identity',()=>assert.equal(finishedRun('data: '+JSON.stringify({type:'CUSTOM',name:'execution_event',value:{runId:'run1'}})+'\ndata: '+JSON.stringify({type:'RUN_FINISHED'})),'run1'));
test('failed or empty stream never claims hello',()=>{assert.throws(()=>finishedRun(''));assert.throws(()=>finishedRun('data: '+JSON.stringify({type:'RUN_ERROR'})));});
test('passed flags cannot supply browser inputs',()=>assert.throws(()=>validatePlan({login:true,hello:true,asr:true,pdfDownload:true})));

test('keeps legacy browser roots and admits only the new protected tool convention',()=>{
 const plan={publicUrl:'https://example.invalid',email:'fixture',password:'fixture',agentId:'agent',threadId:'thread',feedbackId:'feedback',githubIssueNumber:1,skillVersionId:'version',skillSentinel:'sentinel',skillPrompt:'prompt',pdfPrompt:'prompt',audioPath:'/etc/workspacex-cn/maintenance-activation/attempt/audio.wav',audioSha256:'a'.repeat(64),expectedTranscript:'fixture',browserExecutable:'/usr/bin/chromium',deploymentMarker:'fixture',playwrightModule:''};
 for(const prefix of ['/opt/workspacex-cn/release-tools/','/var/lib/workspacex-cn/auto-preparation-tools/'])assert.equal(validatePlan({...plan,playwrightModule:prefix+'a'.repeat(40)+'/playwright'}).deploymentMarker,'fixture');
 for(const root of ['/tmp/playwright','/var/lib/workspacex-cn/auto-preparation-tools/../runner/playwright'])assert.throws(()=>validatePlan({...plan,playwrightModule:root}));
});
