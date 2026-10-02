import {request,transactionDone} from './whiteboard-indexeddb';
import {rewrapWhiteboardKey,unwrapWhiteboardKey,wrapWhiteboardKey,validateWhiteboardKeyEnvelope,type WhiteboardKeyEnvelope} from './whiteboard-outbox-key-envelope';
export type WhiteboardKeyMode={version:1;boardId:string;revision:number;envelopes:Record<string,WhiteboardKeyEnvelope>};
export type OutboxKeyMaterial={key:CryptoKey;generation:string;mode?:WhiteboardKeyMode};
export type PreparedOutboxKey={expected:WhiteboardKeyMode|undefined;next:WhiteboardKeyMode|undefined;keyId?:string};
type Row={boardId:string;tokenHash:string};
type Journal={fromHash:string;toHash:string;keyId?:string};
const context=(envelope:WhiteboardKeyEnvelope)=>({boardId:envelope.boardId,keyId:envelope.keyId,generation:envelope.generation});
function validNative(value:unknown):CryptoKey {
  const key=value as CryptoKey;
  if(!key||key.type!=='secret'||key.extractable!==false||key.algorithm?.name!=='AES-GCM'||(key.algorithm as AesKeyAlgorithm).length!==256||!key.usages.includes('encrypt')||!key.usages.includes('decrypt'))throw new Error('OUTBOX_KEY_INVALID');
  return key;
}
function mode(value:unknown,boardId:string):WhiteboardKeyMode|undefined {
  if(value===undefined)return undefined;
  const record=value as WhiteboardKeyMode;
  if(!record||record.version!==1||record.boardId!==boardId||!Number.isSafeInteger(record.revision)||record.revision<1||!record.envelopes||typeof record.envelopes!=='object'||Array.isArray(record.envelopes))throw new Error('OUTBOX_KEY_MODE_INVALID');
  for(const [generation,envelope] of Object.entries(record.envelopes)){
    if(!/^[a-f0-9]{64}$/.test(generation)||!envelope||envelope.boardId!==boardId||envelope.generation!==generation||typeof envelope.keyId!=='string'||!envelope.keyId)throw new Error('OUTBOX_KEY_MODE_INVALID');
    validateWhiteboardKeyEnvelope(envelope);
  }
  return record;
}
function sameEnvelope(a:WhiteboardKeyEnvelope,b:WhiteboardKeyEnvelope){
  return a.boardId===b.boardId&&a.keyId===b.keyId&&a.generation===b.generation&&a.version===b.version&&(['salt','iv','ciphertext'] as const).every(field=>{const left=new Uint8Array(a[field]),right=new Uint8Array(b[field]);return left.length===right.length&&left.every((byte,index)=>byte===right[index]);});
}
function same(expected:WhiteboardKeyMode|undefined,current:WhiteboardKeyMode|undefined){
  return expected===undefined?current===undefined:Boolean(current&&current.boardId===expected.boardId&&current.revision===expected.revision);
}
function nextRevision(record:WhiteboardKeyMode|undefined){
  if(record&&record.revision>=Number.MAX_SAFE_INTEGER)throw new Error('OUTBOX_KEY_REVISION_LIMIT');
  return (record?.revision??0)+1;
}
/** Stores encrypted key envelopes only on browsers whose fresh CryptoKey write raises DataCloneError. */
export class WhiteboardOutboxKeyStore {
  private get modeKey(){return `key-envelope:${this.boardId}`;}
  constructor(private db:Promise<IDBDatabase>,private boardId:string){}
  private async snapshot(){
    const db=await this.db,tx=db.transaction(['meta','updates']),done=transactionDone(tx);
    const [stored,native,rows]=await Promise.all([request(tx.objectStore('meta').get(this.modeKey)),request(tx.objectStore('meta').get('aes-key')),request(tx.objectStore('updates').getAll()) as Promise<Row[]>]);
    await done;return {db,mode:mode(stored,this.boardId),native,rows};
  }
  private async missingNativeIsCorrupt(db:IDBDatabase,rows:Row[]){
    // Other wrapped boards do not depend on the legacy origin-wide native key.
    const boards=[...new Set(rows.map(row=>row.boardId))];
    for(const id of boards){const value=await request(db.transaction('meta').objectStore('meta').get(`key-envelope:${id}`));if(!mode(value,id))throw new Error('OUTBOX_KEY_MISSING');}
  }
  private async envelope(token:string,generation:string,keyId=crypto.randomUUID()){
    const temporary=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
    return wrapWhiteboardKey(temporary,token,{boardId:this.boardId,keyId,generation});
  }
  private async nativeOrUnsupported(db:IDBDatabase,rows:Row[]):Promise<CryptoKey|null>{
    await this.missingNativeIsCorrupt(db,rows);
    const generated=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const tx=db.transaction('meta','readwrite'),done=transactionDone(tx),store=tx.objectStore('meta');
    // Consume transaction rejection even when put throws synchronously.
    const settled=done.catch(error=>{throw error;});void settled.catch(()=>undefined);
    try{const winner=await request(store.get('aes-key'));if(winner){await settled;return validNative(winner);}store.put(generated,'aes-key');await settled;return generated;}
    catch(error){try{tx.abort();}catch{/* already finished */}await settled.catch(()=>undefined);
      if(error instanceof DOMException&&error.name==='DataCloneError')return null;throw error;}
  }
  async resolve(token:string,generation:string):Promise<OutboxKeyMaterial>{
    for(let attempt=0;attempt<4;attempt++){
      const snapshot=await this.snapshot(),existing=snapshot.mode?.envelopes[generation];
      if(existing)return {key:await unwrapWhiteboardKey(existing,token,{boardId:this.boardId,keyId:existing.keyId,generation}),generation,mode:snapshot.mode};
      if(!snapshot.mode&&snapshot.native!==undefined)return {key:validNative(snapshot.native),generation};
      if(snapshot.rows.some(row=>row.boardId===this.boardId&&row.tokenHash===generation))throw new Error('OUTBOX_KEY_MISSING');
      if(!snapshot.mode){const native=await this.nativeOrUnsupported(snapshot.db,snapshot.rows);if(native)return {key:native,generation};}
      const envelope=await this.envelope(token,generation),next:WhiteboardKeyMode=snapshot.mode?{...snapshot.mode,revision:nextRevision(snapshot.mode),envelopes:{...snapshot.mode.envelopes,[generation]:envelope}}:{version:1,boardId:this.boardId,revision:1,envelopes:{[generation]:envelope}};
      const tx=snapshot.db.transaction(['meta','updates','tombstones','rebinds'],'readwrite'),done=transactionDone(tx);
      const [current,native,retired,journal,rows]=await Promise.all([request(tx.objectStore('meta').get(this.modeKey)),request(tx.objectStore('meta').get('aes-key')),request(tx.objectStore('tombstones').get(`${this.boardId}:${generation}`)),request(tx.objectStore('rebinds').get(this.boardId)) as Promise<Journal|undefined>,request(tx.objectStore('updates').index('board').getAll(this.boardId)) as Promise<Row[]>]);
      if(retired||journal?.fromHash===generation){tx.abort();await done.catch(()=>undefined);throw new Error('OUTBOX_REVOKED');}
      if(!same(snapshot.mode,mode(current,this.boardId))||(!snapshot.mode&&native!==undefined)){tx.abort();await done.catch(()=>undefined);continue;}
      if(rows.some(row=>row.tokenHash===generation)){tx.abort();await done.catch(()=>undefined);throw new Error('OUTBOX_KEY_MISSING');}
      tx.objectStore('meta').put(next,this.modeKey);await done;
      return {key:await unwrapWhiteboardKey(envelope,token,context(envelope)),generation,mode:next};
    }
    throw new Error('OUTBOX_KEY_GENERATION_CHANGED');
  }
  async prepareRebind(fromToken:string,fromHash:string,toToken:string,toHash:string):Promise<PreparedOutboxKey>{
    const material=await this.resolve(fromToken,fromHash);
    if(!material.mode)return {expected:undefined,next:undefined};
    const source=material.mode.envelopes[fromHash]!;
    const target=material.mode.envelopes[toHash];
    if(target&&target.keyId!==source.keyId)throw new Error('OUTBOX_KEY_TARGET_CONFLICT');
    if(target){await unwrapWhiteboardKey(target,toToken,{boardId:this.boardId,keyId:source.keyId,generation:toHash});return {expected:material.mode,next:material.mode,keyId:source.keyId};}
    const envelope=await rewrapWhiteboardKey(source,fromToken,toToken,toHash,context(source));
    return {expected:material.mode,next:{...material.mode,revision:nextRevision(material.mode),envelopes:{...material.mode.envelopes,[toHash]:envelope}},keyId:source.keyId};
  }
  async prepareReauthorization(token:string,previous:string,nextGeneration:string):Promise<PreparedOutboxKey>{
    const snapshot=await this.snapshot();
    if(!snapshot.mode&&snapshot.native!==undefined){validNative(snapshot.native);return {expected:undefined,next:undefined};}
    // Never create a replacement key for durable rows whose key is missing.
    if(snapshot.rows.some(row=>row.boardId===this.boardId&&row.tokenHash===previous)&&!snapshot.mode?.envelopes[previous])throw new Error('OUTBOX_KEY_MISSING');
    if(!snapshot.mode){const native=await this.nativeOrUnsupported(snapshot.db,snapshot.rows);if(native)return {expected:undefined,next:undefined};}
    const old=snapshot.mode?.envelopes[previous];
    const envelope=old?await rewrapWhiteboardKey(old,token,token,nextGeneration,context(old)):await this.envelope(token,nextGeneration);
    const next:WhiteboardKeyMode=snapshot.mode?{...snapshot.mode,revision:nextRevision(snapshot.mode),envelopes:{...snapshot.mode.envelopes,[nextGeneration]:envelope}}:{version:1,boardId:this.boardId,revision:1,envelopes:{[nextGeneration]:envelope}};
    return {expected:snapshot.mode,next,keyId:envelope.keyId};
  }
  async commitPrepared(tx:IDBTransaction,prepared:PreparedOutboxKey){
    const current=mode(await request(tx.objectStore('meta').get(this.modeKey)),this.boardId);
    if(!same(prepared.expected,current))throw new Error('OUTBOX_KEY_GENERATION_CHANGED');
    if(prepared.next&&prepared.next!==prepared.expected)tx.objectStore('meta').put(prepared.next,this.modeKey);
  }
  async assertMaterial(tx:IDBTransaction,material:OutboxKeyMaterial,journal?:Journal){
    const current=mode(await request(tx.objectStore('meta').get(this.modeKey)),this.boardId);
    if(!material.mode){if(current||journal?.keyId)throw new Error('OUTBOX_KEY_GENERATION_CHANGED');return;}
    const envelope=current?.envelopes[material.generation],expected=material.mode.envelopes[material.generation];
    if(!current||!envelope||!expected||!sameEnvelope(envelope,expected))throw new Error('OUTBOX_KEY_GENERATION_CHANGED');
    if(journal){if(current.revision!==material.mode.revision||journal.keyId!==envelope.keyId||current.envelopes[journal.fromHash]?.keyId!==journal.keyId||current.envelopes[journal.toHash]?.keyId!==journal.keyId)throw new Error('OUTBOX_KEY_GENERATION_CHANGED');}
  }
}
