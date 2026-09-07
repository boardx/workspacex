// Real AnyDoc CLI inside the existing network-none, read-only, 1 GiB/128 PID session sandbox.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {request} from 'node:http';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
const require=createRequire('/opt/sandbox/package.json');
const {Document,Packer,Paragraph,Table,TableRow,TableCell}=require('docx');
const ExcelJS=require('exceljs'),PptxGenJS=require('pptxgenjs'),{PDFDocument}=require('pdf-lib');
const docx=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('中文文档'),new Table({rows:[new TableRow({children:[new TableCell({children:[new Paragraph('收入')]}),new TableCell({children:[new Paragraph('50')]})]})]})]}]}));
const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('数据');sheet.addRows([['分组','收入'],['甲',10],['乙',40]]);
const deck=new PptxGenJS();deck.addSlide().addText('中国营收 50',{x:1,y:1,w:6,h:1});
const pdf=await PDFDocument.create();pdf.registerFontkit(require('@pdf-lib/fontkit'));const font=await pdf.embedFont(readFileSync(process.env.SKILL_SANDBOX_CJK_FONT));
for(const text of ['第一页收入 10','第二页收入 40'])pdf.addPage([400,300]).drawText(text,{x:30,y:150,font,size:20});
const originals=[['docx',docx,'中文文档'],['xlsx',Buffer.from(await workbook.xlsx.writeBuffer()),'收入'],['pptx',Buffer.from(await deck.write({outputType:'nodebuffer'})),'中国营收'],['pdf',Buffer.from(await pdf.save()),'第二页收入'],['csv',Buffer.from('分组,收入\n甲,10\n乙,40\n'),'收入']];
async function call(method,path,body,token){return new Promise((resolve,reject)=>{const req=request({socketPath:process.env.SKILL_SANDBOX_SOCKET,method,path,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
assert.equal(readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'1073741824');assert.equal(readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),'128');
const created=await call('POST','/sessions',{inputs:[...originals.map(([format,bytes])=>({path:`/inputs/source.${format}`,contentBase64:bytes.toString('base64')})),{path:'/inputs/bad.docx',contentBase64:Buffer.from('not a document').toString('base64')}]});assert.equal(created.status,201);
const {sessionId,token}=created.body,prefix=`/sessions/${sessionId}`;
try{
 for(const [format,bytes,expected] of originals){
  const result=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command:`node /opt/sandbox/node_modules/@firecrawl/anydoc/cli.js /inputs/source.${format} --format ${format} --output /workspace/${format}.md`,timeoutMs:30000},token);
  assert.equal(result.status,200);assert.equal(result.body.exitCode,0,JSON.stringify(result));
  const output=await call('GET',`${prefix}/files?path=/workspace/${format}.md`,undefined,token);assert.equal(output.status,200);
  const markdown=Buffer.from(output.body.contentBase64,'base64').toString('utf8');assert.ok(markdown.includes(expected),`${format}: ${markdown}`);
  const after=await call('GET',`${prefix}/files?path=/inputs/source.${format}`,undefined,token);assert.equal(after.body.contentBase64,bytes.toString('base64'));
  console.log(JSON.stringify({format,sourceHash:createHash('sha256').update(bytes).digest('hex'),markdown,outputHash:createHash('sha256').update(Buffer.from(output.body.contentBase64,'base64')).digest('hex')}));
 }
 const bad=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command:'node /opt/sandbox/node_modules/@firecrawl/anydoc/cli.js /inputs/bad.docx --format docx --output /workspace/bad.md',timeoutMs:30000},token);
 assert.notEqual(bad.body.exitCode,0);assert.equal((await call('GET',`${prefix}/files?path=/workspace/bad.md`,undefined,token)).status,404);
 console.log('OFFLINE_ANYDOC_FIVE_FORMATS_AND_CORRUPT_FAILURE_VERIFIED');
}finally{assert.equal((await call('DELETE',prefix,undefined,token)).status,200);}
