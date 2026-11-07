const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {createRequire} = require('node:module');
const req = createRequire(path.resolve('apps/web/package.json'));
const ts = req('typescript');
const {chromium} = req('@playwright/test');
const compile = (file) => ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
(async () => {
 const server = http.createServer((_,res)=>res.end('<!doctype html><body></body>')).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const browser = await chromium.launch({headless:true});
 try {
 const page = await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.addScriptTag({path:req.resolve('html2canvas')});
 const png = compile('apps/web/lib/prototype-png-export.ts');
 await page.addScriptTag({content: "var exports={};" + png + ";window.captureFrame=exports.capturePrototypeFrame;window.buildSrcdoc=(fragment)=>'<body>'+fragment+'</body>';"});
 for(const width of [390,1100]) {
 await page.evaluate(async (width)=>{
 document.body.innerHTML='<div id="frame"></div>';
 const frame=document.getElementById('frame'); const iframe=document.createElement('iframe');
 iframe.setAttribute('sandbox','allow-scripts');iframe.style.cssText=`width:${width}px;height:600px`;
 const loaded=new Promise(r=>iframe.onload=r);
 iframe.srcdoc=window.buildSrcdoc('<style>body{background:white}h1{color:#111}table{background:#ccf;width:100%}td{padding:20px}</style><h1>资料列表</h1><input type="search" placeholder="搜索资料"><select><option>全部类型</option><option>PDF</option><option>Word</option></select><table><tbody><tr><td>访谈记录</td><td>PDF</td><td><button>打开</button></td></tr><tr><td>研究计划</td><td>Word</td><td><button>打开</button></td></tr></tbody></table>');
 frame.append(iframe);await loaded;
 const canvas=await window.captureFrame(frame,window.html2canvas);
 const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
 let colored=0,dark=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]<240&&pixels[i+3]>0)colored++;if(pixels[i]<80&&pixels[i+1]<80&&pixels[i+2]<80&&pixels[i+3]>0)dark++;}
 if(colored<10000||dark<100)throw Error(`blank PNG: colored=${colored},dark=${dark}`);
 window.png=canvas.toDataURL();
 },width);
 fs.writeFileSync(`docs/evidence/ui-audit-20261107/design-loop/png/${width}.png`,Buffer.from((await page.evaluate(()=>window.png)).split(',')[1],'base64'));
 console.log(`${width}px: real html2canvas PNG has content; live sandbox unchanged`);
 }
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
