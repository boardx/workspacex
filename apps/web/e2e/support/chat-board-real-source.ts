import { expect, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { operations as Chat } from '@repo/contracts/chat';
import { AgentRunView } from '@repo/contracts/wave2-runtime';
import { extractMermaidBlocks } from '../../../../packages/fabric-markdown/src/markdown';
import { REAL_MODEL_SMOKE } from '../real-model-smoke-fixture';
import { V2_SEND_WIRE } from '../chat-v2-send';
import { authedJson } from './real-model-api';

export type DiagramFamily = 'flowchart' | 'sequence' | 'persona';
const tasks: Record<DiagramFamily, string> = {
  flowchart: '请设计一个团队从收集用户问题、研究、设计到验证的流程图，至少三个节点和两条有意义的关系。只输出一个闭合的 mermaid 代码围栏，使用 flowchart LR。请自己构造节点和标签。',
  sequence: '请设计一个用户、应用、服务端之间提交反馈并收到确认的时序图，至少三个参与者和三条按时间排列的消息。只输出一个闭合的 mermaid 代码围栏，使用 sequenceDiagram。请自己构造消息。',
  persona: '请创造一位管理远程产品团队的虚构用户画像。只输出一个闭合的 persona 代码围栏，采用字段“姓名: 内容”“年龄: 内容”“职位: 内容”和分区“目标和需求:”以及其下“- 条目”，还需用户描述、行为与偏好、痛点和挑战、动机、影响因素分区，每区至少两条原创内容。不要输出 Mermaid。',
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function assertDiagramText(family: DiagramFamily, text: string) {
  const blocks = extractMermaidBlocks(text);
  expect(blocks, 'Exactly one real generated diagram is required; never choose a convenient earlier preview.').toHaveLength(1);
  expect(blocks[0].closed).toBe(true);
  if (family === 'persona') expect(blocks[0].lang).toBe('persona');
  else {
    expect(blocks[0].lang).toBe('mermaid');
    expect(blocks[0].code.trim()).toMatch(family === 'flowchart' ? /^(?:flowchart|graph)\s/ : /^sequenceDiagram\b/);
  }
}

/** Generates through the actual Chat UI, then reads durable messages and the actual run.
 * No assistant insert, seeded content, route interception or model-response substitute. */
export async function generateChatBoardSource(page: Page, family: DiagramFamily, expectedModel: string) {
  const nonce = randomUUID();
  const prompt = `${tasks[family]}\n这是一个独立的图形创作任务，任务标识 ${nonce}。不要调用工具、访问外部资源或要求用户提供材料。直接生成图形内容。`;
  await page.goto('/chat');
  const composer = page.getByTestId('copilotkit-v2-input');
  await expect(composer).toBeVisible({ timeout: 120_000 });
  await composer.fill(prompt);
  const wire = page.waitForRequest(request => request.method() === 'POST' && V2_SEND_WIRE.test(new URL(request.url()).pathname), { timeout: 60_000 });
  const started = Date.now();
  await page.getByTestId('copilotkit-v2-send').click();
  await wire; // actual runtime transport, not a synthetic message write
  await expect(page).toHaveURL(/\/chat\/[^/?#]+/, { timeout: 90_000 });
  const threadId = /\/chat\/([^/?#]+)/.exec(page.url())![1];
  let inputMessageId: string | undefined;
  let reply: ReturnType<typeof Chat.listMessages.out.parse>['messages'][number] | undefined;
  await expect.poll(async () => {
    // A direct diagram task should not silently grant arbitrary tool authority.
    expect(await page.getByTestId('chat-tool-permission-dialog').count(), 'Unexpected tool request; explicit review required.').toBe(0);
    const confirmation = page.getByTestId('agent-interrupt-confirm-intent-continue');
    if (await confirmation.isVisible()) await confirmation.click();
    const result = await authedJson(page, `/chat/threads/${encodeURIComponent(threadId)}/messages?limit=100`);
    expect(result.ok, `Read persisted messages HTTP ${result.status}`).toBe(true);
    const messages = Chat.listMessages.out.parse(result.json).messages;
    const input = messages.find(message => message.authorKind === 'human' && message.text.includes(nonce));
    if (!input) return false;
    inputMessageId = input.id;
    const candidates = messages.filter(message => message.authorKind === 'agent' && message.agentRunId !== null && extractMermaidBlocks(message.text).length > 0);
    if (!candidates.length) return false;
    expect(candidates, 'Fresh thread must have one generated diagram message.').toHaveLength(1);
    reply = candidates[0];
    return true;
  }, { timeout: REAL_MODEL_SMOKE.runTimeoutMs, intervals: [1000, 2000] }).toBe(true);
  expect(reply).toBeTruthy();
  assertDiagramText(family, reply!.text);
  const runResponse = await authedJson(page, `/agent-runs/${encodeURIComponent(reply!.agentRunId!)}`);
  expect(runResponse.ok, `Read actual model run HTTP ${runResponse.status}`).toBe(true);
  const run = AgentRunView.parse(runResponse.json);
  expect(run.threadId).toBe(threadId);
  expect(run.inputMessageId).toBe(inputMessageId);
  expect(run.resultMessageId).toBe(reply!.id);
  expect(run.status).toBe('succeeded');
  const actualModel = `${run.modelProvider}/${run.modelId}`;
  expect(actualModel).toBe(expectedModel);
  expect(actualModel).not.toMatch(/loopback|mock|fixture|e2e/i);
  // Force hydration from server before any save/insert action.
  await page.reload();
  const prefix = family === 'persona' ? 'chat-canvas' : 'chat-diagram';
  await expect(page.getByTestId(`${prefix}-fabric`)).toHaveCount(1);
  await expect(page.getByTestId(`${prefix}-fabric`).locator('canvas').first()).toBeVisible();
  const reread = await authedJson(page, `/chat/threads/${encodeURIComponent(threadId)}/messages?limit=100`);
  expect(reread.ok).toBe(true);
  expect(Chat.listMessages.out.parse(reread.json).messages.find(message => message.id === reply!.id)?.text).toBe(reply!.text);
  return {
    family, chatUrl: `/chat/${encodeURIComponent(threadId)}`,
    provenance: { threadId, messageId: reply!.id, runId: run.runId, agentId: run.agentId, agentVersionId: run.agentVersionId, model: actualModel, promptHash: digest(prompt), assistantHash: digest(reply!.text), elapsedMs: Date.now() - started },
  };
}
