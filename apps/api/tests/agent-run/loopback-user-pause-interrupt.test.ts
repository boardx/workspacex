import { expect, it } from "vitest";
import { fixture } from "./loopback-deep-agent-fixture";

/**
 * issue #3303 —— 回环替身必须会说 `user_pause` 这门方言。
 *
 * ## 它证什么，不证什么
 *
 * 不证产品行为（那是 `apps/web/e2e/chat-path-f3-pause-resume-retry-step.spec.ts` 的事，
 * 跑在真栈上）。它证的是那条 spec 的**被测状态真的可达**：`paused_at` 的唯一写入路径是
 * 「内核在模型边界抛 `user_pause` → provider 认出 → `pauseAtCheckpoint` 落库」
 * （`pause-plan-run.ts` 头注逐字），而替身此前 `interjection` / `user_pause` /
 * `pauseRequested` 三个词一次都没出现 ⇒ 这条车道上根本没有写入路径 ⇒ F3 的①②两条业务
 * 判据结构上不可能变绿，也不可能证伪任何产品行为。
 *
 * ## 方言取证（逐条对齐真实上游的源码，不是照 spec 文字推断）
 *
 * 见替身里 `RunControlCallback` 的头注：请求形状照
 * `deep_agent_service/run_control.py::_request`，中断值照 `_values`，线程对象的
 * `interrupts` 形状照 `langgraph_runtime_inmem/ops.py::set_joint_status` +
 * `langgraph_api/state.py::patch_interrupt`（本仓 uv.lock 锁的 0.32.4 / 0.12.4，
 * `.venv` 里的同一份源码），run 自己报 `success` 照 `readRunStatus` 头注记的真栈实测。
 *
 * 下面第一条用例把**请求字节**逐字段钉住——替身的方言一旦漂移，这里当场红。
 *
 * ## 反证也在本文件里（本仓纪律：没有反证的门视为未落地）
 *
 * 第二条：不请求暂停时**不许**出现 `user_pause`，run 照常跑到终态。
 * 第三条：把回读那一步够不到（不下发运行控制回调 = 本 issue 之前的状态），
 * 即使 TS 侧已经 `pauseRequested: true`，中断也不出现 —— 这正是 F3 此前红的形状。
 */

const TRIGGER = "multistep";
const CALLBACK = {
  base_url: "http://api.invalid/",
  key: "test-internal-key",
  org_id: "org-1",
  run_id: "run/with slash",
};

interface PollRequest { url: string; method: string; headers: Record<string, string>; body: unknown }

/** 记录型 fetch 替身：只答运行控制回读，别的 URL 一律露馅（替身不该发别的请求）。 */
function pollingFetch(pauseRequested: () => boolean) {
  const seen: PollRequest[] = [];
  const impl = (async (input: unknown, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    seen.push({
      url: String(input), method: init.method ?? "GET",
      headers: init.headers ?? {}, body: JSON.parse(init.body ?? "null"),
    });
    return {
      ok: true, status: 200,
      json: async () => ({ interjections: [], cancelRequested: false, pauseRequested: pauseRequested() }),
    };
  }) as unknown as typeof globalThis.fetch;
  return { impl, seen };
}

async function startRun(request: ReturnType<typeof fixture>, configurable: Record<string, unknown>): Promise<string> {
  const { thread_id: threadId } = await request("POST", "/threads", {});
  await request("POST", `/threads/${threadId}/runs`, {
    input: { messages: [{ role: "user", content: TRIGGER }] },
    config: { configurable },
  });
  return threadId;
}

const ENV = { LOOPBACK_DEEP_AGENT_MULTISTEP_MIN_POLLS: "8", LOOPBACK_DEEP_AGENT_STREAM_GAP_MS: "1" };

it("请求暂停之后，替身在下一个模型边界真的抛出 `user_pause`——线程翻 interrupted，run 报 success", async () => {
  let pauseRequested = false;
  const { impl, seen } = pollingFetch(() => pauseRequested);
  const request = fixture(ENV, impl);
  const threadId = await startRun(request, { run_control_callback: CALLBACK });

  // ── 没请求暂停时：回读发生了，但不抛中断 ──────────────────────────────────
  expect((await request("GET", `/threads/${threadId}/runs/${threadId}`)).status).toBe("pending");
  expect(seen.length, "每个模型边界都必须真的回读一次——一次都没发就说明这条通路没接上").toBe(1);

  /*
   * 请求字节逐字段钉住（`run_control.py::_request`）：
   *   POST <base_url 去掉尾斜杠>/internal/agent-runs/<quote(run_id, safe="")>/interjections/poll
   *   headers: x-deep-agent-internal-key: <key>
   *   body:    {orgId, acknowledgedIds}
   * `run_id` 特意带一个 `/` 和一个空格——真实内核用的是 `quote(run_id, safe="")`，
   * 不转义的话这个请求会打到一条完全不同的路由上，而那种漂移正是本仓栽过的
   * 「替身的方言 ≠ 上游的方言」。
   */
  expect(seen[0]).toEqual({
    url: "http://api.invalid/internal/agent-runs/run%2Fwith%20slash/interjections/poll",
    method: "POST",
    headers: { "content-type": "application/json", "x-deep-agent-internal-key": "test-internal-key" },
    body: { orgId: "org-1", acknowledgedIds: [] },
  });

  const idle = await request("GET", `/threads/${threadId}`);
  expect(idle.status, "还没请求暂停，线程不许报 interrupted").toBe("idle");
  expect(idle.interrupts, "还没请求暂停，interrupts 必须是空的").toEqual({});

  // ── 用户点了暂停：TS 侧 `pauseRequested` 翻真 ─────────────────────────────
  pauseRequested = true;

  const status = await request("GET", `/threads/${threadId}/runs/${threadId}`);
  expect(status.status, "issue #2842 真栈实测：停在中断上的 run 自己报的是 success").toBe("success");

  const paused = await request("GET", `/threads/${threadId}`);
  expect(paused.status).toBe("interrupted");
  const tasks = Object.values(paused.interrupts as Record<string, { value: unknown }[]>);
  expect(tasks.length, "`interrupts` 是 {task_id: [中断]} —— 至少一个 task").toBe(1);
  expect(tasks[0]![0]!.value, "中断值逐字照 `run_control.py::_values` 的 interrupt({\"kind\": \"user_pause\"})")
    .toEqual({ kind: "user_pause" });

  // ── 恢复：`Command(resume=True)` 消费掉中断，run 真的接着跑到终态 ────────────
  pauseRequested = false;
  await request("POST", `/threads/${threadId}/runs`, { command: { resume: true } });
  const resumed = await request("GET", `/threads/${threadId}`);
  expect(resumed.status, "恢复之后线程不许还停在 interrupted").toBe("idle");
  expect(resumed.interrupts).toEqual({});

  let last = "pending";
  for (let poll = 0; poll < 40 && last === "pending"; poll += 1) {
    last = (await request("GET", `/threads/${threadId}/runs/${threadId}`)).status as string;
  }
  expect(last, "恢复不是把标志位清掉就算数——这条 run 必须真的跑到终态").toBe("success");
});

it("反证①：不请求暂停时不许出现 `user_pause`，run 照常跑到终态", async () => {
  const { impl, seen } = pollingFetch(() => false);
  const request = fixture(ENV, impl);
  const threadId = await startRun(request, { run_control_callback: CALLBACK });

  let last = "pending";
  for (let poll = 0; poll < 40 && last === "pending"; poll += 1) {
    last = (await request("GET", `/threads/${threadId}/runs/${threadId}`)).status as string;
  }
  expect(last).toBe("success");
  expect(seen.length, "边界回读必须真的发生过——否则本用例的绿什么都不说明").toBeGreaterThan(1);

  const thread = await request("GET", `/threads/${threadId}`);
  expect(thread.status, "没人请求暂停，线程恒不 interrupted").toBe("idle");
  expect(thread.interrupts, "没人请求暂停，绝不许凭空长出一个 user_pause").toEqual({});
});

it("反证②：够不到回读通路时（= 本 issue 之前的替身），TS 侧已请求暂停也照样不停", async () => {
  const { impl, seen } = pollingFetch(() => true);
  const request = fixture(ENV, impl);
  // ⚠ 唯一的差别：不下发 `run_control_callback`。真实 `run_control.py::_request`
  //   在这种配置下返回 `None`（一次请求都不发、永不中断）——替身照同一条判据。
  const threadId = await startRun(request, {});

  let last = "pending";
  for (let poll = 0; poll < 40 && last === "pending"; poll += 1) {
    last = (await request("GET", `/threads/${threadId}/runs/${threadId}`)).status as string;
  }
  expect(seen.length, "没有回调配置就一次请求都不许发").toBe(0);
  expect(last, "够不到通路 ⇒ 暂停请求形同虚设，run 一路跑完 —— 这正是 F3 此前红的那个形状").toBe("success");
  expect((await request("GET", `/threads/${threadId}`)).interrupts).toEqual({});
});
