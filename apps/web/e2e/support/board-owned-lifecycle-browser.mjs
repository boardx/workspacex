import {spawn,execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import {access,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join} from 'node:path';

const runFile=promisify(execFile);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fail=code=>{throw new Error(code);};
const setupCodes=new Set(['OWNED_BROWSER_PROCESS_MISSING','OWNED_BROWSER_START_FAILED','OWNED_BROWSER_ENDPOINT_INVALID','OWNED_BROWSER_START_EXPIRED','OWNED_BROWSER_VERSION_MISMATCH','OWNED_BROWSER_DEFAULT_CONTEXT_MISSING','OWNED_BROWSER_DEADLINE_EXPIRED','OWNED_BROWSER_OPERATION_EXPIRED']);
const stages=new Set(['spawn','endpoint','connect','ready']);
const shellCodes=new Set(['NONE','SANDBOX_UNAVAILABLE','ROOT_SANDBOX_REJECTED','NAMESPACE_REJECTED']);
const data=(value,key)=>{try{return Object.getOwnPropertyDescriptor(value,key)?.value;}catch{return undefined;}};
export function decodeOwnedShellFailure(text){
 if(typeof text!=='string')return 'NONE';
 const boundedText=text.slice(0,8192);
 if(boundedText.includes('Running as root without --no-sandbox'))return 'ROOT_SANDBOX_REJECTED';
 if(boundedText.includes('No usable sandbox!'))return 'SANDBOX_UNAVAILABLE';
 if(boundedText.includes('Failed to move to new namespace'))return 'NAMESPACE_REJECTED';
 return 'NONE';
}
export function createOwnedShellDecoder(){
 let bytes=0,text='',code='NONE';
 return {push(chunk){if(code!=='NONE'||bytes>=8192||!Buffer.isBuffer(chunk))return;const part=chunk.subarray(0,8192-bytes);bytes+=part.length;text+=part.toString('utf8');code=decodeOwnedShellFailure(text);if(code!=='NONE'||bytes>=8192)text='';},read(){return code;},clear(){text='';bytes=8192;}};
}
export function ownedSetupDiagnostic(error,facts){
 const message=data(error,'message'),stage=data(facts,'stage'),shell=data(facts,'shell');
 const integer=(key,min,max)=>{const value=data(facts,key);return Number.isSafeInteger(value)&&value>=min&&value<=max?value:-1;};
 return {code:setupCodes.has(message)?message:'OWNED_BROWSER_UNKNOWN',stage:stages.has(stage)?stage:'unknown',shell:shellCodes.has(shell)?shell:'NONE',childExit:integer('childExit',0,255),childClosed:integer('childClosed',0,1),groupGone:integer('groupGone',0,1),cleanupFailed:integer('cleanupFailed',0,1)};
}
export function observeOwnedChild(child,owner){
 child.on('error',()=>{owner.spawnFailed=true;});
 child.once('exit',code=>{owner.childExit=Number.isSafeInteger(code)&&code>=0&&code<=255?code:-1;});
 child.once('close',()=>{owner.closed=true;});
}
const bounded=async(promise,ms)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('OWNED_BROWSER_OPERATION_EXPIRED')),ms);})]);}finally{clearTimeout(timer);}};
export function parseOwnedShellLocation(output,browsers,platform=process.platform,arch=process.arch){
 const entries=browsers.browsers?.filter(value=>value.name==='chromium-headless-shell');
 if(entries?.length!==1)fail('OWNED_BROWSER_PIN_INVALID');
 const pin=entries[0];
 const title=`${pin.title} ${pin.browserVersion} (playwright ${pin.name} v${pin.revision})`;
 const blocks=output.trim().split(/\r?\n\s*\r?\n/).map(block=>block.split(/\r?\n/));
 const matching=blocks.filter(lines=>lines[0]===title);
 if(matching.length!==1)fail('OWNED_BROWSER_DISCOVERY_INVALID');
 const lines=matching[0];
 const locations=lines.filter(line=>/^\s*Install location:/.test(line));
 if(lines[0]!==title||locations.length!==1)fail('OWNED_BROWSER_DISCOVERY_INVALID');
 const location=locations[0].replace(/^\s*Install location:\s*/,'');
 if(!isAbsolute(location)||basename(location)!==`chromium_headless_shell-${pin.revision}`)fail('OWNED_BROWSER_LOCATION_INVALID');
 const paths={'darwin-arm64':['chrome-headless-shell-mac-arm64','chrome-headless-shell'],'darwin-x64':['chrome-headless-shell-mac-x64','chrome-headless-shell'],'linux-x64':['chrome-headless-shell-linux64','chrome-headless-shell'],'linux-arm64':['chrome-linux','headless_shell']};
 const relative=paths[`${platform}-${arch}`];
 if(!relative)fail('OWNED_BROWSER_PLATFORM_UNSUPPORTED');
 return {executable:join(location,...relative),version:pin.browserVersion};
}
export async function validateOwnedExecutable(executable,fs={access,stat}){
 try{await fs.access(executable,constants.X_OK);if(!(await fs.stat(executable)).isFile())fail('OWNED_BROWSER_BINARY_MISSING');}
 catch{fail('OWNED_BROWSER_BINARY_MISSING');}
}
export async function releaseOwnedProcess(owner,io){
 io.signal(owner.pid,'SIGTERM');
 let until=io.now()+1000;
 while(io.exists(owner.pid)&&io.now()<until)await io.wait(25);
 if(io.exists(owner.pid))io.signal(owner.pid,'SIGKILL');
 until=io.now()+2000;
 while((io.exists(owner.pid)||!owner.closed)&&io.now()<until)await io.wait(25);
 if(io.exists(owner.pid)||!owner.closed)fail('OWNED_BROWSER_PROCESS_NOT_RELEASED');
 await io.remove(owner.directory);
}
export async function connectOwnedDefaultContext(chromium,endpoint,version){
 const browser=await chromium.connectOverCDP(endpoint,{noDefaults:true,timeout:5000});
 try{
  if(browser.version()!==version)fail('OWNED_BROWSER_VERSION_MISMATCH');
  const contexts=browser.contexts();
  if(contexts.length!==1||!contexts[0].pages()[0])fail('OWNED_BROWSER_DEFAULT_CONTEXT_MISSING');
  return {browser,context:contexts[0],page:contexts[0].pages()[0]};
 }catch(error){try{await bounded(browser.close(),2000);}catch{}throw error;}
}
export function requireOwnedDeadline(expired){if(expired)fail('OWNED_BROWSER_DEADLINE_EXPIRED');}
export function ownedShellArguments(directory,chromiumSandbox,platform=process.platform){
 if(chromiumSandbox!==undefined&&typeof chromiumSandbox!=='boolean')fail('OWNED_BROWSER_SANDBOX_POLICY_INVALID');
 // Match the installed Playwright runner's default Linux sandbox policy;
 // an explicitly enabled sandbox remains enabled, even if the host rejects it.
 return ['--headless','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${directory}`,'--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',...(platform==='linux'&&chromiumSandbox!==true?['--no-sandbox']:[]),'about:blank'];
}
export async function createOwnedLifecycleBrowser(chromium,{testBudgetMs,teardownBudgetMs,chromiumSandbox}){
 if(!Number.isSafeInteger(testBudgetMs)||testBudgetMs<=0||!Number.isSafeInteger(teardownBudgetMs)||teardownBudgetMs<=0||teardownBudgetMs>10000)fail('OWNED_BROWSER_BUDGET_INVALID');
 ownedShellArguments('',chromiumSandbox);
 // The public pnpm --filter web runner executes in the web package. Avoid
 // import.meta: Playwright transforms helpers imported by this CommonJS suite.
 const webDirectory=process.cwd(),projectPackage=join(webDirectory,'package.json');
 let pins;
 try{const project=JSON.parse(await readFile(projectPackage,'utf8'));if(project.name!=='web')fail('OWNED_BROWSER_PROJECT_INVALID');const require=createRequire(projectPackage);const packageDirectory=dirname(require.resolve('playwright-core/package.json'));pins=JSON.parse(await readFile(join(packageDirectory,'browsers.json'),'utf8'));}
 catch{fail('OWNED_BROWSER_PIN_UNREADABLE');}
 let output;
 try{output=(await runFile('pnpm',['exec','playwright','install','--dry-run','chromium-headless-shell'],{cwd:webDirectory,timeout:5000,maxBuffer:65536})).stdout;}
 catch{fail('OWNED_BROWSER_DISCOVERY_FAILED');}
 const {executable,version}=parseOwnedShellLocation(output,pins);
 await validateOwnedExecutable(executable);
 let directory;try{directory=await mkdtemp(join(tmpdir(),'wsx-board-owned-lifecycle-'));}catch{fail('OWNED_BROWSER_PROFILE_CREATE_FAILED');}
 const owner={pid:0,directory,closed:false,spawnFailed:false,childExit:-1};let browser,stderrDecoder,expired=false,released=false,stage='spawn',shell='NONE';
 const exists=pid=>{try{process.kill(-pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;fail('OWNED_BROWSER_PROCESS_PROBE_FAILED');}};
 const signal=(pid,value)=>{try{process.kill(-pid,value);}catch(error){if(error.code!=='ESRCH')fail('OWNED_BROWSER_PROCESS_SIGNAL_FAILED');}};
 const io={signal,exists,now:Date.now,wait,remove:path=>bounded(rm(path,{recursive:true,force:true}),1000)};
 let watchdog;
 const close=async()=>{
  const errors=[];
  if(browser)try{await bounded(browser.close(),2000);}catch{errors.push('OWNED_BROWSER_CLOSE_FAILED');}
  if(!released)try{if(owner.pid)await releaseOwnedProcess(owner,io);else await io.remove(directory);released=true;clearInterval(watchdog);}catch{errors.push('OWNED_BROWSER_PROCESS_NOT_RELEASED');}
  if(expired)errors.push('OWNED_BROWSER_DEADLINE_EXPIRED');
  if(errors.length)throw new Error(errors.join('+'));
 };
 try{
  const child=spawn(executable,ownedShellArguments(directory,chromiumSandbox),{detached:true,stdio:['ignore','ignore','pipe']});
  observeOwnedChild(child,owner);
  stderrDecoder=createOwnedShellDecoder();
  child.stderr.on('data',chunk=>{stderrDecoder.push(chunk);shell=stderrDecoder.read();});
  child.stderr.once('close',()=>{stderrDecoder.clear();});
  if(!Number.isSafeInteger(child.pid)||child.pid<=0)fail('OWNED_BROWSER_PROCESS_MISSING');
  owner.pid=child.pid;
  const expires=Date.now()+testBudgetMs+teardownBudgetMs;
  watchdog=setInterval(()=>{if(Date.now()>=expires){expired=true;try{if(!exists(owner.pid)&&owner.closed)clearInterval(watchdog);else signal(owner.pid,'SIGKILL');}catch{}}},250);
  stage='endpoint';let port=0;const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   if(owner.spawnFailed||owner.closed)fail('OWNED_BROWSER_START_FAILED');
   try{port=Number((await readFile(join(directory,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch(error){if(error.code!=='ENOENT')fail('OWNED_BROWSER_ENDPOINT_INVALID');}
   if(Number.isInteger(port)&&port>0&&port<=65535)break;
   await wait(25);
  }
  if(!Number.isInteger(port)||port<=0||port>65535)fail('OWNED_BROWSER_START_EXPIRED');
  stage='connect';const connected=await connectOwnedDefaultContext(chromium,`http://127.0.0.1:${port}`,version);browser=connected.browser;
  requireOwnedDeadline(expired);
  stage='ready';stderrDecoder.clear();
  return {...connected,close,assertLive:()=>requireOwnedDeadline(expired)};
 }catch(error){let cleanupFailed=0;try{await close();}catch{cleanupFailed=1;}stderrDecoder?.clear();let groupGone=-1;try{if(owner.pid)groupGone=Number(!exists(owner.pid));}catch{}const safe=ownedSetupDiagnostic(error,{stage,shell,childExit:owner.childExit,childClosed:Number(owner.closed),groupGone,cleanupFailed});const primary=new Error(`OWNED_BROWSER_SETUP_FAILED ${JSON.stringify(safe)}`);throw cleanupFailed?new AggregateError([primary,new Error('OWNED_BROWSER_SETUP_CLEANUP_FAILED')],'OWNED_BROWSER_SETUP_AND_CLEANUP_FAILED'):primary;}
}
