'use strict';
const fs=require('node:fs');
const {chromium}=require('../apps/web/node_modules/@playwright/test');
const {verifyBaseline}=require('../scripts/directory-production-browser.cjs');
(async()=>{
 const system='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const b=await chromium.launch({headless:true,...(fs.existsSync(system)?{executablePath:system}:{})});
 try{
  const page=await b.newPage();let passed=0;
  for(const [name,html,expected] of [
   ['empty','<div data-testid="agent-directory-empty">No roles</div>',true],
   ['card','<a data-testid="agent-card-start-chat">Chat</a>',true],
   ['loading','<div data-testid="agent-directory-loading">Loading</div>',false],
   ['error','<div data-testid="agent-directory-error">Error</div>',false],
   ['denied','<div data-testid="agent-directory-denied">Denied</div>',false],
   ['late-error','<div id="state" data-testid="agent-directory-loading">Loading</div><script>setTimeout(()=>document.getElementById("state").dataset.testid="agent-directory-error",10)</script>',false],
  ]){
   await page.setContent('<main data-testid="agent-directory">'+html+'</main>');
   let ok=true;try{await verifyBaseline(page,150);}catch{ok=false;}
   if(ok!==expected)throw Error('Incorrect recovery verdict: '+name);passed++;
  }
  console.log(JSON.stringify({passed,realBrowser:true,loadingErrorDeniedRejected:true,production:false}));
 }finally{await b.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
