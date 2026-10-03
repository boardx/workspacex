import {afterEach,expect,it,vi} from 'vitest';
import {readPresentation} from '@/lib/whiteboard-operation-client';

afterEach(()=>vi.unstubAllGlobals());
it('the real shared API client passes the exact signal to fetch and preserves cancellation',async()=>{
  const controller=new AbortController();let received:AbortSignal|null|undefined;
  vi.stubGlobal('fetch',vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
    received=init?.signal;
    init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  })));
  const pending=readPresentation('00000000-0000-4000-8000-000000000001','default',controller.signal);
  const rejection=expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(received).toBe(controller.signal);controller.abort();await rejection;
  expect(fetch).toHaveBeenCalledOnce();
});
it('does not retry or convert an already-aborted fetch into a valid presentation',async()=>{
  const controller=new AbortController();controller.abort();
  vi.stubGlobal('fetch',vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>{
    expect(init?.signal).toBe(controller.signal);expect(init?.signal?.aborted).toBe(true);
    return Promise.reject(new DOMException('Aborted','AbortError'));
  }));
  await expect(readPresentation('00000000-0000-4000-8000-000000000001','default',controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(fetch).toHaveBeenCalledOnce();
});
