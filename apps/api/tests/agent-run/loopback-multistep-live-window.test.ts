import { expect, it } from "vitest";
import { fixture } from "./loopback-deep-agent-fixture";

/**
 * issue #3297 —— 多步剧本必须**真的跑一段时间**，否则 F3 的暂停入口断言结构上不可达。
 *
 * ## 它证什么，不证什么
 *
 * 不证产品行为（那是 `apps/web/e2e/chat-path-f3-pause-resume-retry-step.spec.ts` 的事，
 * 跑在真栈上）。它证的是那条 spec 的**被测状态真的可达**：run 在 live 期间给得出
 * `chat-task-workbench-run-pause`，前提是**存在**一段 live 期间。
 *
 * ## 为什么必须有这一处当场跑得动的取证
 *
 * `MULTISTEP_MIN_STATUS_POLLS` 的设计意图逐字写在它自己的头注里（替身 :84-93）：
 * 「把该 run 的终态推迟到至少这么多次状态轮询之后」。它**一次也没生效过** —— 流 EOF
 * 那段把 `statusPolls` 推到 `Number.MAX_SAFE_INTEGER`，多步剧本没有 `holdUntilPoll`
 * ⇒ `0 <= statusPolls` 恒真 ⇒ EOF 一到就饱和 ⇒ `statusPolls < requiredPolls` 恒假
 * ⇒ EOF 后第一次状态轮询就落终态。
 *
 * 实测后果（run 34416935580 的 chat-path-coverage 证据包，F3 用例 trace.zip 里
 * `GET /plan-control/threads/:id/ledger` 的全部 50 次应答，去重后只有三态）：
 *   531142.5  runStatus=idle       phase=preparing  steps=0
 *   537129.9  runStatus=running    phase=executing  steps=0   ← `running` 只被采到 1 次
 *   540113.4  runStatus=succeeded  phase=done       steps=3
 * live 窗口 ≤ 一个前端账本轮询周期（3s）。断言等了 60 秒、采样 123 次，全 0。
 *
 * 「断言写得对但被测状态不可达」是本仓的惯犯。一个写在文档里、却因为另一条捷径而
 * 从未参与过判定的旋钮，比没有这个旋钮更坏：它让读代码的人以为窗口是撑开的。
 *
 * ## 反证也在本文件里（本仓纪律：没有反证的门视为未落地）
 *
 * 第二条用例把轮数压到最低，窗口当场消失。若第一条的绿不依赖那个旋钮，两条会一起绿——
 * 那就说明这个门是空操作。
 */

const TRIGGER = "multistep";
/**
 * 替身对**所有**剧本的通用终态阈值（`LOOPBACK_DEEP_AGENT_STATUS_POLLS`，默认 2）。
 * 多步旋钮压到 0 时窗口回落到它——所以「窗口消失」的下界是它，不是 0。
 */
const STATUS_POLLS_BEFORE_DONE = 2;
/** 走完一条流直到 EOF——EOF 正是那条饱和捷径发生的时刻，绕开它就测不到本文件要测的东西。 */
async function drainStream(request: ReturnType<typeof fixture>, threadId: string): Promise<void> {
  const stream = request.openStream(`/threads/${threadId}/runs/${threadId}/stream`);
  for (let wait = 0; wait < 400 && !stream.isEnded(); wait += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(stream.isEnded(), "这条流必须真的读到 EOF —— 没走到 EOF 就没触发那条饱和捷径，本用例什么都没测到").toBe(true);
}

/** 从流 EOF 之后开始数：连着轮询状态，直到落终态或超过 `cap` 次。 */
async function pollsUntilTerminal(request: ReturnType<typeof fixture>, threadId: string, cap: number): Promise<string[]> {
  const seen: string[] = [];
  for (let poll = 0; poll < cap; poll += 1) {
    const { status } = await request("GET", `/threads/${threadId}/runs/${threadId}`);
    seen.push(status as string);
    if (status !== "pending") break;
  }
  return seen;
}

async function startMultistep(request: ReturnType<typeof fixture>): Promise<string> {
  const { thread_id: threadId } = await request("POST", "/threads", {});
  await request("POST", `/threads/${threadId}/runs`, { input: { messages: [{ role: "user", content: TRIGGER }] } });
  return threadId;
}

it("多步剧本在流 EOF 之后仍有一段由构造撑开的 pending 窗口，且**有界**地落终态", async () => {
  const request = fixture({ LOOPBACK_DEEP_AGENT_MULTISTEP_MIN_POLLS: "8", LOOPBACK_DEEP_AGENT_STREAM_GAP_MS: "1" });
  const threadId = await startMultistep(request);
  await drainStream(request, threadId);

  const seen = await pollsUntilTerminal(request, threadId, 40);
  const pendingPolls = seen.filter((status) => status === "pending").length;

  /*
   * 判据是**轮数**，不是「有没有出现过一次 pending」：F3 要的是一段跨若干个前端账本
   * 轮询周期（3s）的窗口，而状态轮询周期是 2000ms（`KERNEL_DEEP_AGENT_POLL_INTERVAL_MS`）。
   * 8 轮 ⇒ ≈16 秒，足够展开计划面板再点一次暂停。只判「≥1」会让一个宽度为 1 轮
   * （2 秒 < 3 秒轮询周期）的窗口也算通过——那正是这次红的形状。
   */
  expect(
    pendingPolls,
    `流 EOF 之后的状态轮询序列：${JSON.stringify(seen)}。`
    + "多步剧本必须在 EOF 之后仍回若干轮 pending —— 这段窗口就是 F3 的 "
    + "`chat-task-workbench-run-pause` 唯一可能出现的时间段（渲染门是 `runLive`，终态恒 false）。"
    + "为 0 说明那条 EOF 饱和捷径又把 `MULTISTEP_MIN_STATUS_POLLS` 吃掉了。",
  ).toBeGreaterThanOrEqual(7);

  // ⚠ 有界：「一直不终态」和「卡住了」在界面上分不开，那种替身会让 F3 的业务判据
  //   （暂停真的停下来 / 恢复真的接着跑）变成不可证伪的。
  expect(
    seen[seen.length - 1],
    `状态轮询序列：${JSON.stringify(seen)}。窗口必须有界——40 轮之内必须落终态`,
  ).not.toBe("pending");
});

it("反证：把轮数压到最低，那段窗口当场消失", async () => {
  const request = fixture({ LOOPBACK_DEEP_AGENT_MULTISTEP_MIN_POLLS: "0", LOOPBACK_DEEP_AGENT_STREAM_GAP_MS: "1" });
  const threadId = await startMultistep(request);
  await drainStream(request, threadId);

  const seen = await pollsUntilTerminal(request, threadId, 40);
  expect(
    seen.filter((status) => status === "pending").length,
    `状态轮询序列：${JSON.stringify(seen)}。`
    + "旋钮置 0 时窗口必须当场消失。它若照样绿，说明上一条的绿与这个旋钮无关，这个门是空操作。",
  ).toBeLessThanOrEqual(STATUS_POLLS_BEFORE_DONE);
});
