// Inject globalThis.officeResources from repository resource files before this script.
// Runs inside the hardened sessions container; talks to its actual UDS service.
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const service=spawn(process.execPath,['/opt/sandbox/dist/main.js'],{stdio:'inherit'});
const stopped=new Promise(resolve=>service.once('exit',resolve));
async function call(method,path,body,token){return new Promise((resolve,reject)=>{
 const req=request({socketPath:process.env.SKILL_SANDBOX_SOCKET,method,path,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}},res=>{
 let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
});}
let session;
try{
 for(let i=0;i<100;i++){try{if((await call('GET','/healthz')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,20));}
 const made=await call('POST','/sessions',{});assert.equal(made.status,201);session=made.body;
 const prefix=`/sessions/${session.sessionId}`;
 const upload=async(path,content)=>assert.equal((await call('POST',`${prefix}/files`,{path,contentBase64:Buffer.from(content).toString('base64')},session.token)).status,200);
 for(const [name,content] of Object.entries(globalThis.officeResources))await upload(`/workspace/${name}`,content);
 await upload('/workspace/create.cjs',`const fs=require('fs');const {Document,Packer,Paragraph}=require('docx');const ExcelJS=require('exceljs');const Pptx=require('pptxgenjs');const {PDFDocument}=require('pdf-lib');
 (async()=>{fs.writeFileSync('/workspace/a.docx',await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('旧文本'),new Paragraph('UNCHANGED')]}]})));
 const p=new Pptx();p.addSlide().addText('旧文本',{x:1,y:1,w:5,h:1});await p.writeFile({fileName:'/workspace/a.pptx'});
 const w=new ExcelJS.Workbook();w.addWorksheet('Data').getCell('A1').value=1;w.addWorksheet('Other').getCell('B2').value='UNCHANGED';await w.xlsx.writeFile('/workspace/a.xlsx');
 const pdf=await PDFDocument.create();pdf.addPage([100,200]);pdf.addPage([300,400]);fs.writeFileSync('/workspace/a.pdf',await pdf.save());})();`);
 await upload('/workspace/check.cjs',`const fs=require('fs');const ExcelJS=require('exceljs');const {PDFDocument}=require('pdf-lib');(async()=>{const w=new ExcelJS.Workbook();await w.xlsx.readFile('/workspace/b.xlsx');if(w.getWorksheet('Data').getCell('A1').value!==7||w.getWorksheet('Other').getCell('B2').value!=='UNCHANGED')throw Error('xlsx mismatch');const p=await PDFDocument.load(fs.readFileSync('/workspace/b.pdf'));if(p.getPageCount()!==2||p.getPage(0).getWidth()!==300||p.getPage(1).getWidth()!==100)throw Error('pdf order');console.log('XLSX_PDF_STRUCTURE_OK');})();`);
 await upload('/workspace/check.py',`import zipfile\nfor ext,member in [('docx','word/document.xml'),('pptx','ppt/slides/slide1.xml')]:\n with zipfile.ZipFile('/workspace/a.'+ext) as a,zipfile.ZipFile('/workspace/b.'+ext) as b:\n  assert a.namelist()==b.namelist()\n  for name in a.namelist():\n   if name==member:\n    assert '新文本' in b.read(name).decode()\n   else: assert a.read(name)==b.read(name),name\nprint('OOXML_EDIT_OTHER_ENTRIES_UNCHANGED')\n`);
 const command=`node /workspace/create.cjs && python3 /workspace/edit-ooxml.py /workspace/a.docx /workspace/b.docx word/document.xml 旧文本 新文本 && python3 /workspace/edit-ooxml.py /workspace/a.pptx /workspace/b.pptx ppt/slides/slide1.xml 旧文本 新文本 && node /workspace/edit-xlsx.cjs /workspace/a.xlsx /workspace/b.xlsx Data A1 7 && node /workspace/pdf-pages.cjs /workspace/a.pdf /workspace/b.pdf 2,1 && python3 /workspace/check.py && node /workspace/check.cjs`;
 const result=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command,timeoutMs:120000},session.token);
 assert.equal(result.status,200);assert.equal(result.body.exitCode,0,JSON.stringify(result.body));
 assert.match(result.body.output,/OOXML_EDIT_OTHER_ENTRIES_UNCHANGED/);assert.match(result.body.output,/XLSX_PDF_STRUCTURE_OK/);
 for(const ext of ['docx','pptx','xlsx','pdf']){const file=await call('GET',`${prefix}/files?path=/workspace/b.${ext}`,undefined,session.token);assert.equal(file.status,200);assert.ok(file.body.sizeBytes>0);}
 console.log(result.body.output);console.log('FOUR_OFFICE_PACKAGES_REAL_SANDBOX_OK_RENDER_NOT_VERIFIED');
}finally{if(session)await call('DELETE',`/sessions/${session.sessionId}`,undefined,session.token);service.kill('SIGTERM');await stopped;}
