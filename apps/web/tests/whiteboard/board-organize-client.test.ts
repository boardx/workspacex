// @vitest-environment jsdom

import {afterEach,expect,it,vi} from 'vitest';
import {SESSION_TOKEN_STORAGE_KEY} from '@/lib/api-client';
import {organizeBoard,undoAIProposal} from '@/lib/whiteboard-operation-client';
afterEach(()=>{vi.unstubAllGlobals();localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);});
it('organize carries shared bearer auth and strips head role from revision contract',async()=>{
 localStorage.setItem(SESSION_TOKEN_STORAGE_KEY,'unit-session');
 const request=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({epoch:1,seq:2,role:'owner'}),{status:200})).mockResolvedValueOnce(new Response('{}',{status:409}));vi.stubGlobal('fetch',request);
 await expect(organizeBoard('board','agent',['a','b'])).rejects.toThrow('BOARD_OPERATION_CONFLICT');
 for(const [,options] of request.mock.calls)expect(options.headers.Authorization).toBe('Bearer unit-session');
 expect(JSON.parse(request.mock.calls[1]![1].body)).toMatchObject({actorId:'agent',objectIds:['a','b'],expectedRevision:{epoch:1,seq:2}});
 expect(JSON.parse(request.mock.calls[1]![1].body).expectedRevision).not.toHaveProperty('role');
});
it('undo sends only proposal identity and expected revision, not untrusted inverse commands',async()=>{
 const request=vi.fn().mockResolvedValue(new Response('{}',{status:409}));vi.stubGlobal('fetch',request);
 await expect(undoAIProposal({boardId:'board',proposalId:'proposal'} as never,{epoch:1,seq:8})).rejects.toThrow('BOARD_OPERATION_CONFLICT');
 const body=JSON.parse(request.mock.calls[0]![1].body);expect(Object.keys(body).sort()).toEqual(['expectedRevision','requestId']);
});
