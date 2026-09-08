import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  login,
  openFreshDeepAgentThread,
  sessionHeaders,
  storedMessages,
  warmUpCopilotRuntimeRoute,
} from "./support/chat-path-coverage";

/**
 * 路径矩阵 **D4 · skill 三态区分**（判据见 `.harness/instructions/chat-path-coverage-matrix.md`）。
 *
 * ## 三态是什么，为什么混为一谈是真实风险
 *
 * #2534 之后，一个 skill 参与一次 deep-agent run 有三个**协议上互相独立**的状态：
 *   ① **发现元数据**：`buildDeepAgentSkillCatalogBlock` 把 `stable_name + 一行摘要`
 *      放进 system prompt。模型只知道"有这么个东西"。
 *   ② **正文送达**：全文经 `config.configurable.org_skills[].content` 结构化送到远端。
 *   ③ **执行成功**：远端真的调了 `call_skill`（`DEEP_AGENT_HITL_TOOL_NAME`），
 *      journal 里落下这次调用。
 *
 * 此前只有 ② 被任何测试观察过（`chat-agent-skill-context.spec.ts` /
 * `copilotkit-v2-skill-mount.spec.ts` 的哨兵回显）。于是两类实现能全绿地骗过整套门控：
 *   · 把目录条目当成"正文到了"（① 冒充 ②）——目录里本来就有名字，回显能对上；
 *   · 把"skill 可用"当成"skill 跑过了"（② 冒充 ③）——这类实现会在从未执行的情况下
 *     声称用了某个 skill，而用户看到的是一条以技能名义给出的、其实是凭空编的回答。
 *
 * 本条不重复证 ②（那条已有覆盖），也**不重复证 ③ 为真的那一半**——
 * `copilotkit-v2-hitl.spec.ts` 的 `assertCompleted` 已经在批准之后钉住"journal 里有
 * `call_skill` 的 `tool_start`"，再抄一遍就是把同一个事实声明在两处。本条要证的是
 * 剩下那件没人证过、也正是"混为一谈"唯一可判的形态：**①② 为真不蕴含 ③**。
 *
 * ## 判据都读什么
 *
 * ①② 读上游替身的两个**互不相同**的回显前缀：目录态只在 system prompt 的目录块里
 * 真的出现那个 `stable_name` 时回显，正文态只在 `org_skills[].content` 里真的出现哨兵
 * 时回显（`loopback-deep-agent-provider.ts` 两个独立函数，见各自头注）。
 * ③ 读 `GET /agent-runs/:runId/execution-events` 这条**产品自己的**审计 journal，
 * 找有没有 `call_skill` 的 `tool_start`——不是问 UI，UI 正是可能说谎的那一层。
 */
test.setTimeout(300_000);

interface JournalEvent {
  readonly kind: string;
  readonly toolName?: string;
}

async function journalToolNames(page: Page, runId: string): Promise<string[]> {
  const response = await page.request.get(`/agent-runs/${runId}/execution-events?afterSeq=-1`, {
    headers: await sessionHeaders(page),
  });
  expect(response.ok()).toBe(true);
  const body = await response.json() as { events: JournalEvent[] };
  return body.events.filter((event) => event.kind === "tool_start" && typeof event.toolName === "string")
    .map((event) => event.toolName!);
}

test("@path:D4 skill 三态：目录可见 / 正文送达 / 真的执行过，三者各自独立可判", async ({ page }) => {
  await login(page);
  await warmUpCopilotRuntimeRoute(page);
  const threadId = await openFreshDeepAgentThread(page);

  // ── 一轮普通提问：不要求它用任何 skill ──
  const marker = `SKILL-STATES-${Date.now()}：随便聊一句就好，不需要动用任何技能`;
  await page.getByTestId("copilotkit-v2-input").fill(marker);
  await page.getByTestId("copilotkit-v2-send").click();
  const messages = page.getByTestId("copilotkit-v2-messages");
  await expect(messages).toContainText(marker, { timeout: 60_000 });

  // ① 目录态：这个 stable_name 真的出现在 system prompt 的目录块里。
  await expect(
    messages,
    "skill 必须以目录条目的形式出现在 system prompt 里（`buildDeepAgentSkillCatalogBlock`）——"
    + "这一条红说明模型根本不知道这个 skill 存在，后面两态无从谈起",
  ).toContainText(
    `${CHAT_READ_E2E.mountedSkillCatalogEchoPrefix}${CHAT_READ_E2E.mountableSkillStableName}`,
    { timeout: 120_000 },
  );

  // ② 正文态：全文经 `org_skills` 真的送到了远端。与①**必须是两个不同的信号**——
  //    同一个前缀出现两次不算两态。
  await expect(
    messages,
    "skill 正文必须经 `config.configurable.org_skills[].content` 送达（#2534 之后唯一的正文通道）",
  ).toContainText(
    `${CHAT_READ_E2E.mountedSkillEchoPrefix}${CHAT_READ_E2E.mountedSkillSentinel}`,
    { timeout: 120_000 },
  );

  // ③ 执行态：这一轮**没有**执行任何 skill。①②为真而③为假，正是本条的核心断言——
  //    做不到这个区分的实现，会在从未执行的情况下声称"已按技能执行"。
  const afterPlainTurn = await storedMessages(page, threadId);
  const plainRunId = afterPlainTurn.find(
    (message) => message.authorKind === "human" && message.text === marker,
  )?.agentRunId;
  expect(plainRunId, "用户消息必须已落库并挂着这次 run").toEqual(expect.any(String));
  expect(
    await journalToolNames(page, plainRunId!),
    "没要求用技能的这一轮里不得出现 call_skill——「目录里有它」「正文送到了」都不等于「它跑过了」",
  ).not.toContain("call_skill");

  // ③ 的另一半（真的执行过时 journal 里有 `call_skill`）刻意不在这里再证一遍——
  //    见文件头注：`copilotkit-v2-hitl.spec.ts` 已经钉住它，本条只补它的反面。
});
