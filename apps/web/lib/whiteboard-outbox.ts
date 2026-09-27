import { WHITEBOARD_SYNC, WhiteboardClientMessage, type WhiteboardClientMessage as ClientMessage } from "@repo/contracts/whiteboard-sync";

type Update = Extract<ClientMessage, { type: "update" }>;
export type CipherRow = { id: string; boardId: string; tokenHash: string; iv: ArrayBuffer; ciphertext: ArrayBuffer; byteSize: number; createdAt: number };
type Tombstone = { id: string; boardId: string; tokenHash: string; revokedAt: number };
export type WhiteboardOutboxRebindJournal = { id:string;boardId:string;fromHash:string;toHash:string;createdAt:number };
const DB_NAME = "workspacex-whiteboard-outbox-v1", DB_VERSION = 2;
const bytes = (value: string) => new TextEncoder().encode(value);
const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map(item => item.toString(16).padStart(2, "0")).join("");
const tokenHash = async (token: string) => hex(await crypto.subtle.digest("SHA-256", bytes(token)));

export interface WhiteboardDurableOutbox {
  restore(token: string): Promise<{ revoked: boolean; updates: Update[] }>;
  persist(token: string, update: Update): Promise<void>;
  acknowledge(token: string, updateId: string): Promise<void>;
  rebind(fromToken: string, toToken: string): Promise<void>;
  revoke(token: string): Promise<void>;
  close(): void;
}

function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); }); }
function transactionDone(tx: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); }
export interface WhiteboardOutboxRebindTransaction { put(row:CipherRow):void;delete(id:string):void;clearJournal():void;abort():void;done:Promise<void>; }
/** Startup filtering while a prepared rebind journal exists. */
export function whiteboardOutboxRecoveryView(rows:readonly CipherRow[],journal:WhiteboardOutboxRebindJournal|null,tokenHashValue:string){
  if(journal?.fromHash===tokenHashValue)return{revoked:true,rows:[] as CipherRow[]};
  const hashes=journal?.toHash===tokenHashValue?new Set([journal.fromHash,journal.toHash]):new Set([tokenHashValue]);
  return{revoked:false,rows:rows.filter(row=>hashes.has(row.tokenHash))};
}
/** One commit boundary used by IndexedDB and fault-injection tests. */
export async function commitWhiteboardOutboxRebind(source:readonly CipherRow[],replacements:readonly CipherRow[],tx:WhiteboardOutboxRebindTransaction):Promise<void>{
  try{for(const replacement of replacements)tx.put(replacement);for(const row of source)tx.delete(row.id);tx.clearJournal();await tx.done;}
  catch(error){try{tx.abort();}catch{/* already aborted */}throw error;}
}

export class IndexedDbEncryptedWhiteboardOutbox implements WhiteboardDurableOutbox {
  private readonly db: Promise<IDBDatabase>;
  private tail: Promise<void> = Promise.resolve();
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
  private async key(): Promise<CryptoKey> {
    const db = await this.db, tx = db.transaction("meta", "readwrite"), store = tx.objectStore("meta");
    let key = await request(store.get("aes-key")) as CryptoKey | undefined;
    if (!key) { key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); store.put(key, "aes-key"); }
    await transactionDone(tx); return key;
  }
  private id(hash: string, updateId?: string) { return `${this.boardId}:${hash}${updateId ? `:${updateId}` : ""}`; }
  private async journal(db:IDBDatabase){return await request(db.transaction("rebinds").objectStore("rebinds").get(this.boardId)) as WhiteboardOutboxRebindJournal|undefined;}
  private async finishRebind(db:IDBDatabase,journal:WhiteboardOutboxRebindJournal){
    const key=await this.key(),rows=(await request(db.transaction("updates").objectStore("updates").index("board").getAll(this.boardId)) as CipherRow[]).filter(row=>row.tokenHash===journal.fromHash),replacements:CipherRow[]=[];
    for(const row of rows){
      const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:row.iv,additionalData:bytes(`${row.boardId}:${row.tokenHash}`)},key,row.ciphertext);
      const parsed=WhiteboardClientMessage.safeParse(JSON.parse(new TextDecoder().decode(plaintext)));if(!parsed.success||parsed.data.type!=="update")throw new Error("OUTBOX_CORRUPT");
      const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:bytes(`${this.boardId}:${journal.toHash}`)},key,plaintext);
      replacements.push({id:this.id(journal.toHash,parsed.data.updateId),boardId:this.boardId,tokenHash:journal.toHash,iv:iv.buffer,ciphertext,byteSize:plaintext.byteLength,createdAt:row.createdAt});
    }
    const tx=db.transaction(["updates","rebinds"],"readwrite"),store=tx.objectStore("updates"),rebinds=tx.objectStore("rebinds");
    await commitWhiteboardOutboxRebind(rows,replacements,{put:row=>{store.put(row);},delete:id=>{store.delete(id);},clearJournal:()=>{rebinds.delete(journal.id);},abort:()=>tx.abort(),done:transactionDone(tx)});
  }
  private exclusive<T>(operation:()=>Promise<T>):Promise<T>{const next=this.tail.then(operation,operation);this.tail=next.then(()=>undefined,()=>undefined);return next;}
  private async restoreInternal(token: string):Promise<{revoked:boolean;updates:Update[]}> {
    const hash = await tokenHash(token), db = await this.db;
    const journal=await this.journal(db);
    const rows = await request(db.transaction("updates").objectStore("updates").index("board").getAll(this.boardId)) as CipherRow[];
    const recovery=whiteboardOutboxRecoveryView(rows,journal??null,hash);
    if(recovery.revoked)return{revoked:true,updates:[]};
    if(journal?.toHash===hash){await this.finishRebind(db,journal);return this.restoreInternal(token);}
    const tombstone = await request(db.transaction("tombstones").objectStore("tombstones").get(this.id(hash))) as Tombstone | undefined;
    if (tombstone) return { revoked: true, updates: [] };
    const key = await this.key(), updates: Update[] = [];
    for (const row of recovery.rows.sort((a,b) => a.createdAt-b.createdAt)) {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv, additionalData: bytes(`${row.boardId}:${row.tokenHash}`) }, key, row.ciphertext);
      const parsed = WhiteboardClientMessage.safeParse(JSON.parse(new TextDecoder().decode(plaintext)));
      if (!parsed.success || parsed.data.type !== "update") throw new Error("OUTBOX_CORRUPT");
      updates.push(parsed.data);
    }
    if (updates.length > WHITEBOARD_SYNC.pendingUpdates || updates.reduce((sum,item)=>sum+item.update.length,0) > WHITEBOARD_SYNC.pendingBytes) throw new Error("OUTBOX_LIMIT");
    return { revoked: false, updates };
  }
  restore(token:string){return this.exclusive(()=>this.restoreInternal(token));}
  private async persistInternal(token: string, update: Update) {
    const hash = await tokenHash(token), db = await this.db,journal=await this.journal(db);if(journal?.fromHash===hash)throw new Error("OUTBOX_REVOKED");
    const key = await this.key(), iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = bytes(JSON.stringify(update));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: bytes(`${this.boardId}:${hash}`) }, key, plaintext);
    const tx = db.transaction("updates", "readwrite");
    tx.objectStore("updates").put({ id: this.id(hash, update.updateId), boardId: this.boardId, tokenHash: hash, iv: iv.buffer, ciphertext, byteSize: plaintext.byteLength, createdAt: Date.now() } satisfies CipherRow);
    await transactionDone(tx);
  }
  persist(token:string,update:Update){return this.exclusive(()=>this.persistInternal(token,update));}
  acknowledge(token: string, updateId: string) { return this.exclusive(async()=>{
    const hash=await tokenHash(token),db=await this.db,journal=await this.journal(db);
    if(journal?.fromHash===hash)throw new Error("OUTBOX_REVOKED");
    if(journal?.toHash===hash)await this.finishRebind(db,journal);
    const tx=db.transaction("updates","readwrite");tx.objectStore("updates").delete(this.id(hash,updateId));await transactionDone(tx);
  }); }
  rebind(fromToken: string, toToken: string) { return this.exclusive(async()=>{
    if(fromToken===toToken)return;
    const fromHash=await tokenHash(fromToken),toHash=await tokenHash(toToken),db=await this.db;
    const tombstone=await request(db.transaction("tombstones").objectStore("tombstones").get(this.id(fromHash))) as Tombstone|undefined;
    if(tombstone)throw new Error("OUTBOX_REVOKED");
    const targetTombstone=await request(db.transaction("tombstones").objectStore("tombstones").get(this.id(toHash))) as Tombstone|undefined;
    if(targetTombstone)throw new Error("OUTBOX_REVOKED");
    const existing=await this.journal(db);if(existing){if(existing.fromHash!==fromHash||existing.toHash!==toHash)throw new Error("OUTBOX_REBIND_IN_PROGRESS");await this.finishRebind(db,existing);return;}
    // Prepare the alias first. After this commit, a reopened instance grants recovery only
    // to the new token and can finish the data migration after any later crash.
    const journal={id:this.boardId,boardId:this.boardId,fromHash,toHash,createdAt:Date.now()} satisfies WhiteboardOutboxRebindJournal,prepare=db.transaction("rebinds","readwrite");prepare.objectStore("rebinds").put(journal);await transactionDone(prepare);
    await this.finishRebind(db,journal);
  }); }
  revoke(token: string) { return this.exclusive(async()=>{
    const hash=await tokenHash(token),db=await this.db;
    const rows=await request(db.transaction("updates").objectStore("updates").index("board").getAll(this.boardId)) as CipherRow[];
    const tx=db.transaction(["updates","tombstones","rebinds"],"readwrite"),updates=tx.objectStore("updates");
    for(const row of rows) updates.delete(row.id);
    tx.objectStore("tombstones").put({id:this.id(hash),boardId:this.boardId,tokenHash:hash,revokedAt:Date.now()} satisfies Tombstone);
    tx.objectStore("rebinds").delete(this.boardId);
    await transactionDone(tx);
  }); }
  close() { void this.db.then(db=>db.close()); }
}

export function createWhiteboardOutbox(boardId: string): WhiteboardDurableOutbox | null {
  return typeof indexedDB === "undefined" || !globalThis.crypto?.subtle ? null : new IndexedDbEncryptedWhiteboardOutbox(boardId);
}
