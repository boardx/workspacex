'use strict';
// Fixed pg_restore SQL-output consumer. Offline only; no process/DB/file is opened here.
const {TextDecoder}=require('node:util');
function requireProof(ok,code){if(!ok)throw Error(code);}
function prefix(sql){
 let i=0;
 while(i<sql.length){
  if(/\s/.test(sql[i])){i++;continue;}
  if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i+2);if(end<0)return '';i=end+1;continue;}
  if(sql.startsWith('/*',i)){let depth=1;i+=2;while(i<sql.length&&depth){if(sql.startsWith('/*',i)){depth++;i+=2;}else if(sql.startsWith('*/',i)){depth--;i+=2;}else i++;}requireProof(depth===0,'RESTORE_COMMENT_TRUNCATED');continue;}
  break;
 }
 return sql.slice(i);
}
class StatementScanner{
 constructor(){this.text='';this.mode='normal';this.depth=0;this.dollar='';this.escape=false;}
 feed(line){
  this.text+=line;requireProof(Buffer.byteLength(this.text)<=16*1024*1024,'RESTORE_STATEMENT_BOUND');
  const complete=[];
  for(let i=0;i<line.length;i++){
   const c=line[i],next=line[i+1];
   if(this.mode==='line'){if(c==='\n')this.mode='normal';continue;}
   if(this.mode==='block'){if(c==='/'&&next==='*'){this.depth++;i++;}else if(c==='*'&&next==='/'){if(--this.depth===0)this.mode='normal';i++;}continue;}
   if(this.mode==='dollar'){if(line.startsWith(this.dollar,i)){i+=this.dollar.length-1;this.mode='normal';}continue;}
   if(this.mode==='single'||this.mode==='double'){
    const quote=this.mode==='single'?"'":'"';
    if(this.mode==='single'&&this.escape&&c==='\\'){i++;continue;}
    if(c===quote){if(next===quote)i++;else this.mode='normal';}continue;
   }
   if(c==='-'&&next==='-'){this.mode='line';i++;continue;}
   if(c==='/'&&next==='*'){this.mode='block';this.depth=1;i++;continue;}
   if(c==="'"){this.mode='single';this.escape=i>0&&/[eE]/.test(line[i-1])&&(i<2||!/[\w$]/.test(line[i-2]));continue;}
   if(c==='"'){this.mode='double';continue;}
   if(c==='$'){const match=line.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);if(match){this.mode='dollar';this.dollar=match[0];i+=match[0].length-1;continue;}}
   if(c===';'){
    const suffix=line.slice(i+1);const end=this.text.length-suffix.length;
    complete.push(this.text.slice(0,end));this.text=suffix;
   }
  }
  return complete;
 }
 finish(){requireProof(this.mode==='normal'&&prefix(this.text).trim()==='','RESTORE_SQL_TRUNCATED');}
}
async function* lines(chunks){
 let pending=Buffer.alloc(0);
 for await(const chunk of chunks){requireProof(Buffer.isBuffer(chunk)&&chunk.length>0&&chunk.length<=65536,'RESTORE_DECODE_CHUNK');pending=Buffer.concat([pending,chunk]);
  let index;while((index=pending.indexOf(10))!==-1){const line=pending.subarray(0,index+1);pending=pending.subarray(index+1);requireProof(line.length<=16*1024*1024,'RESTORE_LINE_BOUND');yield line;}
  requireProof(pending.length<=16*1024*1024,'RESTORE_LINE_BOUND');
 }
 if(pending.length)yield pending;
}
async function* decodeSql(chunks){
 const iterator=lines(chunks)[Symbol.asyncIterator]();const scanner=new StatementScanner();const decoder=new TextDecoder('utf-8',{fatal:true});let restriction=null;
 while(true){const row=await iterator.next();if(row.done)break;const text=decoder.decode(row.value);
  if(text.startsWith('\\')){
   requireProof(scanner.mode==='normal'&&prefix(scanner.text).trim()==='','RESTORE_META_IN_STATEMENT');
   const match=text.match(/^\\(restrict|unrestrict) ([A-Za-z0-9]{1,128})\r?\n?$/);requireProof(match,'RESTORE_META_REJECTED');
   if(match[1]==='restrict'){requireProof(restriction===null,'RESTORE_META_PAIR');restriction=match[2];}else{requireProof(restriction===match[2],'RESTORE_META_PAIR');restriction=null;}continue;
  }
  const statements=scanner.feed(text);
  for(const sql of statements){
   const clean=prefix(sql);
   if(/^COPY\b/i.test(clean)){
    requireProof(/^COPY\s[\s\S]+\sFROM\s+stdin;\s*$/i.test(clean)&&statements.length===1&&scanner.text.trim()==='','RESTORE_COPY_FORMAT');
    let consumed=false;
    async function* copy(){
     while(true){const data=await iterator.next();requireProof(!data.done,'RESTORE_COPY_TRUNCATED');
      if(data.value.equals(Buffer.from('\\.\n'))||data.value.equals(Buffer.from('\\.\r\n'))){consumed=true;return;}
      for(let i=0;i<data.value.length;i+=65536)yield data.value.subarray(i,i+65536);
     }
    }
    yield {kind:'copy',sql:clean,chunks:copy()};requireProof(consumed,'RESTORE_COPY_NOT_CONSUMED');
   }else yield {kind:'sql',sql:clean};
  }
 }
 scanner.finish();requireProof(restriction===null,'RESTORE_META_UNCLOSED');
}
module.exports={decodeSql,StatementScanner};
