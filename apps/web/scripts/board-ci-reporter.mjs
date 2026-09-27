import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const jsonNames=new Set(['canonical-upload','pg-independent-pointers','pg-target-after-source-delete','migration-evidence.json','storage-runtime.json']);
const pngNames=new Set(['owner-after-refresh.png','independent-peer.png','roundtrip-owner-after-refresh.png','roundtrip-independent-peer.png']);
/** Deliberately omit config/env, test titles, stdout and error text from artifacts. */
export default class BoardCiReporter{
 tests=new Map();errors=[];
 onTestEnd(test,result){
  const row=this.tests.get(test.id)??{expectedStatus:test.expectedStatus,status:'unexpected',results:[]};
  const attachments=[];
  for(const attachment of result.attachments??[]){
   const json=jsonNames.has(attachment.name),png=pngNames.has(attachment.name)||/^meeting-room-\d+$/.test(attachment.name);
   if(!json&&!png)continue;
   if(attachment.contentType!==(json?'application/json':'image/png')){this.errors.push({code:'ATTACHMENT_TYPE'});continue;}
   try{
    const bytes=attachment.body?Buffer.from(attachment.body):readFileSync(attachment.path);
    if(json)JSON.parse(bytes.toString());else if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error();
    const directory=join(dirname(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE),'browser','attachments',String(this.tests.size),String(result.retry));mkdirSync(directory,{recursive:true});
    const name=attachment.name+(json&&!attachment.name.endsWith('.json')?'.json':png&&!attachment.name.endsWith('.png')?'.png':'');
    const path=join(directory,name);writeFileSync(path,bytes,{mode:0o600});attachments.push({name:attachment.name,path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
   }catch{this.errors.push({code:'ATTACHMENT_PERSIST_FAILED'});}
  }
  row.results.push({status:result.status,retry:result.retry,attachments});row.status=result.status==='passed'?'expected':'unexpected';this.tests.set(test.id,row);
 }
 onError(){this.errors.push({code:'PLAYWRIGHT_ERROR'});}
 onEnd(result){
  if(result.status!=='passed')this.errors.push({code:'PLAYWRIGHT_NOT_PASSED'});
  if(!process.env.PLAYWRIGHT_JSON_OUTPUT_FILE)throw Error('CI_RESULT_PATH_REQUIRED');
  writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE,JSON.stringify({errors:this.errors,suites:[{specs:[{tests:[...this.tests.values()]}]}]})+'\n',{mode:0o600});
 }
}
