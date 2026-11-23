/** Real owned headful Chromium print-preview. Never replaces print() or uses page.pdf(). */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { constants, accessSync, lstatSync, mkdirSync, readFileSync, writeFileSync, realpathSync, statfsSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { hostname } from 'node:os';
import { ProbeFailure, ORIGIN } from './devapp-aidt-auth-readonly.mjs';

const fail = code => { throw new ProbeFailure(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = value => value.replace(/\s+/g, ' ').trim();
const tools = Object.freeze({ xvfb: '/usr/bin/Xvfb', xdotool: '/usr/bin/xdotool', imageImport: '/usr/bin/import', pdfinfo: '/usr/bin/pdfinfo', pdftotext: '/usr/bin/pdftotext', pdftoppm: '/usr/bin/pdftoppm' });
export const PRINT_PAPERS = Object.freeze({ A4: Object.freeze([210,297]), A3: Object.freeze([297,420]), A1: Object.freeze([594,841]) });
const MAX_PDF = 32 * 1024 * 1024, MAX_PAGES = 100, MAX_RENDER = 8 * 1024 * 1024, MAX_DOCUMENT_RENDERS = 64 * 1024 * 1024;
const safeName = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,119}$/.test(value);
function privateDirectory(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0') || realpathSync(path) !== resolve(path)) fail('NATIVE_PRINT_PRIVATE_ROOT_INVALID');
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) fail('NATIVE_PRINT_PRIVATE_ROOT_INVALID');
  return resolve(path);
}
function command(bin, args, env, maxBuffer = 2 * 1024 * 1024) {
  const result = spawnSync(bin, args, { env, encoding: 'utf8', timeout: 15000, maxBuffer });
  if (result.status !== 0 || result.error) fail('NATIVE_PRINT_TOOL_FAILED');
  return result.stdout;
}
export function probeNativePrintCapabilities({ env = process.env, outputRoot, io = { accessSync, statfsSync, realpathSync, lstatSync } } = {}) {
  const missing = [];
  for (const [key,path] of Object.entries(tools)) try { io.accessSync(path, constants.X_OK); } catch { missing.push(key); }
  let freeBytes = null;
  try { const stat = io.statfsSync(outputRoot); freeBytes = Number(stat.bavail) * Number(stat.bsize); } catch { missing.push('private-output-filesystem'); }
  // This is a bounded per-document working reserve, not a claim that the full PDF plan fits.
  if (freeBytes !== null && freeBytes < 64 * 1024 * 1024) missing.push('minimum-working-space');
  return { available: missing.length === 0, blockCode: missing.length ? 'NATIVE_SYSTEM_PRINT_CAPABILITY_BLOCKED' : null,
    missing, headfulCapabilities: { dedicatedXvfb: !missing.includes('xvfb'), ownedWindowInput: !missing.includes('xdotool'), ownedWindowCapture: !missing.includes('imageImport'), independentPdfParser: !missing.includes('pdfinfo'), independentTextParser: !missing.includes('pdftotext'), allPageRenderer: !missing.includes('pdftoppm') },
    scope: 'Observed on this executing host only; local missing packages do not establish Dev capability', displayInherited: Boolean(env.DISPLAY), freeBytes };
}
export function xauthEntry(display, cookie) {
  const field = bytes => { const n=Buffer.alloc(2); n.writeUInt16BE(bytes.length); return Buffer.concat([n,bytes]); };
  const family=Buffer.alloc(2); family.writeUInt16BE(256);
  return Buffer.concat([family, field(Buffer.from(hostname())), field(Buffer.from(String(display))), field(Buffer.from('MIT-MAGIC-COOKIE-1')), field(cookie)]);
}
export async function prepareOwnedNativePrint({ env = process.env, outputRoot }) {
  const capability = probeNativePrintCapabilities({ env, outputRoot });
  if (!capability.available) return { available:false, ...capability, dispose: async () => {} };
  const parent=privateDirectory(outputRoot), root=join(parent, `native-print-${randomUUID()}`);
  mkdirSync(root,{mode:0o700}); const profile=join(root,'profile'), exports=join(root,'exports'); mkdirSync(profile,{mode:0o700}); mkdirSync(exports,{mode:0o700});
  // Pick an unused display, write its cookie before starting X, and never attach an inherited desktop.
  let display;
  for (let index=0;index<20;index++) {
    const candidate=900+randomBytes(2).readUInt16BE(0)%300;
    if(!existsSync(`/tmp/.X${candidate}-lock`)&&!existsSync(`/tmp/.X11-unix/X${candidate}`)){display=candidate;break;}
  }
  if(!display)fail('NATIVE_PRINT_NO_FREE_DISPLAY');
  const auth=join(root,'Xauthority'), cookie=randomBytes(16); writeFileSync(auth,xauthEntry(display,cookie),{mode:0o600,flag:'wx'});
  const childEnv={PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',TZ:'UTC',HOME:profile,XAUTHORITY:auth};
  const process=spawn(tools.xvfb,[`:${display}`,'-screen','0','1440x1000x24','-nolisten','tcp','-auth',auth,'-noreset'],{env:childEnv,stdio:'ignore'});
  let spawnError=false;process.once('error',()=>{spawnError=true;});
  try {
    await poll(async()=>{
      if(spawnError||process.exitCode!==null)fail('NATIVE_PRINT_DISPLAY_FAILED');
      if(!existsSync(`/tmp/.X11-unix/X${display}`))return false;
      const ready=spawnSync(tools.xdotool,['getdisplaygeometry'],{env:{...childEnv,DISPLAY:`:${display}`},encoding:'utf8',timeout:1000,maxBuffer:4096});
      return ready.status===0&&/^1440 1000\s*$/.test(ready.stdout);
    },8000);
  } catch(error) { process.kill('SIGTERM'); rmSync(root,{recursive:true,force:true}); throw error; }
  const runtimeEnv={...childEnv,DISPLAY:`:${display}`};
  return {available:true,root,profile,outputDirectory:exports,display:`:${display}`,env:runtimeEnv,xvfbPid:process.pid,
    // userDataDir is for launchPersistentContext; never inject --user-data-dir into launch().
    userDataDir:profile,launchOptions:{headless:false,args:['--enable-print-preview','--lang=en-US'],env:runtimeEnv,downloadsPath:exports},
    dispose:async()=>{ if(process.exitCode===null)process.kill('SIGTERM'); /* Parent owns final guarded recursive cleanup; keep actual PDFs. */ },
  };
}
export function parsePdfPageInfo(text, page) {
  const pagePattern = String(page).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const number='(-?\\d+(?:\\.\\d+)?)';
  function box(name) { const match=new RegExp(`^(?:Page\\s+${pagePattern}\\s+)?${name}:\\s*${number}\\s+${number}\\s+${number}\\s+${number}\\s*$`,'m').exec(text); return match?match.slice(1).map(Number):null; }
  const media=box('MediaBox'),crop=box('CropBox');
  const rotation = new RegExp(`^(?:Page\\s+${pagePattern}\\s+)?(?:Page rot|rot):\\s*(\\d+)`,'m').exec(text);
  if (!media || !crop || [...media,...crop].some(n=>!Number.isFinite(n)) || media[2]<=media[0] || media[3]<=media[1] || crop[2]<=crop[0] || crop[3]<=crop[1]) fail('NATIVE_PRINT_PDF_PAGE_GEOMETRY_MISSING');
  return {page,mediaBox:media,cropBox:crop,rotation:rotation?Number(rotation[1]):0};
}
export function assertPhysicalPaper(page, paper, tolerancePt=1.5) {
  const mm=PRINT_PAPERS[paper]; if(!mm)fail('NATIVE_PRINT_PAPER_REJECTED');
  const expected=mm.map(n=>n*72/25.4);const got=[page.mediaBox[2]-page.mediaBox[0],page.mediaBox[3]-page.mediaBox[1]];
  const match=(a,b)=>a.every((n,i)=>Math.abs(n-b[i])<=tolerancePt);
  if(!match(got,expected)&&!match(got,[expected[1],expected[0]]))fail('NATIVE_PRINT_PAPER_SIZE_MISMATCH');
  if(page.cropBox.some((n,i)=>Math.abs(n-page.mediaBox[i])>tolerancePt))fail('NATIVE_PRINT_PDF_CROPPED_PAGE');
  return {...page,paper,widthPt:got[0],heightPt:got[1],paperMeasured:true};
}
/** Independent text bounding boxes; unknown/malformed layout cannot be called unclipped. */
export function assertPdfTextLayout(xml, geometry) {
  if(typeof xml!=='string'||xml.length>8*1024*1024||!/<page\b/.test(xml))fail('NATIVE_PRINT_TEXT_LAYOUT_INVALID');
  const words=[...xml.matchAll(/<word\s+xMin="([\d.-]+)"\s+yMin="([\d.-]+)"\s+xMax="([\d.-]+)"\s+yMax="([\d.-]+)"[^>]*>([\s\S]*?)<\/word>/g)];
  if(words.length!==[...xml.matchAll(/<word\b/g)].length)fail('NATIVE_PRINT_TEXT_LAYOUT_INVALID');
  const width=geometry.widthPt,height=geometry.heightPt;
  for(const match of words){const [x1,y1,x2,y2]=match.slice(1,5).map(Number);if([x1,y1,x2,y2].some(n=>!Number.isFinite(n))||x1<-.75||y1<-.75||x2>width+.75||y2>height+.75||x1>x2||y1>y2)fail('NATIVE_PRINT_TEXT_CLIPPED');}
  return {wordCount:words.length,allTextBoxesInsidePage:true};
}
/** Decode only bounded 8-bit RGB/RGBA PNGs emitted by the independent page renderer. */
export function rasterEvidence(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length<80||bytes.length>MAX_RENDER||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail('NATIVE_PRINT_RENDER_INVALID');
  let width,height,channels;const parts=[];let ended=false;
  for(let at=8;at+12<=bytes.length;){const n=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8);if(n>MAX_RENDER||at+12+n>bytes.length)fail('NATIVE_PRINT_RENDER_INVALID');const data=bytes.subarray(at+8,at+8+n);if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=data[9]===2?3:data[9]===6?4:0;if(data[8]!==8||!channels||data[12]!==0)fail('NATIVE_PRINT_RENDER_UNSUPPORTED');}if(type==='IDAT')parts.push(data);if(type==='IEND'){ended=true;break;}at+=n+12;}
  if(!ended||!width||!height||width*height>4_000_000||!parts.length)fail('NATIVE_PRINT_RENDER_INVALID');
  const stride=width*channels,raw=inflateSync(Buffer.concat(parts),{maxOutputLength:(stride+1)*height});if(raw.length!==(stride+1)*height)fail('NATIVE_PRINT_RENDER_INVALID');let prior=Buffer.alloc(stride),ink=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)],row=Buffer.alloc(stride);if(filter>4)fail('NATIVE_PRINT_RENDER_UNSUPPORTED');for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=prior[x],c=x>=channels?prior[x-channels]:0;row[x]=(raw[y*(stride+1)+1+x]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;}for(let x=0;x<stride;x+=channels)if(row[x]<245||row[x+1]<245||row[x+2]<245)ink++;prior=row;}
  if(ink<12)fail('NATIVE_PRINT_RENDER_BLANK');
  return {width,height,inkPixels:ink,sha256:sha(bytes),rendered:true};
}
export function inspectSystemSavedPdf({filename,paper,requiredTexts=[],expectedPageCount,outputDirectory,env,runner=command}) {
  const root=privateDirectory(outputDirectory),path=resolve(filename);if(dirname(path)!==root||!safeName(basename(path).replace(/\.pdf$/,''))||!path.endsWith('.pdf'))fail('NATIVE_PRINT_PDF_PATH_REJECTED');
  const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.uid!==process.getuid()||before.size<512||before.size>MAX_PDF)fail('NATIVE_PRINT_PDF_BYTES_INVALID');
  const bytes=readFileSync(path);if(bytes.subarray(0,5).toString()!=='%PDF-'||!bytes.subarray(-2048).includes(Buffer.from('%%EOF')))fail('NATIVE_PRINT_PDF_BYTES_INVALID');
  const startedAt=Date.now(),deadline=startedAt+120000;let renderedBytes=0;
  const boundedRun=(...args)=>{if(Date.now()>deadline)fail('NATIVE_PRINT_INSPECTION_TIMEOUT');return runner(...args);};
  const info=boundedRun(tools.pdfinfo,['-box',path],env),count=Number(/^Pages:\s+(\d+)$/m.exec(info)?.[1]);
  if(!Number.isInteger(count)||count<1||count>MAX_PAGES||count!==expectedPageCount)fail('NATIVE_PRINT_PDF_PAGE_COUNT_MISMATCH');
  const extracted=boundedRun(tools.pdftotext,['-enc','UTF-8','-layout',path,'-'],env,8*1024*1024);
  if(extracted.includes('\uFFFD')||requiredTexts.some(t=>typeof t!=='string'||!normalize(extracted).includes(normalize(t))))fail('NATIVE_PRINT_PDF_TEXT_MISMATCH');
  const pages=[];
  for(let page=1;page<=count;page++){
    const geometry=assertPhysicalPaper(parsePdfPageInfo(boundedRun(tools.pdfinfo,['-f',String(page),'-l',String(page),'-box',path],env),page),paper);
    const xml=boundedRun(tools.pdftotext,['-f',String(page),'-l',String(page),'-bbox-layout','-enc','UTF-8',path,'-'],env,8*1024*1024);
    const layout=assertPdfTextLayout(xml,geometry),prefix=join(root,basename(path,'.pdf')+`-page-${String(page).padStart(3,'0')}`);
    if(renderedBytes>MAX_DOCUMENT_RENDERS-MAX_RENDER)fail('NATIVE_PRINT_RENDER_TOTAL_BOUND');
    boundedRun(tools.pdftoppm,['-f',String(page),'-l',String(page),'-singlefile','-scale-to','1600','-png',path,prefix],env);
    const rendered=readFileSync(prefix+'.png');renderedBytes+=rendered.length;const raster=rasterEvidence(rendered);pages.push({...geometry,widthMm:geometry.widthPt*25.4/72,heightMm:geometry.heightPt*25.4/72,...layout,...raster,textSha256:sha(Buffer.from(xml)),renderFilename:basename(prefix)+'.png'});
  }
  const after=lstatSync(path);if(after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs)fail('NATIVE_PRINT_PDF_CHANGED_DURING_INSPECTION');
  return {bytes,metadata:{method:'headful Chromium print-preview → normal Save to PDF file dialog → actual saved file',sha256:sha(bytes),bytes:bytes.length,paper,pageCount:count,pages,allPagesMeasured:true,allPagesRendered:true,renderedBytes,inspectionDurationMs:Date.now()-startedAt,requiredTextChecked:true,requiredTextCount:requiredTexts.length,glyphVisualReview:'PENDING_INDEPENDENT_REVIEW',fullReadableAcceptance:false}};
}

function targetUrl(url) {try{const u=new URL(url);return u.protocol==='chrome:'&&u.hostname==='print'&&u.pathname==='/'&&!u.username&&!u.password&&!u.hash;}catch{return false;}}
/** Target session commands are confined to the new chrome://print target of this owned browser. */
async function printSession(root,targetId) {
  const {sessionId}=await root.send('Target.attachToTarget',{targetId,flatten:false});let next=1;
  return {async evaluate(expression){const id=next++;return new Promise(async(done,reject)=>{const timer=setTimeout(()=>{root.off('Target.receivedMessageFromTarget',listener);reject(new ProbeFailure('NATIVE_PRINT_UI_TIMEOUT'));},5000);const listener=event=>{if(event.sessionId!==sessionId)return;let row;try{row=JSON.parse(event.message);}catch{return;}if(row.id!==id)return;clearTimeout(timer);root.off('Target.receivedMessageFromTarget',listener);if(row.error||row.result?.exceptionDetails)reject(new ProbeFailure('NATIVE_PRINT_UI_FAILED'));else done(row.result?.result?.value);};root.on('Target.receivedMessageFromTarget',listener);try{await root.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}})});}catch(error){clearTimeout(timer);root.off('Target.receivedMessageFromTarget',listener);reject(error);}});},async detach(){await root.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}};
}
const deep = `const all=(selector)=>{const seen=new Set(),out=[],q=[document];while(q.length){const r=q.shift();if(seen.has(r))continue;seen.add(r);for(const node of r.querySelectorAll(selector))out.push(node);for(const n of r.querySelectorAll('*'))if(n.shadowRoot)q.push(n.shadowRoot);}return out;};`;
const readyScript=`(()=>{${deep} const app=document.querySelector('print-preview-app');if(!app)return {ready:false};const buttons=all('cr-button,button').filter(n=>n.getClientRects().length&&!n.disabled);return {ready:buttons.some(n=>/^(Save|保存|另存为 PDF|Print|打印)$/i.test(n.innerText.trim())),buttons:buttons.map(n=>n.innerText.trim()).filter(Boolean).slice(0,10)};})()`;
const destinationScript=`(()=>{${deep}const selects=all('select').filter(n=>n.getClientRects().length&&!n.disabled);const item=selects.find(n=>[...n.options].some(o=>/^(Save to PDF|另存为 PDF|另存为PDF)$/i.test(o.text.trim())));if(!item)return false;const option=[...item.options].find(o=>/^(Save to PDF|另存为 PDF|另存为PDF)$/i.test(o.text.trim()));item.value=option.value;item.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`;
const cancelScript=`(()=>{${deep}const buttons=all('cr-button,button').filter(n=>n.getClientRects().length&&!n.disabled&&/^(Cancel|取消)$/i.test(n.innerText.trim()));if(buttons.length!==1)return false;buttons[0].click();return true;})()`;
const saveScript=`(()=>{${deep}const buttons=all('cr-button,button').filter(n=>n.getClientRects().length&&!n.disabled);const save=buttons.filter(n=>/^(Save|保存)$/i.test(n.innerText.trim()));if(save.length!==1)return false;save[0].click();return true;})()`;
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function poll(fn,timeout=12000){const until=Date.now()+timeout;do{const value=await fn();if(value)return value;await delay(150);}while(Date.now()<until);fail('NATIVE_PRINT_UI_TIMEOUT');}

export async function createNativePrintDriver({browser,context,outputRoot,ownedRuntime,assertSafe=async()=>{}}) {
  if(!ownedRuntime?.available||!ownedRuntime.env?.DISPLAY||ownedRuntime.env.DISPLAY!==ownedRuntime.display)fail('NATIVE_PRINT_OWNED_RUNTIME_REQUIRED');
  privateDirectory(outputRoot);privateDirectory(ownedRuntime.root);privateDirectory(ownedRuntime.outputDirectory);
  const root=await browser.newBrowserCDPSession(),{processInfo}=await root.send('SystemInfo.getProcessInfo');const ownedBrowsers=processInfo.filter(p=>p.type==='browser'&&Number.isSafeInteger(p.id)&&p.id>1);if(ownedBrowsers.length!==1)fail('NATIVE_PRINT_BROWSER_PID_UNVERIFIED');const browserPid=ownedBrowsers[0].id;
  let occupied=false;
  async function windowIds(){const result=spawnSync(tools.xdotool,['search','--onlyvisible','--pid',String(browserPid)],{env:ownedRuntime.env,encoding:'utf8',timeout:3000,maxBuffer:16384});if(result.status===1)return [];if(result.status!==0||result.error)fail('NATIVE_PRINT_WINDOW_QUERY_FAILED');return result.stdout.trim().split(/\s+/).filter(x=>/^\d+$/.test(x));}
  function assertWindow(id){if(!/^\d+$/.test(id))fail('NATIVE_PRINT_WINDOW_REJECTED');const pid=command(tools.xdotool,['getwindowpid',id],ownedRuntime.env).trim();if(pid!==String(browserPid))fail('NATIVE_PRINT_WINDOW_PID_MISMATCH');}
  return {available:true,browserPid,
    async preflight(){
      const baseline=(await root.send('Target.getTargets')).targetInfos;
      if(baseline.some(t=>targetUrl(t.url)))return {available:false,blockCode:'NATIVE_PRINT_PREEXISTING_DIALOG'};
      // An isolated, no-network synthetic capability probe only; no account/app/model or production content.
      const probe=await context.newPage();let ownedSession;
      try{
        await probe.route('**/*',route=>route.abort('blockedbyclient'));
        await probe.setContent('<!doctype html><title>Owned native print capability probe</title><button id="owned-print-probe">Open owned print capability dialog</button><p>合成系统打印能力探测；没有账户、模型或应用验收结果。</p>');
        await probe.evaluate(()=>document.querySelector('#owned-print-probe').addEventListener('click',()=>setTimeout(()=>window.print(),0)));
        await probe.locator('#owned-print-probe').click({noWaitAfter:true});
        const target=await poll(async()=>{const rows=(await root.send('Target.getTargets')).targetInfos.filter(t=>targetUrl(t.url)&&!baseline.some(b=>b.targetId===t.targetId));if(rows.length>1)fail('NATIVE_PRINT_MULTIPLE_DIALOGS');return rows[0];});
        ownedSession=await printSession(root,target.targetId);await poll(async()=>(await ownedSession.evaluate(readyScript))?.ready);
        const windows=await windowIds();if(windows.length!==1)fail('NATIVE_PRINT_OWNED_WINDOW_AMBIGUOUS');assertWindow(windows[0]);
        if(!await ownedSession.evaluate(cancelScript))fail('NATIVE_PRINT_CANCEL_ACTION_UNAVAILABLE');
        await poll(async()=>!(await root.send('Target.getTargets')).targetInfos.some(t=>t.targetId===target.targetId));
        return {available:true,headfulBrowserPidVerified:true,systemDialogObserved:true,systemDialogCancelled:true,probe:'isolated-no-network-synthetic-before-login',actualPdfSaved:false,scope:'Capability probe only; each actual product output still requires its own real dialog, saved PDF and all-page inspection'};
      }catch(error){return {available:false,blockCode:error instanceof ProbeFailure?error.code:'NATIVE_PRINT_CAPABILITY_PROBE_FAILED',headfulBrowserPidVerified:true,systemDialogObserved:false,scope:'This executing host/browser only; no live product conclusion'};}
      finally{if(ownedSession)await ownedSession.evaluate(cancelScript).catch(()=>false);await ownedSession?.detach();await probe.close({runBeforeUnload:false}).catch(()=>{});}
    },
    async capture({page,previewButton,paper,projectId,stage,artifactName,requiredTexts=[],imageHashes=[],expectedImageCount}){
      if(occupied)fail('NATIVE_PRINT_CONCURRENT_REQUEST');if(!PRINT_PAPERS[paper]||!safeName(artifactName)||!Number.isInteger(stage)||stage<1||stage>6)fail('NATIVE_PRINT_INTENT_REJECTED');
      const url=new URL(page.url());if(url.origin!==ORIGIN||url.pathname!==`/aidt/${projectId}`||Number(url.searchParams.get('step'))!==stage||page.context()!==context)fail('NATIVE_PRINT_PAGE_OWNER_REJECTED');
      occupied=true;let session,fileDialogWindow;
      try{
        const beforeTargets=(await root.send('Target.getTargets')).targetInfos;if(beforeTargets.some(t=>targetUrl(t.url)))fail('NATIVE_PRINT_PREEXISTING_DIALOG');
        await previewButton.click();const preview=page.getByTestId('research-print-preview');await preview.waitFor({state:'visible',timeout:15000});const choice=preview.getByTestId('research-print-paper');await choice.selectOption(paper);if(await choice.inputValue()!==paper)fail('NATIVE_PRINT_APP_PAPER_NOT_SELECTED');
        const confirm=preview.getByTestId('research-print-confirm');await poll(async()=>await confirm.isEnabled());
        const observation=await preview.getByTestId('research-print-pages').evaluate(async frame=>{const d=frame.contentDocument;if(!d)return null;const pages=[...d.querySelectorAll('.paper')],hashes=[];const imgs=[...d.images];if(imgs.length>100)throw new Error('bounded print images');for(const image of imgs){const source=image.currentSrc||image.src,u=new URL(source,location.href);if(!source.startsWith('data:image/')&&u.origin!==location.origin)throw new Error('print image scope');const response=await fetch(source);if(!response.ok)throw new Error('print image read failed');const bytes=await response.arrayBuffer();if(bytes.byteLength>16777216)throw new Error('bounded print bytes');hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join(''));}return {title:d.title,imageHashes:[...new Set(hashes)],css:[...d.querySelectorAll('style')].map(n=>n.textContent).join('\n'),pages:pages.map(p=>({width:p.offsetWidth,height:p.offsetHeight,text:p.innerText})),text:d.body.innerText,images:[...d.images].map(i=>({complete:i.complete,width:i.naturalWidth,height:i.naturalHeight}))};});
        if(!observation||!observation.pages.length||observation.pages.length>MAX_PAGES||observation.images.some(i=>!i.complete||i.width<1))fail('NATIVE_PRINT_PREVIEW_NOT_READY');
        const [w,h]=PRINT_PAPERS[paper];if(!observation.css.includes(`size:${w}mm ${h}mm`)||observation.pages.some(p=>Math.abs(p.width-w*96/25.4)>2||Math.abs(p.height-h*96/25.4)>2))fail('NATIVE_PRINT_APP_PAPER_GEOMETRY_MISMATCH');
        if(expectedImageCount!==undefined&&(!Number.isInteger(expectedImageCount)||expectedImageCount<0||expectedImageCount>100||observation.images.length!==expectedImageCount))fail('NATIVE_PRINT_APP_IMAGE_COUNT_MISMATCH');
        if(requiredTexts.some(t=>!normalize(observation.text).includes(normalize(t))))fail('NATIVE_PRINT_APP_CONTENT_MISMATCH');if(imageHashes.some(hash=>!/^[a-f0-9]{64}$/.test(hash)||!observation.imageHashes.includes(hash)))fail('NATIVE_PRINT_APP_IMAGE_MISMATCH');await assertSafe(observation.text);
        // The app button is the sole trigger. No Browser.printToPDF or page.pdf call exists.
        await confirm.click({noWaitAfter:true});const target=await poll(async()=>{const ts=(await root.send('Target.getTargets')).targetInfos.filter(t=>targetUrl(t.url)&&!beforeTargets.some(b=>b.targetId===t.targetId));if(ts.length>1)fail('NATIVE_PRINT_MULTIPLE_DIALOGS');return ts[0];});session=await printSession(root,target.targetId);await poll(async()=>(await session.evaluate(readyScript))?.ready);
        if(!await session.evaluate(destinationScript))fail('NATIVE_PRINT_PDF_DESTINATION_UNAVAILABLE');await poll(async()=>(await session.evaluate(readyScript))?.ready);
        const dialogWindows=await windowIds();if(dialogWindows.length!==1)fail('NATIVE_PRINT_OWNED_WINDOW_AMBIGUOUS');const previewWindow=dialogWindows[0];assertWindow(previewWindow);
        const previewScreen=join(ownedRuntime.outputDirectory,`${artifactName}-${paper.toLowerCase()}-system-dialog.png`);command(tools.imageImport,['-window',previewWindow,previewScreen],ownedRuntime.env);
        if(!await session.evaluate(saveScript))fail('NATIVE_PRINT_SAVE_ACTION_UNAVAILABLE');
        const saveWindow=await poll(async()=>{for(const id of await windowIds()){assertWindow(id);const name=command(tools.xdotool,['getwindowname',id],ownedRuntime.env).trim();if(/^(Save File|Save As|Save Print Output As|保存文件|另存为)/i.test(name))return id;}return null;});
        fileDialogWindow=saveWindow;
        const filename=join(ownedRuntime.outputDirectory,`${artifactName}-${paper.toLowerCase()}.pdf`);try{lstatSync(filename);fail('NATIVE_PRINT_OUTPUT_ALREADY_EXISTS');}catch(e){if(e instanceof ProbeFailure)throw e;if(e?.code!=='ENOENT')fail('NATIVE_PRINT_OUTPUT_STATE_UNKNOWN');}
        assertWindow(saveWindow);command(tools.xdotool,['key','--window',saveWindow,'ctrl+l'],ownedRuntime.env);command(tools.xdotool,['type','--window',saveWindow,'--clearmodifiers','--',filename],ownedRuntime.env);const saveScreen=join(ownedRuntime.outputDirectory,`${artifactName}-${paper.toLowerCase()}-save-dialog.png`);command(tools.imageImport,['-window',saveWindow,saveScreen],ownedRuntime.env);command(tools.xdotool,['key','--window',saveWindow,'Return'],ownedRuntime.env);
        let last=-1;await poll(async()=>{try{const st=lstatSync(filename);if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_PDF)fail('NATIVE_PRINT_PDF_BYTES_INVALID');const stable=st.size>512&&st.size===last;last=st.size;return stable;}catch(error){if(error instanceof ProbeFailure)throw error;return false;}},20000);
        const result=inspectSystemSavedPdf({filename,paper,requiredTexts,expectedPageCount:observation.pages.length,outputDirectory:ownedRuntime.outputDirectory,env:ownedRuntime.env});
        return {...result,screens:[basename(previewScreen),basename(saveScreen)],metadata:{...result.metadata,artifactName,stage,projectId,systemPrintDialogObserved:true,systemFileDialogObserved:true,uiSelectedPaper:paper,appPreviewPages:observation.pages.length,previewTextSha256:sha(Buffer.from(normalize(observation.text))),imageFixtureHashesRequested:[...imageHashes],previewImageHashes:observation.imageHashes,imageFixtureHashValidation:'required registered image hashes occur in the actual print-preview bytes; raster alone is not their proof',filename:basename(filename)}};
      }finally{
        // Cancel only this known owned save/print UI. Preserve any file with an unknown outcome for readback.
        if(fileDialogWindow)try{assertWindow(fileDialogWindow);const title=command(tools.xdotool,['getwindowname',fileDialogWindow],ownedRuntime.env).trim();if(/^(Save File|Save As|Save Print Output As|保存文件|另存为)/i.test(title))command(tools.xdotool,['key','--window',fileDialogWindow,'Escape'],ownedRuntime.env);}catch{/* The dialog may already have closed normally. */}
        if(session)await session.evaluate(cancelScript).catch(()=>false);await session?.detach();occupied=false;
      }
    },async dispose(){await root.detach();},
  };
}
