import { test, expect } from '@playwright/test';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';
import { produceChatBoardThreeDiagramEvidence } from './support/chat-board-three-diagram-producer';

test('actual Chat flowchart, sequence and persona retain canonical layout after insert and reload',async({page,request},testInfo)=>{
  test.setTimeout(240_000);
  const sources=(['flowchart','sequence','persona'] as const).map(family=>{
    const name=`BOARD_CHAT_${family.toUpperCase()}_URL`,chatUrl=process.env[name];
    if(!chatUrl)throw new Error(`${name} must point at a real persisted assistant diagram in this isolated stack; no synthetic artifact fallback`);
    return {family,chatUrl};
  });
  await page.goto('/login');
  await page.getByTestId('login-email').fill(FULLSTACK_E2E.email);
  await page.getByTestId('login-password').fill(FULLSTACK_E2E.password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/projects$/);
  const evidence=await produceChatBoardThreeDiagramEvidence({page,api:request,apiOrigin:`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`,actorId:FULLSTACK_E2E.agentId,sources});
  await testInfo.attach('three-real-chat-canonical-roundtrips',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
});
