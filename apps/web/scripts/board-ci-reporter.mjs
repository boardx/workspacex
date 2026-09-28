import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const jsonNames=new Set(['canonical-upload','pg-independent-pointers','pg-target-after-source-delete','migration-evidence.json','storage-runtime.json',
 'captured-vendor-evidence.json','captured-vendor-runtime.json','agent-api-evidence','same-browser-outbox-evidence','portable-roundtrip','portable-revocation-race','api-ws-objectstore-runtime.json']);
const pngNames=new Set(['owner-after-refresh.png','independent-peer.png','roundtrip-owner-after-refresh.png','roundtrip-independent-peer.png','portable-confirmed-canvas']);
/** Deliberately omit config/env, test titles, stdout and raw error text from artifacts. */
export function boardCiErrorReason(error){
 const message=error instanceof Error?error.message:typeof error?.message==='string'?error.message:'';
 if(/Timed out waiting \d+ms from config\.webServer/i.test(message))return'WEB_SERVER_TIMEOUT';
 if(/Process from config\.webServer was not able to start/i.test(message))return'WEB_SERVER_PROCESS_FAILED';
 if(/No tests found/i.test(message))return'NO_TESTS_FOUND';
 if(/browserType\.launch|browser\.newContext/i.test(message))return'BROWSER_START_FAILED';
 return'UNCLASSIFIED_PLAYWRIGHT_ERROR';
}
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
 onError(error){
  const reason=boardCiErrorReason(error);this.errors.push({code:'PLAYWRIGHT_ERROR',reason});
  process.stderr.write(`[board-ci] PLAYWRIGHT_ERROR ${reason}\n`);
 }
 onEnd(result){
  if(result.status!=='passed')this.errors.push({code:'PLAYWRIGHT_NOT_PASSED'});
  if(!process.env.PLAYWRIGHT_JSON_OUTPUT_FILE)throw Error('CI_RESULT_PATH_REQUIRED');
  writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE,JSON.stringify({errors:this.errors,suites:[{specs:[{tests:[...this.tests.values()]}]}]})+'\n',{mode:0o600});
 }
}
