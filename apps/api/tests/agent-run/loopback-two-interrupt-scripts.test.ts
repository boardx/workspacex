import { describe, expect, it } from "vitest";
import { fixture } from "./loopback-deep-agent-fixture";

/**
 * 路径矩阵 B1/B4/B5/B6 —— **二次中断 / 二次授权**这两条新剧本的本地取证。
 *
 * ## 这个文件在证什么，不证什么
 *
 * 它**不证**产品行为（那是 `apps/web/e2e/chat-path-ab-hitl-continuity.spec.ts` 的事，
 * 跑在真栈上）。它证的是那条 spec 的**被测状态真的可达**：
 *
 * > 人类 2026-09-10 报的三个 HITL 缺陷（#3186 / #3207 / #3244 ①）全长在「一条 run
 * > 中断两次」这个形状上；而在这两条剧本落地之前，替身里**每一个**中断剧本都由
 * > `record.decision === null` 把关——裁决一到就再也不中断。那个形状在 e2e 上不可达，
 * > 于是 B 组现有 spec 全绿却一个都没抓住。
 *
 * 「断言写得对但被测状态不可达」是本仓的惯犯（#3000 那批 A 类根因、C5 连红三跑）。
 * 所以新剧本落地的同时必须有一处**当场跑得动**的取证，证明它真的产出两个不同身份的
 * 待决请求、hold 窗口真的存在、且**有界**——而不是等三十分钟的真栈跑完才知道。
 *
 * ## 反证也在这个文件里（本仓纪律：没有反证的门视为未落地）
 *
 * · 触发词未设置时逐字节回落到既有行为（`不设触发词` 那一条）——这是「新增分支不改变
 *   默认行为」的反证；
 * · hold 旋钮置 0 时窗口当场消失（`hold 置 0` 那一条）——这是「那个旋钮是承重的」的反证。
 *   若它是空操作，e2e 里那段「提交后旧卡片不得重现」的断言就是在测一个宽度为 0 的窗口
 *   （F3 那条「974ms 窗口 vs 3000ms 轮询」的同形失效）。
 */

const TWO_INTERRUPT = "两次中断触发词";
const TWO_APPROVAL = "两次授权触发词";

type Message = {
  type: string;
  content?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string; args: Record<string, unknown> }[];
};

/**
 * 「此刻有几个待决请求」——**未配对的 tool_call**，与替身各剧本头注、以及产品侧
 * `readPendingApproval` 用的是同一个信号。不在这里另发明一种判据。
 */
function pendingCalls(messages: Message[]): { id: string; name: string; args: Record<string, unknown> }[] {
  const answered = new Set(messages.filter((m) => m.type === "tool").map((m) => m.tool_call_id));
  return messages.flatMap((m) => m.tool_calls ?? []).filter((call) => !answered.has(call.id));
}

async function startRun(request: ReturnType<typeof fixture>, text: string) {
  const { thread_id: threadId } = await request("POST", "/threads", {});
  await request("POST", `/threads/${threadId}/runs`, { input: { messages: [{ role: "user", content: text }] } });
  return threadId;
}

const approve = { command: { resume: { decisions: [{ type: "approve" }] } } };

describe("二次中断剧本（路径矩阵 B1/B6，issue #3244 ①）", () => {
  it("同一条 run 上先后放出两个**不同身份**的待决请求，中间有一段真实的无待决窗口，且有界地落终态", async () => {
    const request = fixture({
      LOOPBACK_DEEP_AGENT_TWO_INTERRUPT_TRIGGER: TWO_INTERRUPT,
      LOOPBACK_DEEP_AGENT_TWO_INTERRUPT_HOLD_POLLS: "3",
    });
    const threadId = await startRun(request, TWO_INTERRUPT);

    // ① 第一次中断：状态是 interrupted，state 里恰有一个未配对的 confirm_task_intent。
    expect((await request("GET", `/threads/${threadId}/runs/${threadId}`)).status).toBe("interrupted");
    const first = pendingCalls((await request("GET", `/threads/${threadId}/state`)).values.messages);
    expect(first).toHaveLength(1);
    expect(first[0]!.name).toBe("confirm_task_intent");

    // ② 第一次裁决之后的 hold 窗口：run 普通地在跑，**一个待决请求都没有**。
    //    e2e 里「提交过的确认卡片不得重现」正是在这个窗口里判的——窗口宽度由构造保证。
    await request("POST", `/threads/${threadId}/runs`, approve);
    const duringHold = await request("GET", `/threads/${threadId}/runs/${threadId}`);
    expect(duringHold.status, "hold 窗口内 run 必须是普通的 pending：既不是 interrupted 也不是终态").toBe("pending");
    expect(
      pendingCalls((await request("GET", `/threads/${threadId}/state`)).values.messages),
      "hold 窗口内不得存在任何未配对的 tool_call —— 权威读的 pendingApproval 因此为 null",
    ).toHaveLength(0);

    // ③ 熬过 hold：第二次中断到来。同一条 run、**另一个** tool_call id、另一个工具。
    /*
     * ⚠ 这一句是**反证逼出来的**：本条最初只读 `/state`，于是把「状态端点仍报 interrupted」
     * 这半漏掉了。反证 CP-1（把二次中断退化成只中断一次）当时**全绿**——因为状态退化了、
     * state 里那个未配对调用还在。而产品侧真正据以把 run 落成 `awaiting_tool_permission`
     * 的正是这个状态端点：漏掉它，本条就成了一道拦不住退化的门。
     */
    let secondStatus = "";
    for (let i = 0; i < 4; i += 1) {
      secondStatus = (await request("GET", `/threads/${threadId}/runs/${threadId}`)).status;
    }
    expect(secondStatus, "第二次中断必须由**状态端点**如实报出——产品据它把 run 落成 awaiting_tool_permission")
      .toBe("interrupted");
    const second = pendingCalls((await request("GET", `/threads/${threadId}/state`)).values.messages);
    expect(second).toHaveLength(1);
    expect(second[0]!.name).toBe("fill_run_params");
    expect(second[0]!.id, "第二次中断必须是一个新的 tool_call —— 服务端据此生成新的 permissionRequestId")
      .not.toBe(first[0]!.id);

    // ④ 有界：第二次裁决之后必落终态。「一直不终态」与「卡住了」在界面上分不开，
    //    那种替身会让「用户被锁死」这条判据不可证伪。
    await request("POST", `/threads/${threadId}/runs`, approve);
    expect((await request("GET", `/threads/${threadId}/runs/${threadId}`)).status).toBe("success");
    const final = (await request("GET", `/threads/${threadId}/state`)).values.messages as Message[];
    expect(pendingCalls(final)).toHaveLength(0);
    expect(final.at(-1)!.content).toContain("两次确认都已收到");
  });

  it("【反证】hold 置 0 时那段无待决窗口当场消失 —— 证明这个旋钮是承重的，不是装饰", async () => {
    const request = fixture({
      LOOPBACK_DEEP_AGENT_TWO_INTERRUPT_TRIGGER: TWO_INTERRUPT,
      LOOPBACK_DEEP_AGENT_TWO_INTERRUPT_HOLD_POLLS: "0",
    });
    const threadId = await startRun(request, TWO_INTERRUPT);
    await request("GET", `/threads/${threadId}/runs/${threadId}`);
    await request("POST", `/threads/${threadId}/runs`, approve);
    const calls = pendingCalls((await request("GET", `/threads/${threadId}/state`)).values.messages);
    expect(calls, "hold=0 时第二个待决请求紧跟着就出现，中间没有任何窗口").toHaveLength(1);
    expect(calls[0]!.name).toBe("fill_run_params");
  });

  it("【反证】不设触发词时，同一句话走到的分支与新增分支落地前一致（普通剧本、只中断 0 次）", async () => {
    const request = fixture({});
    const threadId = await startRun(request, TWO_INTERRUPT);
    // 既有普通剧本：到达轮询阈值后直接终态，全程没有任何未配对的 tool_call。
    await request("GET", `/threads/${threadId}/runs/${threadId}`);
    expect((await request("GET", `/threads/${threadId}/runs/${threadId}`)).status).toBe("success");
    expect(
      pendingCalls((await request("GET", `/threads/${threadId}/state`)).values.messages),
      "触发词未设置 ⇒ 新增分支的第一项判定就是 undefined !== 用户原文 ⇒ 恒 false",
    ).toHaveLength(0);
  });
});

describe("二次技能授权剧本（路径矩阵 B4，issue #3186 / #3212）", () => {
  it("两次授权请求点名**不同的技能**，身份各不相同，且第二次裁决后有界落终态", async () => {
    const request = fixture({
      LOOPBACK_DEEP_AGENT_TWO_APPROVAL_TRIGGER: TWO_APPROVAL,
      LOOPBACK_DEEP_AGENT_TWO_INTERRUPT_HOLD_POLLS: "3",
    });
    const threadId = await startRun(request, TWO_APPROVAL);

    // 授权剧本要先跨过普通的轮询阈值（与既有 APPROVAL_TRIGGER 同一条次序）。
    let status = "";
    for (let i = 0; i < 5 && status !== "interrupted"; i += 1) {
      status = (await request("GET", `/threads/${threadId}/runs/${threadId}`)).status;
    }
    expect(status).toBe("interrupted");
    const first = pendingCalls((await request("GET", `/threads/${threadId}/state`)).values.messages);
    expect(first).toHaveLength(1);
    expect(first[0]!.args.skill_stable_name).toBe("quarterly-report");

    await request("POST", `/threads/${threadId}/runs`, approve);
    expect(
      (await request("GET", `/threads/${threadId}/runs/${threadId}`)).status,
      "hold 窗口内：第一次授权已生效、第二次请求还没提出",
    ).toBe("pending");

    for (let i = 0; i < 4; i += 1) await request("GET", `/threads/${threadId}/runs/${threadId}`);
    const second = pendingCalls((await request("GET", `/threads/${threadId}/state`)).values.messages);
    expect(second).toHaveLength(1);
    expect(
      second[0]!.args.skill_stable_name,
      "#3212：两次授权点名的技能必须不同 —— 两次逐字相同的话，"
      + "「用户看得出这次问的是哪个技能」这条判据不可证伪",
    ).toBe("persona-canvas");
    expect(second[0]!.id).not.toBe(first[0]!.id);

    await request("POST", `/threads/${threadId}/runs`, approve);
    expect((await request("GET", `/threads/${threadId}/runs/${threadId}`)).status).toBe("success");
    const final = (await request("GET", `/threads/${threadId}/state`)).values.messages as Message[];
    expect(pendingCalls(final)).toHaveLength(0);
    expect(final.at(-1)!.content).toContain("两次技能授权都已收到");
  });
});
