import { test, expect } from '@playwright/test';
import { REAL_MODEL_SMOKE, REAL_MODEL_SKIP_REASON } from './real-model-smoke-fixture';
import { generateChatBoardSource } from './support/chat-board-real-source';
import { produceChatBoardThreeDiagramEvidence } from './support/chat-board-three-diagram-producer';
import { whiteboardOperationOperations as BoardAPI } from '@repo/contracts/whiteboard-operation';
import { authedJson } from './support/real-model-api';

test('real Chat generates three persisted diagrams then inserts canonical layouts into Board', async ({ page, request }, testInfo) => {
  test.setTimeout(3 * REAL_MODEL_SMOKE.runTimeoutMs + 360_000);
  expect(REAL_MODEL_SKIP_REASON, 'Missing credentials must fail this acceptance lane, not skip.').toBeNull();
  expect(process.env.BOARD_REAL_MODEL_PREPARE_FIXTURE).toBe('1');
  expect(process.env.REAL_MODEL_E2E_USE_FULLSTACK_SEED).toBe('1');
  const actorId = process.env.BOARD_REAL_MODEL_ACTOR_ID, expectedModel = process.env.BOARD_REAL_MODEL_EXPECTED_MODEL;
  expect(actorId, 'Use the explicitly registered Board actor from real-model global setup.').toBeTruthy();
  expect(expectedModel, 'Published real model must be validated by global setup.').toBeTruthy();
  expect(process.env.WORKSPACEX_API_PORT).toMatch(/^\d+$/);
  await page.goto('/login');
  await page.getByTestId('login-email').fill(REAL_MODEL_SMOKE.email);
  await page.getByTestId('login-password').fill(REAL_MODEL_SMOKE.password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/projects$/);
  const sources = [];
  for (const family of ['flowchart', 'sequence', 'persona'] as const) {
    const source = await generateChatBoardSource(page, family, expectedModel!);
    sources.push(source);
    await testInfo.attach(`real-chat-${family}-provenance`, { body: JSON.stringify(source.provenance), contentType: 'application/json' });
    await testInfo.attach(`real-chat-${family}-render`, { body: await page.screenshot(), contentType: 'image/png' });
  }
  expect(new Set(sources.map(source => source.provenance.threadId)).size).toBe(3);
  expect(new Set(sources.map(source => source.provenance.runId)).size).toBe(3);
  const evidence = await produceChatBoardThreeDiagramEvidence({ page, api: request, apiOrigin: `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`, actorId: actorId!, sources });
  // Independently retain canonical read authority under the registered actor after all handoffs.
  for (const item of evidence) {
    const read = await authedJson(page, `${BoardAPI.readObjects.path.replace(':boardId', item.boardId)}?actorId=${encodeURIComponent(actorId!)}`);
    expect(read.ok).toBe(true);
    expect(BoardAPI.readObjects.output.parse(read.json).objects.length).toBe(item.canonicalObjects);
  }
  await testInfo.attach('real-chat-board-roundtrips', { body: JSON.stringify({ sources: sources.map(source => source.provenance), evidence }, null, 2), contentType: 'application/json' });
});
