// Inject globalThis.officeResources from repository resource files before this script.
// Runs inside the hardened sessions container; talks to its actual UDS service.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {request} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'1073741824');
assert.equal(readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),'128');
assert.equal(process.getuid(),1000);
console.log(readFileSync('/opt/sandbox/renderer-versions.txt','utf8'));
const startup=Date.now();
const service=spawn(process.execPath,['/opt/sandbox/dist/main.js'],{stdio:'inherit'});
const stopped=new Promise(resolve=>service.once('exit',resolve));
async function call(method,path,body,token){return new Promise((resolve,reject)=>{
 const req=request({socketPath:process.env.SKILL_SANDBOX_SOCKET,method,path,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}},res=>{
 let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
});}
let session;
try{
 for(let i=0;i<100;i++){try{if((await call('GET','/healthz')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,20));}
 console.log('SERVICE_READY_MS',Date.now()-startup);
 const made=await call('POST','/sessions',{});assert.equal(made.status,201);session=made.body;
 const prefix=`/sessions/${session.sessionId}`;
 const upload=async(path,content)=>assert.equal((await call('POST',`${prefix}/files`,{path,contentBase64:Buffer.from(content).toString('base64')},session.token)).status,200);
 for(const [name,content] of Object.entries(globalThis.officeResources))await upload(`/workspace/${name}`,content);
 await upload('/workspace/create.cjs',`const fs=require('fs');const {Document,Packer,Paragraph,Header,Footer}=require('docx');const ExcelJS=require('exceljs');const Pptx=require('pptxgenjs');const {PDFDocument}=require('pdf-lib');
 (async()=>{fs.writeFileSync('/workspace/a.docx',await Packer.toBuffer(new Document({sections:[{headers:{default:new Header({children:[new Paragraph('经营报告 页眉')]})},footers:{default:new Footer({children:[new Paragraph('工作空间 页脚')]})},children:[new Paragraph('旧文本'),new Paragraph({text:'季度经营回顾 2026 中文 淼喆',pageBreakBefore:true})]}]})));
 const p=new Pptx();p.addSlide().addText('旧文本',{x:1,y:1,w:5,h:1,fontFace:'Noto Sans CJK SC'});p.addSlide().addText('季度经营回顾 2026 中文 淼喆',{x:1,y:1,w:8,h:1,fontFace:'Noto Sans CJK SC'});await p.writeFile({fileName:'/workspace/a.pptx'});
 const w=new ExcelJS.Workbook();w.addWorksheet('Data').getCell('A1').value=1;w.getWorksheet('Data').getCell('A2').value='季度经营回顾 2026 中文 淼喆';w.getWorksheet('Data').getColumn(1).width=45;w.addWorksheet('Other').getCell('B2').value='UNCHANGED';await w.xlsx.writeFile('/workspace/a.xlsx');
 const pdf=await PDFDocument.create();pdf.registerFontkit(require('@pdf-lib/fontkit'));const font=await pdf.embedFont(fs.readFileSync('/usr/share/fonts/workspacex/NotoSansSC-Common.otf'));pdf.addPage([100,200]);pdf.addPage([300,400]).drawText('季度经营回顾 中文 淼喆',{x:10,y:200,size:12,font});fs.writeFileSync('/workspace/a.pdf',await pdf.save());})();`);
 await upload('/workspace/check.cjs',`const fs=require('fs');const ExcelJS=require('exceljs');const {PDFDocument}=require('pdf-lib');(async()=>{const w=new ExcelJS.Workbook();await w.xlsx.readFile('/workspace/b.xlsx');if(w.getWorksheet('Data').getCell('A1').value!==7||w.getWorksheet('Other').getCell('B2').value!=='UNCHANGED')throw Error('xlsx mismatch');const p=await PDFDocument.load(fs.readFileSync('/workspace/b.pdf'));if(p.getPageCount()!==2||p.getPage(0).getWidth()!==300||p.getPage(1).getWidth()!==100)throw Error('pdf order');console.log('XLSX_PDF_STRUCTURE_OK');})();`);
 await upload('/workspace/check.py',`import zipfile\nfor ext,member in [('docx','word/document.xml'),('pptx','ppt/slides/slide1.xml')]:\n with zipfile.ZipFile('/workspace/a.'+ext) as a,zipfile.ZipFile('/workspace/b.'+ext) as b:\n  assert a.namelist()==b.namelist()\n  for name in a.namelist():\n   if name==member:\n    assert '新文本' in b.read(name).decode()\n   else: assert a.read(name)==b.read(name),name\nprint('OOXML_EDIT_OTHER_ENTRIES_UNCHANGED')\n`);
 const command=`test ! -e /proc/version && test ! -e /etc/passwd && node /workspace/create.cjs && python3 /workspace/edit-ooxml.py /workspace/a.docx /workspace/b.docx word/document.xml 旧文本 新文本 && python3 /workspace/edit-ooxml.py /workspace/a.pptx /workspace/b.pptx ppt/slides/slide1.xml 旧文本 新文本 && node /workspace/edit-xlsx.cjs /workspace/a.xlsx /workspace/b.xlsx Data A1 7 && node /workspace/pdf-pages.cjs /workspace/a.pdf /workspace/b.pdf 2,1 && python3 /workspace/check.py && node /workspace/check.cjs`;
 const result=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command,timeoutMs:120000},session.token);
 assert.equal(result.status,200);assert.equal(result.body.exitCode,0,JSON.stringify(result.body));
 assert.match(result.body.output,/OOXML_EDIT_OTHER_ENTRIES_UNCHANGED/);assert.match(result.body.output,/XLSX_PDF_STRUCTURE_OK/);
 for(const ext of ['docx','pptx','xlsx','pdf']){
 const started=Date.now();
 const rendered=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command:`python3 /workspace/render-office.py /workspace/b.${ext} /workspace/render-${ext} && pdftotext /workspace/render-${ext}/b.pdf - && pdffonts /workspace/render-${ext}/b.pdf`,timeoutMs:120000},session.token);
 assert.equal(rendered.status,200);assert.equal(rendered.body.exitCode,0,JSON.stringify(rendered.body));
 assert.match(rendered.body.output,/季度经营回顾/);assert.match(rendered.body.output,/Noto/);
 console.log('RENDER_MS',ext,Date.now()-started);console.log(rendered.body.output);
 const manifest=JSON.parse(rendered.body.output.split('\n').find(line=>line.startsWith('{"pdf":')));
 assert.equal(manifest.pages.length,2);
 for(const path of [manifest.pdf,...manifest.pages]){
 const file=await call('GET',`${prefix}/files?path=${encodeURIComponent(path)}`,undefined,session.token);assert.equal(file.status,200);assert.ok(file.body.sizeBytes>0);
 console.log('ARTIFACT_BASE64',ext,path.split('/').pop(),file.body.contentBase64);
 }
 }
 await upload('/workspace/broken.docx','not an OOXML archive');
 const broken=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command:'python3 /workspace/render-office.py /workspace/broken.docx /workspace/broken-render',timeoutMs:120000},session.token);
 assert.equal(broken.status,200);assert.notEqual(broken.body.exitCode,0);assert.doesNotMatch(broken.body.output,/visualInspection/);
 console.log('BROKEN_INPUT_FAILS_WITHOUT_RENDER_MANIFEST');
 for(const metric of ['memory.peak','pids.peak'])if(existsSync('/sys/fs/cgroup/'+metric))console.log(metric,readFileSync('/sys/fs/cgroup/'+metric,'utf8').trim());
 console.log('FOUR_OFFICE_REAL_RENDER_CJK_TEXT_AND_EMBEDDED_FONT_OK');
}finally{if(session)await call('DELETE',`/sessions/${session.sessionId}`,undefined,session.token);service.kill('SIGTERM');await stopped;}
