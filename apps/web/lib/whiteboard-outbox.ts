import { WHITEBOARD_SYNC, WhiteboardClientMessage, type WhiteboardPendingMessage } from "@repo/contracts/whiteboard-sync";

type Update = WhiteboardPendingMessage;
export type CipherRow = { id: string; boardId: string; tokenHash: string; iv: ArrayBuffer; ciphertext: ArrayBuffer; byteSize: number; createdAt: number; sequence?:number };
type Tombstone = { id: string; boardId: string; tokenHash: string; revokedAt: number };
export type WhiteboardOutboxRebindJournal = { id:string;boardId:string;fromHash:string;toHash:string;createdAt:number };
const DB_NAME = "workspacex-whiteboard-outbox-v1", DB_VERSION = 2;
const bytes = (value: string) => new TextEncoder().encode(value);
const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map(item => item.toString(16).padStart(2, "0")).join("");
const tokenHash = async (token: string) => hex(await crypto.subtle.digest("SHA-256", bytes(token)));

export interface WhiteboardDurableOutbox {
  reauthorize?(token: string): Promise<void>;
  restore(token: string): Promise<{ revoked: boolean; updates: Update[] }>;
  persist(token: string, update: Update): Promise<void>;
  acknowledge(token: string, updateId: string): Promise<void>;
  rebind(fromToken: string, toToken: string): Promise<void>;
  revoke(token: string): Promise<void>;
  close(): void;
}

function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); }); }
function transactionDone(tx: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); }
export interface WhiteboardOutboxRebindTransaction {
  put(row:CipherRow):void;
  delete(id:string):void;
  retireSource():void;
  clearJournal():void;
  abort():void;
  done:Promise<void>;
}
/** Startup filtering while a prepared rebind journal exists. */
export function whiteboardOutboxRecoveryView(rows:readonly CipherRow[],journal:WhiteboardOutboxRebindJournal|null,tokenHashValue:string){
  if(journal?.fromHash===tokenHashValue)return{revoked:true,rows:[] as CipherRow[]};
  const hashes=journal?.toHash===tokenHashValue?new Set([journal.fromHash,journal.toHash]):new Set([tokenHashValue]);
  return{revoked:false,rows:rows.filter(row=>hashes.has(row.tokenHash))};
}
export function whiteboardOutboxTokenRevoked(journal:WhiteboardOutboxRebindJournal|null,retired:boolean,tokenHashValue:string){
  return retired||journal?.fromHash===tokenHashValue;
}
/** One commit boundary used by IndexedDB and fault-injection tests. */
export async function commitWhiteboardOutboxRebind(source:readonly CipherRow[],replacements:readonly CipherRow[],tx:WhiteboardOutboxRebindTransaction):Promise<void>{
  try{for(const replacement of replacements)tx.put(replacement);for(const row of source)tx.delete(row.id);tx.retireSource();tx.clearJournal();await tx.done;}
  catch(error){try{tx.abort();}catch{/* already aborted */}throw error;}
}

/** Must run under the same readwrite transaction that advances the meta pointer. */
export function assertWhiteboardOutboxReauthorization(current:string,expected:string,retired:boolean,journal:WhiteboardOutboxRebindJournal|undefined){
  if(current!==expected||!retired||journal)throw new Error('OUTBOX_GENERATION_CHANGED');
}
export function whiteboardOutboxRevokedRows(rows:readonly CipherRow[],generation:string){return rows.filter(row=>row.tokenHash===generation);}
export class IndexedDbEncryptedWhiteboardOutbox implements WhiteboardDurableOutbox {
  private readonly db: Promise<IDBDatabase>;
  private tail: Promise<void> = Promise.resolve();
  private readonly generations=new Map<string,string>();
  constructor(private readonly boardId: string) {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("updates")) { const store = db.createObjectStore("updates", { keyPath: "id" }); store.createIndex("board", "boardId"); }
        if (!db.objectStoreNames.contains("tombstones")) db.createObjectStore("tombstones", { keyPath: "id" });
        if (!db.objectStoreNames.contains("rebinds")) db.createObjectStore("rebinds", { keyPath: "id" });
      };
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
  }
  private async generationHash(token:string):Promise<string>{
    const hash=await tokenHash(token),pinned=this.generations.get(hash);if(pinned)return pinned;
    const db=await this.db,value=await request(db.transaction('meta').objectStore('meta').get(`generation:${this.boardId}:${hash}`));
    const generation=typeof value==='string'?value:hash;this.generations.set(hash,generation);return generation;
  }
  /** Called only after a fresh server sync authorizes this empty provider. Never
   * removes a tombstone or migrates revoked pending writes into the new generation. */
  reauthorize(token:string){return this.exclusive(async()=>{
    const base=await tokenHash(token),previous=await this.generationHash(token),db=await this.db;
    const next=await tokenHash(`${base}:${crypto.randomUUID()}`);
    const tx=db.transaction(['meta','tombstones','rebinds'],'readwrite'),done=transactionDone(tx);
    const currentRequest=request(tx.objectStore('meta').get(`generation:${this.boardId}:${base}`));
    const retiredRequest=request(tx.objectStore('tombstones').get(this.id(previous)));
    const journalRequest=request(tx.objectStore('rebinds').get(this.boardId)) as Promise<WhiteboardOutboxRebindJournal|undefined>;
    const [current,retired,journal]=await Promise.all([currentRequest,retiredRequest,journalRequest]);
    try{assertWhiteboardOutboxReauthorization(typeof current==='string'?current:base,previous,Boolean(retired),journal);}catch(error){tx.abort();await done.catch(()=>undefined);throw error;}
    tx.objectStore('meta').put(next,`generation:${this.boardId}:${base}`);await done;
    this.generations.set(base,next);
  });}
  private async key(): Promise<CryptoKey> {
    const db=await this.db;
    const existing=await request(db.transaction('meta').objectStore('meta').get('aes-key')) as CryptoKey|undefined;
    if(existing)return existing;
    // Crypto must not suspend a live IDB transaction. Competing tabs choose the
    // first committed key under a second readwrite transaction.
    const generated=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const tx=db.transaction('meta','readwrite'),done=transactionDone(tx),store=tx.objectStore('meta');
    const winner=await request(store.get('aes-key')) as CryptoKey|undefined;
    if(!winner)store.put(generated,'aes-key');await done;return winner??generated;
  }

  private id(hash: string, updateId?: string) { return `${this.boardId}:${hash}${updateId ? `:${updateId}` : ""}`; }
  private async journal(db:IDBDatabase){return await request(db.transaction("rebinds").objectStore("rebinds").get(this.boardId)) as WhiteboardOutboxRebindJournal|undefined;}
  private async isRetired(db:IDBDatabase,hash:string){return Boolean(await request(db.transaction("tombstones").objectStore("tombstones").get(this.id(hash))));}
  private async finishRebind(db:IDBDatabase,journal:WhiteboardOutboxRebindJournal){
    const key=await this.key(),rows=(await request(db.transaction("updates").objectStore("updates").index("board").getAll(this.boardId)) as CipherRow[]).filter(row=>row.tokenHash===journal.fromHash),replacements:CipherRow[]=[];
    for(const row of rows){
      const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:row.iv,additionalData:bytes(`${row.boardId}:${row.tokenHash}`)},key,row.ciphertext);
      const parsed=WhiteboardClientMessage.safeParse(JSON.parse(new TextDecoder().decode(plaintext)));if(!parsed.success||(parsed.data.type!=="update"&&parsed.data.type!=="restore-deletion"))throw new Error("OUTBOX_CORRUPT");
      const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:bytes(`${this.boardId}:${journal.toHash}`)},key,plaintext);
      replacements.push({id:this.id(journal.toHash,parsed.data.updateId),boardId:this.boardId,tokenHash:journal.toHash,iv:iv.buffer,ciphertext,byteSize:plaintext.byteLength,createdAt:row.createdAt,...(row.sequence===undefined?{}:{sequence:row.sequence})});
    }
    const tx=db.transaction(["updates","tombstones","rebinds"],"readwrite"),store=tx.objectStore("updates"),tombstones=tx.objectStore("tombstones"),rebinds=tx.objectStore("rebinds");
    const done=transactionDone(tx);
    const currentRequest=request(rebinds.get(this.boardId)) as Promise<WhiteboardOutboxRebindJournal|undefined>;
    const sourceRequest=request(tombstones.get(this.id(journal.fromHash))),targetRequest=request(tombstones.get(this.id(journal.toHash)));
    const [current,sourceRetired,targetRetired]=await Promise.all([currentRequest,sourceRequest,targetRequest]);
    if(!current||current.id!==journal.id||current.boardId!==journal.boardId||current.fromHash!==journal.fromHash||current.toHash!==journal.toHash||current.createdAt!==journal.createdAt||sourceRetired||targetRetired){
      tx.abort();await done.catch(()=>undefined);throw new Error('OUTBOX_REVOKED');
    }
    await commitWhiteboardOutboxRebind(rows,replacements,{
      put:row=>{store.put(row);},
      delete:id=>{store.delete(id);},
      retireSource:()=>{tombstones.put({id:this.id(journal.fromHash),boardId:this.boardId,tokenHash:journal.fromHash,revokedAt:Date.now()} satisfies Tombstone);},
      clearJournal:()=>{rebinds.delete(journal.id);},
      abort:()=>tx.abort(),
      done,
    });
  }
  private exclusive<T>(operation:()=>Promise<T>):Promise<T>{const next=this.tail.then(operation,operation);this.tail=next.then(()=>undefined,()=>undefined);return next;}
  private async restoreInternal(token: string):Promise<{revoked:boolean;updates:Update[]}> {
    const hash = await this.generationHash(token), db = await this.db;
    // Read authorization and rows from one IndexedDB snapshot. A rebind in another
    // tab is therefore ordered wholly before or after this restore.
    const snapshot=db.transaction(["updates","tombstones","rebinds"]),snapshotDone=transactionDone(snapshot);
    const journalRequest=request(snapshot.objectStore("rebinds").get(this.boardId)) as Promise<WhiteboardOutboxRebindJournal|undefined>;
    const rowsRequest=request(snapshot.objectStore("updates").index("board").getAll(this.boardId)) as Promise<CipherRow[]>;
    const retiredRequest=request(snapshot.objectStore("tombstones").get(this.id(hash)));
    const [journal,rows,retiredRow]=await Promise.all([journalRequest,rowsRequest,retiredRequest]);await snapshotDone;
    const recovery=whiteboardOutboxRecoveryView(rows,journal??null,hash);
    if(recovery.revoked)return{revoked:true,updates:[]};
    if(journal?.toHash===hash){await this.finishRebind(db,journal);return this.restoreInternal(token);}
    if(whiteboardOutboxTokenRevoked(journal??null,Boolean(retiredRow),hash)) return { revoked: true, updates: [] };
    const key = await this.key(), updates: Update[] = [];
    for (const row of recovery.rows.sort((a,b) => a.sequence!==undefined&&b.sequence!==undefined?a.sequence-b.sequence:a.sequence===undefined&&b.sequence!==undefined?-1:a.sequence!==undefined&&b.sequence===undefined?1:a.createdAt-b.createdAt)) {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv, additionalData: bytes(`${row.boardId}:${row.tokenHash}`) }, key, row.ciphertext);
      const parsed = WhiteboardClientMessage.safeParse(JSON.parse(new TextDecoder().decode(plaintext)));
      if (!parsed.success || (parsed.data.type!=="update"&&parsed.data.type!=="restore-deletion")) throw new Error("OUTBOX_CORRUPT");
      updates.push(parsed.data as Update);
    }
    if (updates.length > WHITEBOARD_SYNC.pendingUpdates || updates.reduce((sum,item)=>sum+JSON.stringify(item).length,0) > WHITEBOARD_SYNC.pendingBytes) throw new Error("OUTBOX_LIMIT");
    return { revoked: false, updates };
  }
  restore(token:string){return this.exclusive(()=>this.restoreInternal(token));}
  private async persistInternal(token: string, update: Update) {
    const hash = await this.generationHash(token), db = await this.db;
    const key = await this.key(), iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = bytes(JSON.stringify(update));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: bytes(`${this.boardId}:${hash}`) }, key, plaintext);
    // The generation check and write share one transaction so a second tab cannot
    // commit an old-token row after a successful rebind retires that generation.
    const tx = db.transaction(["updates","tombstones","rebinds","meta"], "readwrite"),done=transactionDone(tx);
    const retiredRequest=request(tx.objectStore("tombstones").get(this.id(hash)));
    const journalRequest=request(tx.objectStore("rebinds").get(this.boardId)) as Promise<WhiteboardOutboxRebindJournal|undefined>;
    const [retiredRow,journal]=await Promise.all([retiredRequest,journalRequest]),retired=Boolean(retiredRow);
    if(whiteboardOutboxTokenRevoked(journal??null,retired,hash)){tx.abort();await done.catch(()=>undefined);throw new Error("OUTBOX_REVOKED");}
    const rowId=this.id(hash,update.updateId),sequenceKey=`queue-sequence:${this.boardId}`;
    const [oldRow,counter]=await Promise.all([request(tx.objectStore('updates').get(rowId)) as Promise<CipherRow|undefined>,request(tx.objectStore('meta').get(sequenceKey))]);
    const sequence=oldRow?.sequence??(typeof counter==='number'?counter:0)+1;
    if(!Number.isSafeInteger(sequence)||sequence<1){tx.abort();await done.catch(()=>undefined);throw new Error('OUTBOX_SEQUENCE_LIMIT');}
    tx.objectStore('meta').put(Math.max(typeof counter==='number'?counter:0,sequence),sequenceKey);
    tx.objectStore("updates").put({ id: rowId, boardId: this.boardId, tokenHash: hash, iv: iv.buffer, ciphertext, byteSize: plaintext.byteLength, createdAt: oldRow?.createdAt??Date.now(),sequence } satisfies CipherRow);
    await done;
  }
  persist(token:string,update:Update){return this.exclusive(()=>this.persistInternal(token,update));}
  acknowledge(token: string, updateId: string) { return this.exclusive(async()=>{
    const hash=await this.generationHash(token),db=await this.db,journal=await this.journal(db);
    if(whiteboardOutboxTokenRevoked(journal??null,await this.isRetired(db,hash),hash))throw new Error("OUTBOX_REVOKED");
    if(journal?.toHash===hash)await this.finishRebind(db,journal);
    // Re-check inside the deleting transaction: another tab may rebind after the
    // optimistic check above but before this acknowledgement starts.
    const tx=db.transaction(["updates","tombstones","rebinds"],"readwrite"),done=transactionDone(tx);
    const retiredRequest=request(tx.objectStore("tombstones").get(this.id(hash)));
    const currentRequest=request(tx.objectStore("rebinds").get(this.boardId)) as Promise<WhiteboardOutboxRebindJournal|undefined>;
    const [retiredRow,current]=await Promise.all([retiredRequest,currentRequest]),retired=Boolean(retiredRow);
    if(whiteboardOutboxTokenRevoked(current??null,retired,hash)){tx.abort();await done.catch(()=>undefined);throw new Error("OUTBOX_REVOKED");}
    tx.objectStore("updates").delete(this.id(hash,updateId));await done;
  }); }
  rebind(fromToken: string, toToken: string) { return this.exclusive(async()=>{
    if(fromToken===toToken)return;
    const fromHash=await this.generationHash(fromToken),toHash=await this.generationHash(toToken),db=await this.db;
    // Prepare the alias first. After this commit, a reopened instance grants recovery only
    // to the new token and can finish the data migration after any later crash.
    // Tombstone checks and journal creation are one transaction so concurrent tabs
    // cannot fork one retired generation into two successor generations.
    const journal={id:this.boardId,boardId:this.boardId,fromHash,toHash,createdAt:Date.now()} satisfies WhiteboardOutboxRebindJournal;
    const prepare=db.transaction(["tombstones","rebinds"],"readwrite"),prepareDone=transactionDone(prepare);
    const sourceRequest=request(prepare.objectStore("tombstones").get(this.id(fromHash)));
    const targetRequest=request(prepare.objectStore("tombstones").get(this.id(toHash)));
    const existingRequest=request(prepare.objectStore("rebinds").get(this.boardId)) as Promise<WhiteboardOutboxRebindJournal|undefined>;
    const [sourceTombstone,targetTombstone,existing]=await Promise.all([sourceRequest,targetRequest,existingRequest]);
    if(sourceTombstone||targetTombstone){prepare.abort();await prepareDone.catch(()=>undefined);throw new Error("OUTBOX_REVOKED");}
    if(existing){await prepareDone;if(existing.fromHash!==fromHash||existing.toHash!==toHash)throw new Error("OUTBOX_REBIND_IN_PROGRESS");await this.finishRebind(db,existing);return;}
    prepare.objectStore("rebinds").put(journal);await prepareDone;
    await this.finishRebind(db,journal);
  }); }
  revoke(token: string) { return this.exclusive(async()=>{
    const hash=await this.generationHash(token),db=await this.db;
    const rows=await request(db.transaction("updates").objectStore("updates").index("board").getAll(this.boardId)) as CipherRow[];
    const tx=db.transaction(["updates","tombstones","rebinds"],"readwrite"),updates=tx.objectStore("updates");
    for(const row of whiteboardOutboxRevokedRows(rows,hash)) updates.delete(row.id);
    tx.objectStore("tombstones").put({id:this.id(hash),boardId:this.boardId,tokenHash:hash,revokedAt:Date.now()} satisfies Tombstone);
    const done=transactionDone(tx);
    const journal=await request(tx.objectStore("rebinds").get(this.boardId)) as WhiteboardOutboxRebindJournal|undefined;
    if(journal&&(journal.fromHash===hash||journal.toHash===hash))tx.objectStore("rebinds").delete(this.boardId);
    await done;
  }); }
  close() { void this.db.then(db=>db.close()); }
}

export function createWhiteboardOutbox(boardId: string): WhiteboardDurableOutbox | null {
  return typeof indexedDB === "undefined" || !globalThis.crypto?.subtle ? null : new IndexedDbEncryptedWhiteboardOutbox(boardId);
}
