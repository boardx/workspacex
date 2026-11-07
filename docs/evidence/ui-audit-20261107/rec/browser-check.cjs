const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve('apps/web/package.json'));
const ts = req('typescript');
const { chromium } = req('@playwright/test');
const sourceFiles = {
 '@text': 'apps/web/lib/i18n/namespaces/recording.ts',
 '@/lib/live-recording': 'apps/web/lib/live-recording.ts',
 '@/lib/pcm-audio-level': 'apps/web/lib/pcm-audio-level.ts',
 './use-local-microphone-check': 'apps/web/components/rec/use-local-microphone-check.ts',
 '@panel': 'apps/web/components/rec/local-microphone-check.tsx',
};
const sources = Object.fromEntries(Object.entries(sourceFiles).map(([key,file])=>[key,ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText]));
(async () => {
 const server = http.createServer((_,res)=>res.end('<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui;margin:24px;max-width:800px}button{padding:8px;margin:4px}section{border:1px solid #ddd;padding:20px}audio{display:block}</style><div id="root"></div>')).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const browser = await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 try {
 const context=await browser.newContext({permissions:['microphone']});const page=await context.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.addScriptTag({path:path.resolve('apps/web/node_modules/react/umd/react.development.js')});
 await page.addScriptTag({path:path.resolve('apps/web/node_modules/react-dom/umd/react-dom.development.js')});
 await page.evaluate((sources)=>{
 const loaded={react:React,'@/components/ui/button':{Button:(props)=>React.createElement('button',props)}};
 function load(key){if(loaded[key])return loaded[key];const exports={};new Function('exports','require',sources[key])(exports,load);loaded[key]=exports;return exports;}
 const text=load('@text').recordingZhCN;
 loaded['@/lib/i18n/provider']={useI18n:()=>({t:(key)=>text[key]??key})};
 const Panel=load('@panel').LocalMicrophoneCheck;
 window.handles=[];window.constraints=[];
 const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
 navigator.mediaDevices.getUserMedia=async (constraints)=>{window.constraints.push(constraints);const stream=await original(constraints);window.handles.push(stream);return stream;};
 window.mount=(device=null)=>ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Panel,{deviceId:device,onClose:()=>ReactDOM.createRoot}));
 window.root=ReactDOM.createRoot(document.getElementById('root'));
 window.root.render(React.createElement(Panel,{deviceId:null,onClose:()=>window.root.unmount()}));
 },sources);
 const network=[];page.on('request',r=>{if(!r.url().startsWith('blob:'))network.push(r.url());});page.on('websocket',()=>network.push('WEBSOCKET'));
 await page.getByRole('button',{name:'开始本地检查'}).waitFor();
 if(await page.evaluate(()=>window.handles.length)!==0)throw Error('captured before explicit action');
 await page.getByRole('button',{name:'开始本地检查'}).click();
 await page.getByRole('status').filter({hasText:'正在本地检查'}).waitFor();
 await page.getByRole('status').filter({hasText:'麦克风已释放'}).waitFor({timeout:12000});
 const state=await page.evaluate(()=>({tracks:window.handles.flatMap(s=>s.getTracks().map(t=>t.readyState)),source:document.querySelector('audio')?.src,level:document.querySelector('[role=meter]')?.getAttribute('aria-valuenow')}));
 if(state.tracks.some(s=>s!=='ended')||!state.source?.startsWith('blob:'))throw Error(JSON.stringify(state));
 await page.getByLabel('本地短句试听').evaluate(a=>a.play());
 await page.screenshot({path:'docs/evidence/ui-audit-20261107/rec/local-preview.png'});
 await page.getByRole('button',{name:'关闭检查并清除'}).click();
 if(await page.locator('audio').count())throw Error('preview retained after close');
 if(network.length)throw Error('unexpected external requests '+JSON.stringify(network));
 console.log('PASS: real Chromium fake media → actual startCapture PCM → 8s auto-stop → WAV playback → close cleanup; tracks ended; no network/ASR requests. Synthetic audio validates lifecycle, not human ASR accuracy.');
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
