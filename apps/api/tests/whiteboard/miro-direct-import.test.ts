import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { convertExternalBoardSnapshot } from '@repo/whiteboard-core';
import type { Principal } from '../../src/domain/principal';
import { toOrgId } from '../../src/domain/org-id';
import { MiroDirectImport } from '../../src/application/whiteboard/miro-direct-import';
import { MiroImportError, MiroRemoteUnauthorized, type MiroAuditAction, type MiroAuthorizationState, type MiroCredentialRepository, type MiroRemoteClient, type MiroTokenResult, type SealedMiroCredential } from '../../src/application/whiteboard/miro-ports';
import { AesMiroCredentialCipher } from '../../src/infrastructure/whiteboard/miro-credential-cipher';
import { importPreview } from '../../src/application/whiteboard/portable-board';
import type { WhiteboardTransferStore } from '../../src/application/whiteboard/transfer-ports';

const principal:Principal={orgId:toOrgId('org-a'),userId:'user-a'};
const key=(p:Principal)=>`${p.orgId}:${p.userId}`;
class MemoryRepository implements MiroCredentialRepository {
  states=new Map<string,{owner:string;value:MiroAuthorizationState;expires:Date;used:boolean}>(); credentials=new Map<string,SealedMiroCredential>(); audits:Array<[MiroAuditAction,string|undefined,number|undefined]>=[];
  async createState(p:Principal,hash:string,returnTo:string,expires:Date){this.states.set(hash,{owner:key(p),value:{returnTo},expires,used:false});}
  async consumeState(p:Principal,hash:string,now:Date){const row=this.states.get(hash);if(!row||row.owner!==key(p)||row.used||row.expires<=now)return null;row.used=true;return row.value;}
  async save(p:Principal,value:Omit<SealedMiroCredential,'revision'>){this.credentials.set(key(p),{...value,revision:(this.credentials.get(key(p))?.revision??0)+1});}
  async load(p:Principal){return this.credentials.get(key(p))??null;}
  async rotate(p:Principal,expected:number,value:Omit<SealedMiroCredential,'revision'|'connectedAt'>){const old=this.credentials.get(key(p));if(!old||old.revision!==expected)return false;this.credentials.set(key(p),{...old,...value,revision:old.revision+1});return true;}
  async revoke(p:Principal){const old=this.credentials.get(key(p))??null;this.credentials.delete(key(p));return old;}
  async audit(_p:Principal,action:MiroAuditAction,board?:string,count?:number){this.audits.push([action,board,count]);}
}
const token=(access='access',refresh='refresh'):MiroTokenResult=>({credential:{access,refresh},scopes:['boards:read'],expiresAt:null});
const transfer:WhiteboardTransferStore={
  previewImport:async(_p,input)=>importPreview(input),
  exportBoard:async()=>{throw new Error('unused');}, importBoard:async()=>{throw new Error('unused');},
};
function remote(overrides:Partial<MiroRemoteClient>={}):MiroRemoteClient{return {
  authorizationUrl:state=>`https://miro.com/oauth/authorize?scope=boards%3Aread&state=${state}`,
  exchange:async()=>token(),refresh:async()=>token('next','rotated'),revoke:async()=>{},
  boards:async()=>({items:[],hasMore:false}),board:async()=>({id:'board',name:'Board'}),items:async()=>({data:[]}),...overrides,
};}

describe('Miro direct import service',()=>{
  it('binds one-time OAuth state to tenant/user and stores only tenant-bound ciphertext',async()=>{
    const repo=new MemoryRepository(), cipher=new AesMiroCredentialCipher('test-key'), api=remote();
    const service=new MiroDirectImport(repo,cipher,api,transfer,()=>new Date('2026-09-24T00:00:00Z'));
    const started=await service.start(principal,{returnTo:'/studio/board'}),state=new URL(started.authorizationUrl).searchParams.get('state')!;
    await expect(service.callback({...principal,orgId:toOrgId('org-b')},state,'code')).rejects.toMatchObject({code:'OAUTH_STATE_INVALID'});
    await expect(service.callback({...principal,userId:'user-b'},state,'code')).rejects.toMatchObject({code:'OAUTH_STATE_INVALID'});
    await expect(service.callback(principal,state,'code')).resolves.toEqual({returnTo:'/studio/board'});
    await expect(service.callback(principal,state,'code')).rejects.toMatchObject({code:'OAUTH_STATE_INVALID'});
    const stored=repo.credentials.get(key(principal))!;
    expect(stored.sealed).not.toContain('access');expect(JSON.stringify(stored)).not.toContain('refresh');
    expect(()=>cipher.open({...principal,orgId:toOrgId('org-b')},stored.sealed)).toThrow('MIRO_CREDENTIAL_UNAVAILABLE');
  });
  it('single-flights a 401 refresh, rotates tokens atomically, and retries only once',async()=>{
    const repo=new MemoryRepository(),cipher=new AesMiroCredentialCipher('key');
    await repo.save(principal,{sealed:cipher.seal(principal,token().credential),scopes:['boards:read'],connectedAt:new Date().toISOString(),expiresAt:null});
    const refresh=vi.fn(async()=>token('new-access','new-refresh')),boards=vi.fn(async(access:string)=>{if(access==='access')throw new MiroRemoteUnauthorized();return {items:[],hasMore:false};});
    const service=new MiroDirectImport(repo,cipher,remote({refresh,boards}),transfer);
    await Promise.all([service.listBoards(principal,{}),service.listBoards(principal,{})]);
    expect(refresh).toHaveBeenCalledTimes(1);expect(boards).toHaveBeenCalledTimes(4);expect(repo.audits.filter(([a])=>a==='refreshed')).toHaveLength(1);
    expect(cipher.open(principal,(await repo.load(principal))!.sealed)).toEqual({access:'new-access',refresh:'new-refresh'});
  });
  it('fetches every cursor page, feeds the unchanged vendor converter, and stops after revocation',async()=>{
    const fixture=JSON.parse(readFileSync('../../packages/whiteboard-core/tests/fixtures/miro-board-v1.json','utf8')) as {board:{id:string;name:string};pages:Array<{items:Record<string,unknown>[]}>};
    const repo=new MemoryRepository(),cipher=new AesMiroCredentialCipher('key');
    await repo.save(principal,{sealed:cipher.seal(principal,token().credential),scopes:['boards:read'],connectedAt:new Date().toISOString(),expiresAt:null});
    const all=fixture.pages.flatMap(page=>page.items),items=vi.fn(async(_access:string,_board:string,cursor?:string)=>cursor?{data:all.slice(2)}:{data:all.slice(0,2),cursor:'next'});
    const service=new MiroDirectImport(repo,cipher,remote({board:async()=>fixture.board,items}),transfer,()=>new Date('2026-09-24T00:00:00Z'));
    const packageBoardId=randomUUID(),result=await service.preview(principal,{boardId:fixture.board.id,packageBoardId});
    const direct=convertExternalBoardSnapshot({...fixture,pages:[{id:'default',items:all}]},{packageBoardId});if(!direct.ok)throw new Error(direct.code);
    expect(result.input.package.objects).toEqual(direct.package.objects);expect(result.external).toEqual(direct.preview);expect(items).toHaveBeenCalledTimes(2);
    const revokeRepo=new MemoryRepository();await revokeRepo.save(principal,{sealed:cipher.seal(principal,token().credential),scopes:['boards:read'],connectedAt:new Date().toISOString(),expiresAt:null});
    const revokeItems=vi.fn(async()=>{await revokeRepo.revoke(principal);return {data:[],cursor:'again'};});
    await expect(new MiroDirectImport(revokeRepo,cipher,remote({items:revokeItems}),transfer).preview(principal,{boardId:'board',packageBoardId:randomUUID()})).rejects.toMatchObject({code:'NOT_CONNECTED'});
  });
  it('rejects repeated cursors and disconnects locally before remote revoke completes',async()=>{
    const repo=new MemoryRepository(),cipher=new AesMiroCredentialCipher('key');await repo.save(principal,{sealed:cipher.seal(principal,token().credential),scopes:['boards:read'],connectedAt:new Date().toISOString(),expiresAt:null});
    const repeated=remote({items:async()=>({data:[],cursor:'same'})});
    await expect(new MiroDirectImport(repo,cipher,repeated,transfer).preview(principal,{boardId:'board',packageBoardId:randomUUID()})).rejects.toMatchObject({code:'REPEATED_CURSOR'});
    let unavailable=false;const service=new MiroDirectImport(repo,cipher,remote({revoke:async()=>{unavailable=(await repo.load(principal))===null;throw new Error('network');}}),transfer);
    await expect(service.disconnect(principal)).resolves.toEqual({disconnected:true});expect(unavailable).toBe(true);await expect(service.connection(principal)).resolves.toMatchObject({connected:false});
  });
});
