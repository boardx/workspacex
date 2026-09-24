import { describe, expect, it, vi } from 'vitest';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { MiroDirectImport } from '../../src/application/whiteboard/miro-direct-import';
import { MiroImportError } from '../../src/application/whiteboard/miro-ports';
import { WhiteboardMiroController } from '../../src/interface/controllers/whiteboard-miro.controller';

const principal:Principal={orgId:toOrgId('org-a'),userId:'user-a'};
const service=(values:Partial<Record<keyof MiroDirectImport,unknown>>={})=>({
  connection:vi.fn(async()=>({connected:false,scopes:[],connectedAt:null})),
  start:vi.fn(),callback:vi.fn(),listBoards:vi.fn(),preview:vi.fn(),disconnect:vi.fn(),...values,
}) as unknown as MiroDirectImport;

describe('Whiteboard Miro controller boundary',()=>{
  it('requires a principal before board listing or preview reaches the service',async()=>{
    const target=service(),controller=new WhiteboardMiroController(target);
    await expect(controller.boards(null as unknown as Principal,{})).rejects.toThrow('principal is empty');
    await expect(controller.preview(null as unknown as Principal,{boardId:'b',packageBoardId:'57d83843-21e2-40ae-8c1c-571d0ad63c80'})).rejects.toThrow('principal is empty');
    expect(target.listBoards).not.toHaveBeenCalled();expect(target.preview).not.toHaveBeenCalled();
  });
  it('returns only a validated relative callback target and rejects a forged redirect from below',async()=>{
    const good=service({callback:vi.fn(async()=>({returnTo:'/studio/board/57d83843-21e2-40ae-8c1c-571d0ad63c80'}))});
    await expect(new WhiteboardMiroController(good).callback(principal,{state:'s',code:'c'})).resolves.toEqual({returnTo:'/studio/board/57d83843-21e2-40ae-8c1c-571d0ad63c80'});
    const forged=service({callback:vi.fn(async()=>({returnTo:'https://evil.test'}))});
    await expect(new WhiteboardMiroController(forged).callback(principal,{state:'s',code:'c'})).rejects.toThrow();
  });
  it('maps typed failures without returning remote details or credential material',async()=>{
    const target=service({listBoards:vi.fn(async()=>{throw new MiroImportError('REMOTE_RATE_LIMITED');})});
    await expect(new WhiteboardMiroController(target).boards(principal,{})).rejects.toMatchObject({status:429,response:{reasonCode:'REMOTE_RATE_LIMITED'}});
  });
});
