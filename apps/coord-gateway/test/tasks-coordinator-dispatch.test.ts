// coordinator 层 token 派工面（#480，真 workerd）：
//   POST /tasks 与 /tasks/:id/recall 的鉴权从「仅 COORD_ADMIN_TOKEN」放宽为
//   「admin token **或** Directory 里 kind ∈ 协调层 的 scoped token」，并且
//   coordinator 只能派**本人 areas 覆盖得到**的 issue（判据是 Directory 的权威
//   记录 + 本仓 mirror 的 module:* 标签，不是请求里自证的字段）。
//
// ⚠ 这是鉴权面放宽，本文件的一半是**反证**：放开一个门必须证明其余门没被一起放开。
//   反证清单（修复前每一条都是红的，见 PR 正文的 before/after 输出）：
//     ① worker scoped token 派工仍 401；
//     ② coordinator 派**本域外**（含未镜像）的 issue → 403 issue_out_of_areas；
//     ③ 伪造 token 403 / 吊销 token 401（auth.ts 文件头矩阵，不在本 issue 里改）；
//     ④ /tasks/import（割接导入）仍是 admin 独占面；
//     ⑤ GET /tasks?assignee=* 只对 coordinator 层开，worker 仍 inbox_is_private；
//     ⑥ paused/retired 的 coordinator 不能派工；
//     ⑦ created_by 自证他人 → 403 token_agent_mismatch（审计链不可伪造）。
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const REPO = "boardx/workspacex";
const API = (sub: string) => `https://gw.test/api/coord/repos/${REPO}${sub}`;
const DIR = (sub: string) => `https://gw.test/api/coord/directory${sub}`;
const ADMIN = { authorization: "Bearer test-admin-token", "content-type": "application/json" };
const OPS = { authorization: "Bearer test-api-token", "content-type": "application/json" };

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

interface Task {
  id: number; issue: number; assignee: string; status: string; created_by: string;
}

// 吸收 vitest-pool-workers singleWorker 跨文件 transform 造成的一次性 DO 失效（同 tasks.test.ts）
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const r = await SELF.fetch(API("/claims"), { headers: { authorization: "Bearer test-api-token" } }).catch(() => null);
    if (r?.ok) break;
  }
  for (let i = 0; i < 2; i++) {
    const r = await SELF.fetch(DIR("/agents"), { headers: { authorization: "Bearer test-api-token" } }).catch(() => null);
    if (r?.ok) break;
  }
  // Directory 的 owner 锚点：所有测试 agent 挂在同一个 engineer 下
  await SELF.fetch(DIR("/engineers"), {
    method: "POST", headers: ADMIN,
    body: JSON.stringify({ handle: "disp-eng", github_login: "disp-eng-gh" }),
  });
});

/** 在 Directory 登记一个 agent（权威记录：kind + areas），返回其 agent_id。 */
async function enroll(name: string, kind: string, areas: string[]): Promise<string> {
  const r = await SELF.fetch(DIR("/agents"), {
    method: "POST", headers: ADMIN,
    body: JSON.stringify({ owner: "@disp-eng", name, kind, areas }),
  });
  expect(r.status, `enroll ${name}`).toBe(201);
  return ((await r.json<{ agent: { agent_id: string } }>()).agent).agent_id;
}

/** 给 agent 发一把本仓 scoped token（enrollment 的凭据形态）。 */
async function mint(agentId: string): Promise<string> {
  const r = await SELF.fetch(API("/tokens/mint"), {
    method: "POST", headers: ADMIN,
    body: JSON.stringify({ agent_id: agentId, owner: "usam.shen@gmail.com" }),
  });
  expect(r.status).toBe(201);
  return (await r.json<{ token: string }>()).token;
}

/** Directory 登记 + 发 token 的组合（派工方的完整身份）。 */
async function coordinator(name: string, kind: string, areas: string[]): Promise<{ agentId: string; token: string }> {
  const agentId = await enroll(name, kind, areas);
  return { agentId, token: await mint(agentId) };
}

/** 本仓 mirror 里的 issue（module:* 标签是「这条 issue 属于哪个域」的权威落点）。 */
async function mirrorIssue(number: number, labels: string[]): Promise<void> {
  const r = await SELF.fetch(API("/mirror/upsert"), {
    method: "POST", headers: ADMIN,
    body: JSON.stringify({
      kind: "issue",
      data: { number, state: "open", title: `#480 测试 issue ${number}`, labels, assignees: [] },
    }),
  });
  expect(r.status).toBe(200);
}

function dispatch(token: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(API("/tasks"), { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
}

async function errorOf(res: Response): Promise<unknown> {
  return (await res.json<Record<string, unknown>>())["error"];
}

describe("#480 coordinator 层 token 可以派工（不再只有 COORD_ADMIN_TOKEN）", () => {
  it("module-coordinator 派本域 issue → 201，且 created_by = token 身份（审计链记录真实决策者）", async () => {
    await mirrorIssue(48010, ["status:ready-for-dev", "module:chat"]);
    const c = await coordinator("coord-chat-e2e", "module-coordinator", ["chat", "e2e"]);

    const r = await dispatch(c.token, { issue: 48010, assignee: "wrk-480-a", note: "本域派工" });
    expect(r.status).toBe(201);
    const task = (await r.json<{ task: Task }>()).task;
    expect(task).toMatchObject({ issue: 48010, assignee: "wrk-480-a", status: "pending" });
    // 审计链：不是 "admin"、不是 coord-main，而是真实派工方的 Directory agent_id
    expect(task.created_by).toBe(c.agentId);
  });

  it("architecture-coordinator 与 areas=['*'] 的 coordinator 同样可派工（全仓授权）", async () => {
    await mirrorIssue(48011, ["module:agent-protocol"]);
    const arch = await coordinator("coord-architecture", "architecture-coordinator", ["harness", "agent-protocol"]);
    expect((await dispatch(arch.token, { issue: 48011, assignee: "wrk-480-b" })).status).toBe(201);

    // areas=["*"]（coord-main）：不需要 module 标签匹配也能派
    await mirrorIssue(48012, []);
    const main = await coordinator("coord-main", "coordinator", ["*"]);
    expect((await dispatch(main.token, { issue: 48012, assignee: "wrk-480-c" })).status).toBe(201);
  });

  it("coordinator 可 recall 本域任务；admin token 派工/撤回路径完全不变", async () => {
    await mirrorIssue(48013, ["module:chat"]);
    const c = await coordinator("coord-chat-recall", "module-coordinator", ["chat"]);
    const task = (await (await dispatch(c.token, { issue: 48013, assignee: "wrk-480-d" })).json<{ task: Task }>()).task;

    const recalled = await SELF.fetch(API(`/tasks/${task.id}/recall`), { method: "POST", headers: bearer(c.token) });
    expect(recalled.status).toBe(200);
    expect((await recalled.json<{ task: Task }>()).task.status).toBe("recalled");

    // admin 面回归：既有 devportal broker 通道零变更
    const adminTask = await SELF.fetch(API("/tasks"), {
      method: "POST", headers: ADMIN,
      body: JSON.stringify({ issue: 48013, assignee: "wrk-480-e", created_by: "devportal-broker" }),
    });
    expect(adminTask.status).toBe(201);
    expect((await adminTask.json<{ task: Task }>()).task.created_by).toBe("devportal-broker");
  });

  it("GET /tasks?assignee=* 对 coordinator 层开放（列全队收件箱）", async () => {
    await mirrorIssue(48014, ["module:chat"]);
    const c = await coordinator("coord-chat-inbox", "module-coordinator", ["chat"]);
    await dispatch(c.token, { issue: 48014, assignee: "wrk-480-f" });

    const all = await SELF.fetch(API("/tasks?assignee=*"), { headers: bearer(c.token) });
    expect(all.status).toBe(200);
    const { tasks } = await all.json<{ tasks: Task[] }>();
    expect(tasks.some((t) => t.assignee === "wrk-480-f")).toBe(true);
    // 查指定他人收件箱同理放行（协调层语义）
    expect((await SELF.fetch(API("/tasks?assignee=wrk-480-f"), { headers: bearer(c.token) })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 反证：以下每一条都必须仍然失败——放开一个门不等于放开其余门
// ---------------------------------------------------------------------------

describe("#480 反证：其余门没有被一起放宽", () => {
  it("反证①：worker scoped token 派工仍 401（派工是协调层权力）", async () => {
    await mirrorIssue(48020, ["module:chat"]);
    const w = await coordinator("dev-chat-e2e", "worker", ["chat"]);
    const r = await dispatch(w.token, { issue: 48020, assignee: "wrk-480-x" });
    expect(r.status).toBe(401);
    // reviewer 同样不是派工方
    const rev = await coordinator("rev-feature", "reviewer", ["chat"]);
    expect((await dispatch(rev.token, { issue: 48020, assignee: "wrk-480-x" })).status).toBe(401);
  });

  it("反证①b：worker scoped token 撤回他人任务仍 401", async () => {
    await mirrorIssue(48021, ["module:chat"]);
    const c = await coordinator("coord-chat-cp1", "module-coordinator", ["chat"]);
    const task = (await (await dispatch(c.token, { issue: 48021, assignee: "wrk-480-y" })).json<{ task: Task }>()).task;
    const w = await coordinator("dev-chat-cp1", "worker", ["chat"]);
    const r = await SELF.fetch(API(`/tasks/${task.id}/recall`), { method: "POST", headers: bearer(w.token) });
    expect(r.status).toBe(401);
  });

  it("反证②：coordinator 派**本域外**的 issue → 403 issue_out_of_areas", async () => {
    await mirrorIssue(48022, ["module:canvas"]);
    const c = await coordinator("coord-agent-auth", "module-coordinator", ["agent-auth"]);
    const r = await dispatch(c.token, { issue: 48022, assignee: "wrk-480-z" });
    expect(r.status).toBe(403);
    expect(await errorOf(r)).toBe("issue_out_of_areas");
  });

  it("反证②b：未镜像 / 无 module 标签的 issue 对非 '*' coordinator 一律拒（fail-closed）", async () => {
    const c = await coordinator("coord-chat-fc", "module-coordinator", ["chat"]);
    // 从未镜像过的 issue 号：判据取不到 → 不放行
    const unmirrored = await dispatch(c.token, { issue: 489999, assignee: "wrk-480-u" });
    expect(unmirrored.status).toBe(403);
    expect(await errorOf(unmirrored)).toBe("issue_out_of_areas");
    // 镜像了但没有任何 module:* 标签 → 同样取不到归属判据 → 拒
    await mirrorIssue(48023, ["status:ready-for-dev"]);
    const unlabeled = await dispatch(c.token, { issue: 48023, assignee: "wrk-480-u" });
    expect(unlabeled.status).toBe(403);
    expect(await errorOf(unlabeled)).toBe("issue_out_of_areas");
  });

  it("反证②c：coordinator 撤回**本域外**任务 → 403 issue_out_of_areas", async () => {
    await mirrorIssue(48024, ["module:canvas"]);
    const canvas = await coordinator("coord-canvas", "module-coordinator", ["canvas"]);
    const task = (await (await dispatch(canvas.token, { issue: 48024, assignee: "wrk-480-w" })).json<{ task: Task }>()).task;

    const auth = await coordinator("coord-agent-auth-r", "module-coordinator", ["agent-auth"]);
    const r = await SELF.fetch(API(`/tasks/${task.id}/recall`), { method: "POST", headers: bearer(auth.token) });
    expect(r.status).toBe(403);
    expect(await errorOf(r)).toBe("issue_out_of_areas");
  });

  it("反证③：伪造 token 403 / 吊销 token 401（auth.ts 矩阵原样保留）", async () => {
    await mirrorIssue(48025, ["module:chat"]);
    const body = { issue: 48025, assignee: "wrk-480-v" };
    const forged = await dispatch("coordtk_not-a-real-token", body);
    expect(forged.status).toBe(403);
    expect(await errorOf(forged)).toBe("token_not_valid_for_repo");

    const c = await coordinator("coord-chat-revoked", "module-coordinator", ["chat"]);
    // 先确认这把 token 在吊销前是能派工的（否则 403/401 证明不了是吊销起的作用）
    expect((await dispatch(c.token, body)).status).toBe(201);
    const revoke = await SELF.fetch(API("/tokens/revoke"), {
      method: "POST", headers: ADMIN,
      body: JSON.stringify({ token_hash: await sha256Hex(c.token) }),
    });
    expect(revoke.status).toBe(200);
    const after = await dispatch(c.token, body);
    expect(after.status).toBe(401);
    expect(await errorOf(after)).toBe("token_revoked");
  });

  it("反证④：/tasks/import（割接导入）仍是 admin 独占面——coordinator token 401", async () => {
    const c = await coordinator("coord-chat-import", "module-coordinator", ["chat"]);
    const r = await SELF.fetch(API("/tasks/import"), {
      method: "POST", headers: bearer(c.token), body: JSON.stringify({ tasks: [] }),
    });
    expect(r.status).toBe(401);
  });

  it("反证⑤：worker 的 GET /tasks?assignee=* 仍 403 inbox_is_private（收件箱语义对 worker 是对的）", async () => {
    const w = await coordinator("dev-chat-inbox", "worker", ["chat"]);
    const star = await SELF.fetch(API("/tasks?assignee=*"), { headers: bearer(w.token) });
    expect(star.status).toBe(403);
    expect(await errorOf(star)).toBe("inbox_is_private");
    const other = await SELF.fetch(API("/tasks?assignee=wrk-480-f"), { headers: bearer(w.token) });
    expect(other.status).toBe(403);
    expect(await errorOf(other)).toBe("inbox_is_private");
    // 自己的收件箱照常可读
    expect((await SELF.fetch(API("/tasks"), { headers: bearer(w.token) })).status).toBe(200);
  });

  it("反证⑥：paused / retired 的 coordinator 不能派工（lifecycle 也是权威记录的一部分）", async () => {
    await mirrorIssue(48026, ["module:chat"]);
    const c = await coordinator("coord-chat-paused", "module-coordinator", ["chat"]);
    expect((await dispatch(c.token, { issue: 48026, assignee: "wrk-480-p" })).status).toBe(201);

    const pause = await SELF.fetch(DIR(`/agents/${c.agentId}/lifecycle`), {
      method: "POST", headers: ADMIN, body: JSON.stringify({ action: "pause" }),
    });
    expect(pause.status).toBe(200);
    expect((await dispatch(c.token, { issue: 48026, assignee: "wrk-480-p" })).status).toBe(401);
  });

  it("反证⑦：created_by 自证他人 → 403 token_agent_mismatch（审计链不可伪造）", async () => {
    await mirrorIssue(48027, ["module:chat"]);
    const c = await coordinator("coord-chat-forge", "module-coordinator", ["chat"]);
    const r = await dispatch(c.token, { issue: 48027, assignee: "wrk-480-q", created_by: "coord-main" });
    expect(r.status).toBe(403);
    expect(await errorOf(r)).toBe("token_agent_mismatch");
  });

  it("反证⑧：Directory 里查无此 agent 的 scoped token 不能派工（token 有效 ≠ 有派工资格）", async () => {
    await mirrorIssue(48028, ["module:chat"]);
    // 直接 mint 一把 token，但从不在 Directory 登记这个 agent_id
    const token = await mint("agt_01NOTINDIRECTORY480");
    const r = await dispatch(token, { issue: 48028, assignee: "wrk-480-n" });
    expect(r.status).toBe(401);
  });

  it("反证⑨：ops 万能钥匙（COORD_API_TOKEN）仍不是派工方——401 不变", async () => {
    await mirrorIssue(48029, ["module:chat"]);
    const r = await SELF.fetch(API("/tasks"), {
      method: "POST", headers: OPS, body: JSON.stringify({ issue: 48029, assignee: "wrk-480-o" }),
    });
    expect(r.status).toBe(401);
  });

  it("反证⑩：缺 COORD_ADMIN_TOKEN 配置时 admin 面仍 fail-closed 503（放宽没有变成 fail-open）", async () => {
    const { env } = await import("cloudflare:test");
    const worker = (await import("../src/index")).default;
    const req = new Request(API("/tasks"), {
      method: "POST", headers: ADMIN, body: JSON.stringify({ issue: 48029, assignee: "x" }),
    });
    expect((await worker.fetch(req, { ...env, COORD_ADMIN_TOKEN: undefined })).status).toBe(503);
  });
});

// 测试内联的 sha256（吊销反证要拿 token 明文算 hash；生产路径在 src/auth.ts）
async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
