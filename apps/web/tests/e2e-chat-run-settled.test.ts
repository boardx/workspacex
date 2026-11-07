import { expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { expectSendNotBlockedOnRun } from '../e2e/support/chat-path-coverage';

it('reports the departed page rather than the last running value', async () => {
  let url='http://localhost:3000/chat/thread-a';
  let reads=0;
  const page={url:()=>url,getByTestId:()=>({count:async()=>url.includes('localhost')?1:0,getAttribute:async()=>{
    reads+=1;
    if(reads===1){url='http://appv1.boardx.us/';return 'running';}
    return null;
  }})} as unknown as Page;
  await expect(expectSendNotBlockedOnRun(page,300)).rejects.toThrow('appv1.boardx.us');
});

it('does not mistake a missing composer state for a completed turn', async () => {
  const page={url:()=> 'http://localhost:3000/chat/thread-a',getByTestId:()=>({count:async()=>1,getAttribute:async()=>null})} as unknown as Page;
  await expect(expectSendNotBlockedOnRun(page,150)).rejects.toThrow();
});

it.each(['ready','disabled'])('accepts a present composer in %s state', async (state) => {
  const page={url:()=> 'http://localhost:3000/chat/thread-a',getByTestId:()=>({count:async()=>1,getAttribute:async()=>state})} as unknown as Page;
  await expect(expectSendNotBlockedOnRun(page,150)).resolves.toBeUndefined();
});
