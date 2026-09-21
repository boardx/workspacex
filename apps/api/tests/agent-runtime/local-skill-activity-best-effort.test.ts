/**
 * 2026-09-22 —— 本地版把「技能溯源投递失败」从 fail-closed 放宽成 best-effort。
 *
 * 取证起点不是推理：用户那台机器 `~/Library/Application Support/WorkspaceX/local/logs/api.log`
 * 里**全部两条** run 失败都是 `skill_activity_delivery_unavailable`。图还在跑、答案还在
 * 生成，却因为一条展示/溯源事实没送到而整轮判失败。
 *
 * 这份测试的四个 mode 与 `workbench-skill-activity.test.ts` 里那条 fail-closed 测试
 * **逐字对应**（同一组上游故障形状）：同一个故障，云端仍然判失败（那条测试在管），
 * 本地版必须拿到终稿 + 恰好一条缺页标记。
 */
import { afterEach, expect, it, vi } from "vitest";
import { SKILL_ACTIVITY_GAP_NOTE, skillActivityDeliveryDiscipline } from "@repo/contracts/deployment";
import { DeepAgentModelProvider } from "../../src/infrastructure/agent-run/deep-agent-model-provider";

afterEach(() => vi.unstubAllGlobals());

const ANSWER = "本地版的回答，不该因为一条溯源事实没送到就丢掉";

function stubUpstream(mode: "unavailable" | "wrong-content-type" | "incomplete" | "broken"): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/stream")) {
      if (mode === "unavailable") return new Response("", { status: 503 });
      if (mode === "wrong-content-type") return Response.json({ ok: true });
      if (mode === "broken") {
        return new Response(new ReadableStream({ start(c) { c.error(new Error("broken")); } }),
          { headers: { "content-type": "text/event-stream" } });
      }
      return new Response('event: custom\ndata: {"type":"skill_activity"',
        { headers: { "content-type": "text/event-stream" } });
    }
    if (init?.method === "POST" && url.endsWith("/runs")) return Response.json({ run_id: "remote" });
    if (url.endsWith("/state")) return Response.json({ values: { messages: [{ type: "ai", id: "final", content: ANSWER }] } });
    return Response.json({ thread_id: "thread", status: "success" });
  }));
}

const localProvider = () => new DeepAgentModelProvider({
  baseUrl: "http://kernel.invalid", streamEnabled: false, timeoutMs: 1000, pollIntervalMs: 1,
  skillActivityDelivery: skillActivityDeliveryDiscipline("local"),
});

for (const mode of ["unavailable", "wrong-content-type", "incomplete", "broken"] as const) {
  it(`local edition keeps the answer and records the provenance gap: ${mode}`, async () => {
    stubUpstream(mode);
    const gaps: string[] = [];
    const out = await localProvider().complete({
      modelProvider: "deep-agent", modelId: "test", system: "", user: "hi",
      onSkillActivity: async () => {},
      onSkillActivityGap: async (note) => { gaps.push(note); },
    });
    expect(out.text).toContain(ANSWER);
    // 恰好一条：既不能静默（0 条），也不能每帧刷一条把账本刷成噪音
    expect(gaps).toEqual([SKILL_ACTIVITY_GAP_NOTE]);
  });
}

it("cloud edition is untouched: the same upstream failure still fails the run", async () => {
  stubUpstream("unavailable");
  // 反证：把纪律换回 cloud（也等价于字段缺席），同一个故障必须照旧判失败——
  // 否则本次改动就不是「本地版降级」，而是把线上的账本纪律一起放掉了。
  for (const config of [
    { skillActivityDelivery: skillActivityDeliveryDiscipline("cloud") },
    {},
  ]) {
    const provider = new DeepAgentModelProvider({
      baseUrl: "http://kernel.invalid", streamEnabled: false, timeoutMs: 1000, pollIntervalMs: 1, ...config,
    });
    await expect(provider.complete({
      modelProvider: "deep-agent", modelId: "test", system: "", user: "hi",
      onSkillActivity: async () => {}, onSkillActivityGap: async () => {},
    })).rejects.toMatchObject({ code: "MODEL_CALL_FAILED", detail: "skill_activity_delivery_unavailable" });
  }
});

it("a failing gap writer still does not fail the run", async () => {
  // 缺页标记本身写不进去时，为它再失败一次正好是本次要治的病。
  stubUpstream("broken");
  const out = await localProvider().complete({
    modelProvider: "deep-agent", modelId: "test", system: "", user: "hi",
    onSkillActivity: async () => {},
    onSkillActivityGap: async () => { throw new Error("journal_append_failed"); },
  });
  expect(out.text).toContain(ANSWER);
});
