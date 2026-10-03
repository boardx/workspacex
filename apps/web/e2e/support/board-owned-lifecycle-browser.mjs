import {spawn,execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import {access,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join} from 'node:path';

const require=createRequire(import.meta.url),runFile=promisify(execFile);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fail=code=>{throw new Error(code);};
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
export async function createOwnedLifecycleBrowser(chromium,{testBudgetMs,teardownBudgetMs}){
 if(!Number.isSafeInteger(testBudgetMs)||testBudgetMs<=0||!Number.isSafeInteger(teardownBudgetMs)||teardownBudgetMs<=0||teardownBudgetMs>10000)fail('OWNED_BROWSER_BUDGET_INVALID');
 let pins;
 try{const packageDirectory=dirname(require.resolve('playwright-core/package.json'));pins=JSON.parse(await readFile(join(packageDirectory,'browsers.json'),'utf8'));}
 catch{fail('OWNED_BROWSER_PIN_UNREADABLE');}
 let output;
 try{output=(await runFile('pnpm',['exec','playwright','install','--dry-run','chromium-headless-shell'],{cwd:join(import.meta.dirname,'../..'),timeout:5000,maxBuffer:65536})).stdout;}
 catch{fail('OWNED_BROWSER_DISCOVERY_FAILED');}
 const {executable,version}=parseOwnedShellLocation(output,pins);
 await validateOwnedExecutable(executable);
 let directory;try{directory=await mkdtemp(join(tmpdir(),'wsx-board-owned-lifecycle-'));}catch{fail('OWNED_BROWSER_PROFILE_CREATE_FAILED');}
 const owner={pid:0,directory,closed:false};let browser,expired=false,released=false;
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
  const child=spawn(executable,['--headless','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${directory}`,'--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check','about:blank'],{detached:true,stdio:'ignore'});
  let spawnFailed=false;child.on('error',()=>{spawnFailed=true;});
  if(!Number.isSafeInteger(child.pid)||child.pid<=0)fail('OWNED_BROWSER_PROCESS_MISSING');
  owner.pid=child.pid;child.once('close',()=>{owner.closed=true;});
  const expires=Date.now()+testBudgetMs+teardownBudgetMs;
  watchdog=setInterval(()=>{if(Date.now()>=expires){expired=true;try{if(!exists(owner.pid)&&owner.closed)clearInterval(watchdog);else signal(owner.pid,'SIGKILL');}catch{}}},250);
  let port=0;const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   if(spawnFailed||owner.closed)fail('OWNED_BROWSER_START_FAILED');
   try{port=Number((await readFile(join(directory,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch(error){if(error.code!=='ENOENT')fail('OWNED_BROWSER_ENDPOINT_INVALID');}
   if(Number.isInteger(port)&&port>0&&port<=65535)break;
   await wait(25);
  }
  if(!Number.isInteger(port)||port<=0||port>65535)fail('OWNED_BROWSER_START_EXPIRED');
  const connected=await connectOwnedDefaultContext(chromium,`http://127.0.0.1:${port}`,version);browser=connected.browser;
  requireOwnedDeadline(expired);
  return {...connected,close,assertLive:()=>requireOwnedDeadline(expired)};
 }catch(error){let cleanup;try{await close();}catch{cleanup=new Error('OWNED_BROWSER_SETUP_CLEANUP_FAILED');}throw cleanup?new AggregateError([new Error('OWNED_BROWSER_SETUP_FAILED'),cleanup],'OWNED_BROWSER_SETUP_AND_CLEANUP_FAILED'):new Error('OWNED_BROWSER_SETUP_FAILED');}
}
