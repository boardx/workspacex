// True raster scan fixtures: PDF contains only embedded PNG pages, no text layer.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {request} from 'node:http';
import {randomUUID} from 'node:crypto';
const require=createRequire('/opt/sandbox/package.json');
const {PDFDocument}=require('pdf-lib');
execFileSync('python3',['-c',`from PIL import Image, ImageDraw, ImageFont
font=ImageFont.truetype('/usr/share/fonts/workspacex/NotoSansSC-Common.otf',48)
for n,text in [(1,'中国营收 120 Revenue 120'),(2,'第二页收入 340 Revenue 340')]:
 image=Image.new('RGB',(1200,400),'white');ImageDraw.Draw(image).text((40,120),text,font=font,fill='black');image.save('/tmp/ocr-'+str(n)+'.png')
 if n==1:image.save('/tmp/ocr.jpg')
`]);
const pdf=await PDFDocument.create();
for(const n of [1,2]){const image=await pdf.embedPng(readFileSync(`/tmp/ocr-${n}.png`));pdf.addPage([1200,400]).drawImage(image,{x:0,y:0,width:1200,height:400});}
const originals=[['png','image/png',readFileSync('/tmp/ocr-1.png')],['jpg','image/jpeg',readFileSync('/tmp/ocr.jpg')],['pdf','application/pdf',Buffer.from(await pdf.save())]];
async function call(method,path,body,token){return new Promise((resolve,reject)=>{const req=request({socketPath:process.env.SKILL_SANDBOX_SOCKET,method,path,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
const created=await call('POST','/sessions',{inputs:originals.map(([ext,,bytes])=>({path:`/inputs/scan.${ext}`,contentBase64:bytes.toString('base64')}))});assert.equal(created.status,201);
const {sessionId,token}=created.body,prefix=`/sessions/${sessionId}`;
const invoke=(ext,type,maxPages=10)=>call('POST',`${prefix}/executions`,{executionId:randomUUID(),command:`python3 /usr/local/lib/workspacex/ocr-document.py --source /inputs/scan.${ext} --media-type ${type} --directory /workspace/parsed-${randomUUID()} --max-pages ${maxPages} --max-pixels 4194304 --max-dimension 2048 --max-output-bytes 8388608 --timeout-ms 30000`,timeoutMs:30000},token);
try{
 for(const [ext,type,bytes] of originals){
  const directory=`/workspace/parsed-${randomUUID()}`;
  const result=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command:`python3 /usr/local/lib/workspacex/ocr-document.py --source /inputs/scan.${ext} --media-type ${type} --directory ${directory} --max-pages 10 --max-pixels 4194304 --max-dimension 2048 --max-output-bytes 8388608 --timeout-ms 30000`,timeoutMs:30000},token);
  assert.equal(result.status,200);assert.equal(result.body.exitCode,0,JSON.stringify(result));
  const output=await call('GET',`${prefix}/files?path=${directory}/structure.json`,undefined,token);assert.equal(output.status,200);
  const structure=JSON.parse(Buffer.from(output.body.contentBase64,'base64'));
  assert.equal(structure.pages.length,ext==='pdf'?2:1);
  for(const [index,page] of structure.pages.entries()){
   assert.equal(page.pageNumber,index+1);assert.ok(page.words.some(w=>w.text.includes(index===0?'120':'340')));assert.ok(page.words.some(w=>/[\u4e00-\u9fff]/.test(w.text)));
   for(const word of page.words){assert.ok(word.confidence>=0&&word.confidence<=100);assert.ok(word.bbox.x+word.bbox.width<=page.width&&word.bbox.y+word.bbox.height<=page.height);}
  }
  assert.equal((await call('GET',`${prefix}/files?path=/inputs/scan.${ext}`,undefined,token)).body.contentBase64,bytes.toString('base64'));
  console.log(JSON.stringify({format:ext,structure}));
 }
 const over=await invoke('pdf','application/pdf',1);assert.notEqual(over.body.exitCode,0);console.log('OCR_PAGE_LIMIT_REJECTED');
 console.log('OFFLINE_RASTER_PNG_JPEG_TWO_PAGE_PDF_OCR_VERIFIED');
}finally{assert.equal((await call('DELETE',prefix,undefined,token)).status,200);}
