// Run against committed real fixtures copied read-only to /tmp/w08-document-structure-fixtures.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {request} from 'node:http';
import {randomUUID} from 'node:crypto';

const fixtureRoot='/tmp/w08-document-structure-fixtures';
const fixtures=[
 ['pdf','cross-page-table.pdf','application/pdf'],
 ['docx','native-locators.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
 ['pptx','native-locators.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation'],
 ['xlsx','native-locators.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
];
const originals=fixtures.map(([format,name,mediaType])=>({format,name,mediaType,bytes:readFileSync(`${fixtureRoot}/${name}`)}));
async function call(method,path,body,token){return new Promise((resolve,reject)=>{const req=request({socketPath:process.env.SKILL_SANDBOX_SOCKET,method,path,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}},res=>{res.setEncoding('utf8');let value='';res.on('data',chunk=>value+=chunk);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(value)});}catch(error){reject(error);}});});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
const created=await call('POST','/sessions',{inputs:originals.map(({name,bytes})=>({path:`/inputs/${name}`,contentBase64:bytes.toString('base64')}))});
assert.equal(created.status,201);
const {sessionId,token}=created.body,prefix=`/sessions/${sessionId}`;
try{
 const parsed={};
 for(const original of originals){
  const output=`/workspace/${original.format}.json`;
  const command=`python3 /usr/local/lib/workspacex/structure-document.py --source /inputs/${original.name} --media-type ${original.mediaType} --output ${output}`;
  const result=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command,timeoutMs:30000},token);
  assert.equal(result.status,200);assert.equal(result.body.exitCode,0,JSON.stringify(result));
  const response=await call('GET',`${prefix}/files?path=${output}`,undefined,token);assert.equal(response.status,200);
  parsed[original.format]=JSON.parse(Buffer.from(response.body.contentBase64,'base64'));
  const source=await call('GET',`${prefix}/files?path=/inputs/${original.name}`,undefined,token);
  assert.equal(source.body.contentBase64,original.bytes.toString('base64'),'parser must not change source bytes');
 }
 const pdf=parsed.pdf;
 assert.deepEqual(pdf.tables.map(table=>table.pageNumber),[1,2]);
 assert.equal(pdf.tables[0].tableId,pdf.tables[1].tableId);
 assert.equal(pdf.tables[1].continuationDetection,'repeated_header_and_columns');
 assert.ok(pdf.chunks.some(chunk=>chunk.text==='450'&&chunk.locator.pageNumber===2&&chunk.locator.fragmentIndex===1));
 assert.ok(pdf.chunks.filter(chunk=>chunk.type==='pdf_table_cell').every(chunk=>chunk.locator.pageNumber===pdf.tables[chunk.locator.fragmentIndex].pageNumber));
 assert.ok(pdf.chunks.some(chunk=>chunk.type==='pdf_text'&&chunk.locator.pageNumber===2));
 const docx=parsed.docx;
 assert.ok(docx.chunks.some(chunk=>chunk.type==='docx_paragraph'&&chunk.text.includes('董事会摘要')&&chunk.locator.paragraphIndex===0));
 assert.ok(docx.chunks.some(chunk=>chunk.type==='docx_table_cell'&&chunk.text==='120'&&chunk.locator.tableIndex===0&&chunk.locator.rowIndex===1&&chunk.locator.columnIndex===1));
 assert.ok(docx.chunks.every(chunk=>!('pageNumber' in chunk.locator)));
 const pptx=parsed.pptx;
 assert.ok(pptx.chunks.some(chunk=>chunk.type==='pptx_element'&&chunk.locator.slideNumber===1&&chunk.text.includes('经营摘要')));
 assert.ok(pptx.chunks.some(chunk=>chunk.type==='pptx_table_cell'&&chunk.locator.slideNumber===2&&chunk.text==='120'));
 const xlsx=parsed.xlsx;
 assert.ok(xlsx.chunks.some(chunk=>chunk.locator.sheetName==='数据'&&chunk.locator.address==='B2'&&chunk.text==='120'));
 assert.ok(xlsx.chunks.some(chunk=>chunk.locator.address==='C2'&&chunk.text==='=B2*2'));
 assert.ok(xlsx.chunks.some(chunk=>chunk.locator.address==='A4'&&chunk.locator.mergedRange==='A4:B4'));
 const rejected=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command:'python3 /usr/local/lib/workspacex/structure-document.py --source /inputs/native-locators.docx --media-type application/vnd.oasis.opendocument.text --output /workspace/unsupported.json',timeoutMs:30000},token);
 assert.notEqual(rejected.body.exitCode,0);
 assert.equal((await call('GET',`${prefix}/files?path=/workspace/unsupported.json`,undefined,token)).status,404);
 console.log(JSON.stringify({pdfTables:pdf.tables,pdfCellCount:pdf.chunks.length,docxChunks:docx.chunks.length,pptxChunks:pptx.chunks.length,xlsxChunks:xlsx.chunks.length,unsupportedRejected:true,sourceBytesUnchanged:true}));
 console.log('OFFLINE_REAL_PDF_DOCX_PPTX_XLSX_LOCATORS_VERIFIED');
}finally{assert.equal((await call('DELETE',prefix,undefined,token)).status,200);}
