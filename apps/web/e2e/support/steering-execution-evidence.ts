import type { ExecutionEvent } from "@repo/contracts/execution-journal";

/**
 * issue #3312 —— steering 验收的判据从「快照那一刻恰好在飞的那一件」改锚到**真实业务语义**。
 *
 * ## 旧判据为什么在产品完全正确时也会红
 *
 * 旧写法先用 `expect.poll` 抓一件「有 `tool_start` 尚无 `tool_end`」的工具当 `activeToolId`，
 * 再断言 `tool_end(activeToolId).seq > received.seq`。可十对工具跑得比一次 POST 往返还快：
 *
 * ```
 *  6 tool_start  scroll-…-1
 *  7 tool_end    scroll-…-1  ok=true     ← 快照抓到的那件在这里就收尾了
 *  8 interjection received                ← received.seq = 8
 *  9 tool_start  scroll-…-2
 * ```
 *
 * 抓到的是 `scroll-…-1`，它在插话落地**之前**已经 `ok=true` 收尾 ⇒ `seq > received.seq` 恒假。
 * 红不红只取决于 interject 的 POST 落在第几对工具之间——本地相位固定所以稳定红、CI 各车道
 * 相位不同所以此前一直绿。这是取样方式的缺陷，不是产品缺陷。
 *
 * ## 新判据锚在哪里
 *
 * 这条验收真正要证的是「插话被持久接收，且**没有打断执行**」。它有四条互不重叠的可判形态：
 *
 * 1. **插话之后执行仍在推进**：`received.seq` 之后仍有工具**成对**完成（`tool_start` 有配对的
 *    `ok=true` `tool_end`）。用「之后还有工具成对完成」代替「特定那一件必须在之后收尾」——
 *    前者不依赖快照相位，后者依赖。
 * 2. **没有工具被插话打断**：全journal 里**每一个** `tool_start` 都有配对的 `ok=true` `tool_end`。
 *    ⚠ 这一条**严格强于**旧判据：旧的只管快照抓到的那一件，新的管全部。「插话取消了活跃工具」
 *    这类真缺陷会以「某件工具悬空无 `tool_end`」或「`tool_end.ok=false`」现形，两种都被它抓住。
 * 3. **全程无取消**：不存在 `status === "cancelled"` 的事件。
 * 4. **只有一条 run**：journal 里出现的 `runId` 集合恰为 `{runId}`。「插话另起了一条 run」被它抓住。
 *
 * 返回违规描述数组（空数组 = 通过）。断言失败时把它整个打出来，红有证据而不是 `expected true`。
 */
export interface SteeringEvidenceInput {
  readonly events: readonly ExecutionEvent[];
  /** 本次验收唯一应当存在的 run id。 */
  readonly runId: string;
  /** `interjection` 事件（`status === "received"`）的 seq。 */
  readonly receivedSeq: number;
}

export const findSteeringExecutionViolations = (input: SteeringEvidenceInput): string[] => {
  const { events, runId, receivedSeq } = input;
  const violations: string[] = [];

  const starts = events.filter((event): event is Extract<ExecutionEvent, { kind: "tool_start" }> =>
    event.kind === "tool_start");
  const ends = events.filter((event): event is Extract<ExecutionEvent, { kind: "tool_end" }> =>
    event.kind === "tool_end");
  const endByToolCallId = new Map(ends.map(end => [end.toolCallId, end]));

  // ① 插话之后执行仍在推进：至少一件工具在 received.seq 之后成对且成功收尾。
  const pairedAfterInterjection = starts.filter(start => {
    const end = endByToolCallId.get(start.toolCallId);
    return end !== undefined && end.ok && end.seq > receivedSeq;
  });
  if (pairedAfterInterjection.length === 0) {
    violations.push(
      `插话之后没有任何工具成对完成（received.seq=${String(receivedSeq)}，`
      + `tool_start=${String(starts.length)} tool_end=${String(ends.length)}）——`
      + "执行没有在插话之后继续推进",
    );
  }

  // ② 没有工具被插话打断：每一个 tool_start 都要有配对的 ok=true tool_end。
  const dangling = starts.filter(start => endByToolCallId.get(start.toolCallId) === undefined);
  if (dangling.length > 0) {
    violations.push(
      `有工具悬空未收尾（无配对 tool_end）：${dangling.map(start => `${start.toolName}#${start.toolCallId}`).join(", ")}`,
    );
  }
  const failedEnds = ends.filter(end => !end.ok);
  if (failedEnds.length > 0) {
    violations.push(
      `有工具以 ok=false 收尾：${failedEnds.map(end => `${end.toolName}#${end.toolCallId}`).join(", ")}`,
    );
  }

  // ③ 全程无取消。
  const cancelled = events.filter(event => event.kind === "status" && event.status === "cancelled");
  if (cancelled.length > 0) {
    violations.push(`出现 status=cancelled 事件 ${String(cancelled.length)} 条——插话取消了这条 run`);
  }

  // ④ 只有一条 run。
  const runIds = [...new Set(events.map(event => event.runId))].sort();
  if (runIds.length !== 1 || runIds[0] !== runId) {
    violations.push(`journal 里的 runId 集合是 [${runIds.join(", ")}]，期望恰为 [${runId}]——插话另起了 run`);
  }

  return violations;
};
