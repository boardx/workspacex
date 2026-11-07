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
 const interaction = compile('apps/web/lib/prototype-table-interactions.ts');
 const srcdoc = compile('apps/web/lib/html-page-srcdoc.ts');

 await page.addScriptTag({content:`var exports={};${interaction};var interactions=exports;exports={};var require=()=>interactions;${srcdoc};window.buildSrcdoc=exports.buildHtmlPageSrcdoc;`});
 for(const width of [390,1100]) {
 await page.evaluate(async (width)=>{
 document.body.innerHTML='<div id="frame"></div>';
 const frame=document.getElementById('frame'); const iframe=document.createElement('iframe');
 iframe.setAttribute('sandbox','allow-scripts');iframe.style.cssText=`width:${width}px;height:600px`;
 const loaded=new Promise(r=>iframe.onload=r);
 iframe.srcdoc=window.buildSrcdoc('<style>body{background:white}h1{color:#111}table{background:#ccf;width:100%}td{padding:20px}</style><h1>资料列表</h1><input type="search" placeholder="搜索资料"><select><option>全部类型</option><option>PDF</option><option>Word</option></select><table><thead><tr><th>名称</th><th>类型</th></tr></thead><tbody><tr><td>访谈记录</td><td>PDF</td><td><button>打开</button></td></tr><tr><td>研究计划</td><td>Word</td><td><button>打开</button></td></tr></tbody></table>');
 frame.append(iframe);await loaded;
 },width);
 const inner=page.frames()[1];
 await inner.locator('input').fill('不存在');
 if(await inner.locator('tbody tr:visible').count()!==0)throw Error('search did not filter');
 await inner.getByRole('status').filter({hasText:'没有匹配'}).waitFor();
 await inner.locator('input').fill('');await inner.locator('select').selectOption({label:'PDF'});
 if(await inner.locator('tbody tr:visible').count()!==1)throw Error('type did not filter');
 await inner.getByRole('button',{name:'打开'}).first().click();await inner.getByRole('dialog').waitFor();
 await inner.getByRole('button',{name:'关闭'}).click();
 console.log(`${width}px: sandbox preview search/type/open/close passed`);
 }
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
