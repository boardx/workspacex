import {expect,it,vi} from 'vitest';
import type {Page} from '@playwright/test';
import {awaitStoredAgentReply} from '../e2e/support/chat-path-coverage';

function fixture(statuses:number[], messages=[{authorKind:'agent',text:'this-turn.pptx content-sentinel'}]) {
 let reads=0;
 const get=vi.fn(async()=>{
  const status=statuses[Math.min(reads++,statuses.length-1)]!;
  return {status:()=>status,ok:()=>status===200,json:async()=>status===200?{messages}:{error:'dependency_unavailable',traceId:'7f4f8c0a-013a-43ae-8e9c-e8a45c74d58f'}};
 });
 const page={url:()=> 'http://localhost:3000/chat/thread',evaluate:async()=> 'test-session',request:{get}} as unknown as Page;
 return {page,get};
}

it('waits through a transient 503 for the same persisted reply',async()=>{
 const {page,get}=fixture([503,200]);
 await expect(awaitStoredAgentReply(page,'thread',['this-turn.pptx','content-sentinel'],1200)).resolves.toBeUndefined();
 expect(get).toHaveBeenCalledTimes(2);
});
it('keeps a permanently unavailable read red and reports HTTP 503',async()=>{
 const {page}=fixture([503]);
 await expect(awaitStoredAgentReply(page,'thread',['this-turn.pptx'],150)).rejects.toThrow('503');
});
it.each([401,403,500])('does not treat HTTP %s as a transient available reply',async(status)=>{
 const {page,get}=fixture([status,200]);
 await expect(awaitStoredAgentReply(page,'thread',['this-turn.pptx'],1200)).rejects.toThrow(String(status));
 expect(get).toHaveBeenCalledTimes(2);
});
it('requires all turn sentinels on one agent message',async()=>{
 const {page}=fixture([200],[{authorKind:'agent',text:'this-turn.pptx'},{authorKind:'agent',text:'content-sentinel'}]);
 await expect(awaitStoredAgentReply(page,'thread',['this-turn.pptx','content-sentinel'],150)).rejects.toThrow();
});
it('does not accept a human echo as a persisted agent reply',async()=>{
 const {page}=fixture([200],[{authorKind:'human',text:'this-turn.pptx content-sentinel'}]);
 await expect(awaitStoredAgentReply(page,'thread',['this-turn.pptx','content-sentinel'],150)).rejects.toThrow();
});
