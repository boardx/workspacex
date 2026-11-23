/** Per-stage synthetic Chat attachments. The request guard still owns every permission. */
import { createHash } from 'node:crypto';
import { aidtSyntheticStageText } from './devapp-aidt-acceptance-guard.mjs';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
const fail=()=>{throw new ProbeFailure('CASE01_STAGE_FILE_NOT_BOUND');};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createCase01StageFiles(identity){
  const entries=new Map();
  return Object.freeze({
    arm(scope){
      if(entries.has(scope.stageId)||scope.selector?.purpose!=='stage'||!scope.selector.entityId)fail();
      const file=aidtSyntheticStageText(identity.run,identity.attempt,scope.stageId);
      entries.set(scope.stageId,{stageId:scope.stageId,entityId:scope.selector.entityId,threadId:scope.threadId,filename:file.filename,mime:file.mime,sizeBytes:file.bytes.length,sha256:hash(file.bytes),sent:false});return file;
    },
    upload(target,body,ticket){
      const row=[...entries.values()].find(value=>target.pathname===`/api/chat/threads/${encodeURIComponent(value.threadId)}/attachments`);
      if(!row||row.sent||target.search||ticket?.operationId!==`case01-stage-${row.stageId}-attachment`||ticket.requestKind!=='chat-stage-text-upload'||ticket.stageId!==row.stageId||ticket.entityId!==row.entityId||!body||Object.keys(body).sort().join(',')!=='__multipart,fields,files'||body.__multipart!==true||!Array.isArray(body.files)||body.files.length!==1||!body.fields||Object.keys(body.fields).length||!same(body.files[0],{filename:row.filename,sizeBytes:row.sizeBytes,sha256:row.sha256,mime:row.mime}))fail();
      row.sent=true;return {allow:true,kind:'case01-stage-file-upload',stageId:row.stageId};
    },
    observe(decision,status,data){const row=entries.get(decision.stageId);if(!row?.sent||row.id||![200,201].includes(status)||typeof data?.id!=='string'||!/^[A-Za-z0-9_.:-]{1,180}$/.test(data.id)||[...entries.values()].some(item=>item.id===data.id)||data.filename!==row.filename||data.bytes!==row.sizeBytes||data.mime!==row.mime)fail();row.id=data.id;},
    read(target){const row=[...entries.values()].find(item=>item.id&&target.pathname===`/api/chat/threads/${encodeURIComponent(item.threadId)}/attachments/${encodeURIComponent(item.id)}/content`);return row&&!target.search?{allow:true,kind:'case01-stage-file-content',stageId:row.stageId}:null;},
    content(decision,status,bytes){const row=entries.get(decision.stageId);if(status!==200||!row?.id||!row.messageId||!Buffer.isBuffer(bytes)||bytes.length!==row.sizeBytes||hash(bytes)!==row.sha256)fail();row.contentVerified=true;},
    assertSend(scope){
      if(!scope.stageFile)return;
      const row=entries.get(scope.stageId),file=scope.stageFile;
      const names=['id','filename','mime','bytes','sha256','entityId','threadId','messageId','contentVerified'];
      if(!row?.id||row.messageId||row.entityId!==scope.selector?.entityId||row.threadId!==scope.threadId||!file||Object.keys(file).some(key=>!names.includes(key))
        || file.id!==row.id||file.filename!==row.filename||file.mime!==row.mime||file.bytes!==row.sizeBytes||file.sha256!==row.sha256||file.entityId!==row.entityId||file.threadId!==row.threadId||file.messageId!==undefined||file.contentVerified!==false)fail();
    },
    bind(scope,proof){if(!scope.stageFile)return;const row=entries.get(scope.stageId);if(!row?.id||row.id!==scope.stageFile.id||row.threadId!==proof.threadId||scope.selector.entityId!==row.entityId||row.messageId&&row.messageId!==proof.inputMessageId)fail();row.messageId=proof.inputMessageId;},
    receipt(stageId){const row=entries.get(stageId);if(!row?.id)return null;return {id:row.id,filename:row.filename,mime:row.mime,bytes:row.sizeBytes,sha256:row.sha256,entityId:row.entityId,threadId:row.threadId,messageId:row.messageId,contentVerified:row.contentVerified===true};},
  });
}
