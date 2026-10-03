import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseOwnedShellLocation,validateOwnedExecutable,releaseOwnedProcess,connectOwnedDefaultContext,requireOwnedDeadline} from './board-owned-lifecycle-browser.mjs';
const require=createRequire(import.meta.url);
const pins=JSON.parse(readFileSync(join(dirname(require.resolve('playwright-core/package.json')),'browsers.json'),'utf8'));
const pin=pins.browsers.find(value=>value.name==='chromium-headless-shell');
const location=`/owned/chromium_headless_shell-${pin.revision}`;
const output=`${pin.title} ${pin.browserVersion} (playwright ${pin.name} v${pin.revision})\n  Install location:    ${location}\n  Download url:        ignored`;
test('discovery binds installed shell pin and platform executable',()=>{
 assert.deepEqual(parseOwnedShellLocation(output,pins,'linux','x64'),{executable:join(location,'chrome-headless-shell-linux64','chrome-headless-shell'),version:pin.browserVersion});
});
test('wrong browser, duplicate locations, unsupported platform and revision are rejected',()=>{
 for(const value of [output.replace(pin.title,'Other browser'),`${output}\n Install location: /second`,output.replace(location,'/owned/chromium_headless_shell-wrong')])assert.throws(()=>parseOwnedShellLocation(value,pins,'linux','x64'));
 assert.throws(()=>parseOwnedShellLocation(output,pins,'unknown','x64'),/PLATFORM_UNSUPPORTED/);
});
test('real dry-run block shape permits FFmpeg without using its location',()=>{
 const ffmpeg=pins.browsers.find(value=>value.name==='ffmpeg');
 const realShape=`${output}\n\nFFmpeg (playwright ffmpeg v${ffmpeg.revision})\n  Install location:    /owned/ffmpeg-${ffmpeg.revision}\n  Download url:        ignored\n`;
 assert.equal(parseOwnedShellLocation(realShape,pins,'linux','x64').executable,join(location,'chrome-headless-shell-linux64','chrome-headless-shell'));
 assert.throws(()=>parseOwnedShellLocation(`${realShape}\n${output}`,pins,'linux','x64'),/DISCOVERY_INVALID/);
 assert.throws(()=>parseOwnedShellLocation(realShape.replace(pin.title,'Other browser'),pins,'linux','x64'),/DISCOVERY_INVALID/);
});
test('missing executable and non-file cannot pass discovery validation',async()=>{
 await assert.rejects(validateOwnedExecutable('/missing',{access:async()=>{throw new Error('secret path');},stat:async()=>({isFile:()=>true})}),/^Error: OWNED_BROWSER_BINARY_MISSING$/);
 await assert.rejects(validateOwnedExecutable('/directory',{access:async()=>{},stat:async()=>({isFile:()=>false})}),/BINARY_MISSING/);
});
test('expiry always rejects proof',()=>{assert.doesNotThrow(()=>requireOwnedDeadline(false));assert.throws(()=>requireOwnedDeadline(true),/DEADLINE_EXPIRED/);});
test('public connection uses noDefaults and existing context without newContext',async()=>{
 const page={},context={pages:()=>[page]},browser={version:()=>pin.browserVersion,contexts:()=>[context],close:async()=>{},newContext:()=>{throw new Error('forbidden');}};
 let options;
 const result=await connectOwnedDefaultContext({connectOverCDP:async(_endpoint,value)=>{options=value;return browser;}},'loopback',pin.browserVersion);
 assert.deepEqual(options,{noDefaults:true,timeout:5000});assert.equal(result.context,context);assert.equal(result.page,page);
});
test('wrong connected version and missing default page cannot pass',async()=>{
 let closed=0;const browser={version:()=>pin.browserVersion,contexts:()=>[{pages:()=>[]}],close:async()=>{closed++;}};
 await assert.rejects(connectOwnedDefaultContext({connectOverCDP:async()=>browser},'loopback','wrong'),/VERSION_MISMATCH/);
 await assert.rejects(connectOwnedDefaultContext({connectOverCDP:async()=>browser},'loopback',pin.browserVersion),/DEFAULT_CONTEXT_MISSING/);
 assert.equal(closed,2);
});
function fakeCleanup({groupGone,childClosed}){
 let now=0,removed=0;const signals=[];
 return {owner:{pid:42,directory:'/owned/profile',closed:childClosed},io:{signal:(_pid,signal)=>signals.push(signal),exists:()=>!groupGone,now:()=>now,wait:async ms=>{now+=ms;},remove:async()=>{removed++;}},removed:()=>removed,signals};
}
test('group gone without child close retains profile and fails',async()=>{
 const fake=fakeCleanup({groupGone:true,childClosed:false});await assert.rejects(releaseOwnedProcess(fake.owner,fake.io),/PROCESS_NOT_RELEASED/);assert.equal(fake.removed(),0);
});
test('child close without group gone kills only owned group and retains profile',async()=>{
 const fake=fakeCleanup({groupGone:false,childClosed:true});await assert.rejects(releaseOwnedProcess(fake.owner,fake.io),/PROCESS_NOT_RELEASED/);assert.deepEqual(fake.signals,['SIGTERM','SIGKILL']);assert.equal(fake.removed(),0);
});
test('profile removed only when actual child close and group gone agree',async()=>{
 const fake=fakeCleanup({groupGone:true,childClosed:true});await releaseOwnedProcess(fake.owner,fake.io);assert.equal(fake.removed(),1);
});
test('actual Playwright CommonJS suite discovers owned fixture without starting a browser',()=>{
 const env={...process.env,COMPOSE_PROJECT_NAME:'owned-fixture-discovery-no-services'};
 const ports=['WORKSPACEX_API_PORT','WORKSPACEX_WEB_PORT','WORKSPACEX_MODEL_PROVIDER_PORT','WORKSPACEX_DEEP_AGENT_PROVIDER_PORT','WORKSPACEX_LOOPBACK_SANDBOX_PORT','WORKSPACEX_ASR_PROVIDER_PORT','WORKSPACEX_MAIL_PROVIDER_PORT','PGPORT'];
 ports.forEach((name,index)=>{env[name]=String(19000+index);});
 let output;
 try{output=execFileSync('pnpm',['exec','playwright','test','--config','playwright.board-api-ws-objectstore-acceptance.config.ts','--list'],{cwd:join(import.meta.dirname,'../..'),env,timeout:20000,maxBuffer:262144,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
 catch{assert.fail('OWNED_FIXTURE_PLAYWRIGHT_DISCOVERY_FAILED');}
 assert.match(output,/same-browser tabs drain a shared durable outbox without duplicate commits/);
 assert.doesNotMatch(output,/Cannot use 'import\.meta' outside a module/);
});
