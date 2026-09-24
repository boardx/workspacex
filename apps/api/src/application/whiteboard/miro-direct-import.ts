import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { whiteboardMiro as C, whiteboardTransfer as T } from '@repo/contracts';
import { convertExternalBoardSnapshot } from '@repo/whiteboard-core';
import type { Principal } from '../../domain/principal';
import type { WhiteboardTransferStore } from './transfer-ports';
import { MiroImportError as Fault, MiroRemoteUnauthorized, type MiroCredentialCipher, type MiroCredentialRepository, type MiroRemoteClient, type MiroTokenResult, type SealedMiroCredential } from './miro-ports';

const STATE_TTL_MS=10*60*1000;
const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');

export class MiroDirectImport {
  readonly #refreshes=new Map<string,Promise<SealedMiroCredential>>();
  constructor(
    private readonly repository:MiroCredentialRepository,
    private readonly cipher:MiroCredentialCipher,
    private readonly client:MiroRemoteClient,
    private readonly transfer:WhiteboardTransferStore,
    private readonly clock:()=>Date=()=>new Date(),
  ) {}

  async start(principal:Principal,raw:C.StartMiroOAuthInput) {
    const input=C.StartMiroOAuthInput.parse(raw), state=randomBytes(32).toString('base64url'), now=this.clock();
    await this.repository.createState(principal,digest(state),input.returnTo,new Date(now.getTime()+STATE_TTL_MS));
    return C.StartMiroOAuthResult.parse({authorizationUrl:this.client.authorizationUrl(state)});
  }
  async callback(principal:Principal,state:string,code:string) {
    if (!state || state.length>500 || !code || code.length>8_192) throw new Fault('OAUTH_STATE_INVALID');
    const consumed=await this.repository.consumeState(principal,digest(state),this.clock());
    if (!consumed) throw new Fault('OAUTH_STATE_INVALID');
    const token=await this.client.exchange(code); await this.save(principal,token); await this.repository.audit(principal,'connected');
    return consumed;
  }
  async connection(principal:Principal):Promise<C.MiroConnection> {
    const value=await this.repository.load(principal);
    return C.MiroConnection.parse(value?{connected:true,scopes:value.scopes,connectedAt:value.connectedAt}:{connected:false,scopes:[],connectedAt:null});
  }
  async listBoards(principal:Principal,raw:unknown):Promise<C.ListMiroBoardsResult> {
    const query=C.ListMiroBoardsQuery.parse(raw);
    const page=await this.authorized(principal,access=>this.client.boards(access,query.offset,query.limit));
    return C.ListMiroBoardsResult.parse({...page,offset:query.offset,limit:query.limit});
  }
  async preview(principal:Principal,raw:C.PreviewMiroBoardInput):Promise<C.PreviewMiroBoardResult> {
    const input=C.PreviewMiroBoardInput.parse(raw);
    const board=await this.authorized(principal,access=>this.client.board(access,input.boardId));
    const items:Record<string,unknown>[]=[]; const cursors=new Set<string>(); let cursor:string|undefined;
    while (true) {
      const page=await this.authorized(principal,access=>this.client.items(access,input.boardId,cursor));
      items.push(...page.data); if (items.length>C.MIRO_DIRECT_IMPORT.maxItems) throw new Fault('ITEM_LIMIT_EXCEEDED');
      if (!page.cursor) break;
      if (cursors.has(page.cursor)) throw new Fault('REPEATED_CURSOR');
      cursors.add(page.cursor); cursor=page.cursor;
    }
    const converted=convertExternalBoardSnapshot({format:'miro.rest.board-snapshot',schemaVersion:1,exportedAt:this.clock().toISOString(),board:{id:board.id,name:board.name},pages:[{id:'default',items}]},{packageBoardId:input.packageBoardId});
    if (!converted.ok) throw new Fault(converted.code==='PAYLOAD_TOO_LARGE'?'PAYLOAD_TOO_LARGE':'REMOTE_SCHEMA_CHANGED');
    const importInput=T.ImportBoardInput.parse({requestId:randomUUID(),package:converted.package});
    const preview=await this.transfer.previewImport(principal,importInput);
    await this.repository.audit(principal,'import_fetched',input.boardId,items.length);
    return C.PreviewMiroBoardResult.parse({input:importInput,external:converted.preview,preview});
  }
  async disconnect(principal:Principal):Promise<{disconnected:true}> {
    const previous=await this.repository.revoke(principal);
    await this.repository.audit(principal,'revoked');
    if (previous) { try { await this.client.revoke(this.cipher.open(principal,previous.sealed).access); } catch { /* local revocation wins */ } }
    return {disconnected:true};
  }

  private async save(principal:Principal,token:MiroTokenResult) {
    await this.repository.save(principal,{sealed:this.cipher.seal(principal,token.credential),scopes:token.scopes,connectedAt:this.clock().toISOString(),expiresAt:token.expiresAt});
  }
  private async authorized<T>(principal:Principal,call:(access:string)=>Promise<T>):Promise<T> {
    let record=await this.repository.load(principal); if (!record) throw new Fault('NOT_CONNECTED');
    try { return await call(this.cipher.open(principal,record.sealed).access); }
    catch (error) {
      if (!(error instanceof MiroRemoteUnauthorized)) throw error;
      record=await this.refresh(principal,record);
      try { return await call(this.cipher.open(principal,record.sealed).access); }
      catch (retry) { if (retry instanceof MiroRemoteUnauthorized) throw new Fault('REMOTE_UNAUTHORIZED'); throw retry; }
    }
  }
  private refresh(principal:Principal,record:SealedMiroCredential):Promise<SealedMiroCredential> {
    const key=`${principal.orgId}\0${principal.userId}`; const active=this.#refreshes.get(key); if (active) return active;
    const pending=this.performRefresh(principal,record).finally(()=>this.#refreshes.delete(key)); this.#refreshes.set(key,pending); return pending;
  }
  private async performRefresh(principal:Principal,record:SealedMiroCredential):Promise<SealedMiroCredential> {
    const current=this.cipher.open(principal,record.sealed); if (!current.refresh) throw new Fault('REMOTE_UNAUTHORIZED');
    const next=await this.client.refresh(current.refresh), credential={...next.credential,refresh:next.credential.refresh??current.refresh};
    const rotated=await this.repository.rotate(principal,record.revision,{sealed:this.cipher.seal(principal,credential),scopes:next.scopes,expiresAt:next.expiresAt});
    const stored=await this.repository.load(principal); if (!stored) throw new Fault('NOT_CONNECTED');
    if (rotated) await this.repository.audit(principal,'refreshed'); return stored;
  }
}
