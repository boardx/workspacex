import { beforeEach, expect, it, vi } from 'vitest';
const harness=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@/lib/api-client',()=>({apiRequest:harness.request,ApiError:class extends Error{status=500;}}));
import {readPresentation} from '@/lib/whiteboard-operation-client';
const state={boardId:'00000000-0000-4000-8000-000000000001',roomId:'default',revision:0,presenterId:null,viewport:{x:0,y:0,zoom:1},followers:[],updatedAt:'2026-10-03T00:00:00.000Z'};
beforeEach(()=>{harness.request.mockReset();harness.request.mockResolvedValue(state);});
it('forwards the exact optional signal through the shared API transport',async()=>{
  const controller=new AbortController();
  await expect(readPresentation(state.boardId,'default',controller.signal)).resolves.toEqual(state);
  expect(harness.request).toHaveBeenCalledWith(expect.stringContaining('?roomId=default'),expect.objectContaining({signal:controller.signal}));
});
it('retains callers without a signal and does not swallow abort rejection',async()=>{
  await expect(readPresentation(state.boardId,'default')).resolves.toEqual(state);
  const abort=new DOMException('Aborted','AbortError');
  harness.request.mockRejectedValueOnce(abort);
  await expect(readPresentation(state.boardId,'default',new AbortController().signal)).rejects.toBe(abort);
});
