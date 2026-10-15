import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import * as Y from 'yjs';
import {useBoardMindmap} from '@/components/whiteboard/use-board-mindmap';
const transport=vi.hoisted(()=>({execute:vi.fn(),request:vi.fn()}));
vi.mock('@/lib/whiteboard-operation-client',()=>({executeBoardOperation:(...args:unknown[])=>transport.execute(...args)}));
vi.mock('@/lib/api-client',()=>({apiRequest:(...args:unknown[])=>transport.request(...args)}));
vi.mock('@/components/session/session-provider',()=>({useOptionalSession:()=>({session:{userId:'user-test',currentOrgId:'org-test'}})}));
afterEach(()=>vi.clearAllMocks());
const receipt=(seq:number)=>({operationId:`00000000-0000-4000-8000-${String(seq).padStart(12,'0')}`,requestId:'00000000-0000-4000-8000-000000000099',boardId:'00000000-0000-4000-8000-000000000001',revision:{epoch:1,seq},replayed:false,events:[]});
describe('Mindmap history during authoritative save',()=>{
 it('queues one undo until the operation receipt revision is applied, without optimistic local writes',async()=>{
  const doc=new Y.Doc(),updates=vi.fn();doc.on('update',updates);
  let accept!:(value:ReturnType<typeof receipt>)=>void;transport.execute.mockImplementation(()=>new Promise(resolve=>{accept=resolve;}));transport.request.mockResolvedValue(receipt(2));
  const onNotice=vi.fn(),onSelection=vi.fn(),boardId=receipt(1).boardId;
  const {result,rerender,unmount}=renderHook(({seq})=>useBoardMindmap({boardId,doc,readOnly:false,role:'editor',revision:{epoch:1,seq},onNotice,onSelection}),{initialProps:{seq:0}});
  let saving!:Promise<boolean>;
  act(()=>{saving=result.current.run({action:'create-root',id:'root',text:'主题',position:{x:0,y:0}});});
  expect(result.current.busy).toBe(true);
  await act(async()=>{await result.current.undo();await result.current.undo();});
  expect(transport.request).not.toHaveBeenCalled();expect(updates).not.toHaveBeenCalled();
  await act(async()=>{accept(receipt(1));await saving;});
  expect(result.current.busy).toBe(true);expect(transport.request).not.toHaveBeenCalled();
  rerender({seq:1});await waitFor(()=>expect(transport.request).toHaveBeenCalledTimes(1));
  expect(transport.request).toHaveBeenCalledWith(`/v1/whiteboards/${boardId}/operations/${receipt(1).operationId}/undo`,{method:'POST',body:{expectedRevision:{epoch:1,seq:1}}});
  expect(updates).not.toHaveBeenCalled();rerender({seq:2});await waitFor(()=>expect(result.current.busy).toBe(false));
  unmount();doc.off('update',updates);doc.destroy();
 });
 it('retains the first save error and discards queued undo when save is rejected',async()=>{
  const doc=new Y.Doc();let reject!:(error:Error)=>void;transport.execute.mockImplementation(()=>new Promise((_,failed)=>{reject=failed;}));
  const onNotice=vi.fn(),onSelection=vi.fn();const {result,unmount}=renderHook(()=>useBoardMindmap({boardId:receipt(1).boardId,doc,readOnly:false,role:'editor',revision:{epoch:1,seq:0},onNotice,onSelection}));
  let saving!:Promise<boolean>;act(()=>{saving=result.current.run({action:'create-root',id:'root',text:'主题',position:{x:0,y:0}});});
  await act(async()=>{await result.current.undo();});await act(async()=>{reject(new Error('BOARD_OPERATION_CONFLICT'));await saving;});
  expect(result.current.busy).toBe(false);expect(transport.request).not.toHaveBeenCalled();expect(onNotice).toHaveBeenLastCalledWith('思维导图未保存：其他成员已修改白板，请核对后重试。');
  unmount();doc.destroy();
 });
});
