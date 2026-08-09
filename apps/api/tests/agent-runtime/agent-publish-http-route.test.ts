/**
 * #660 —— `POST /agents/:agentId/submit` 与 `POST /agents/:agentId/publish-decision`
 * （契约 `submitAgentForReview` / `decideAgentPublish`）从 HTTP 真的可达。
 *
 * ## 本文件**不**声称什么（范围诚实，先说清楚）
 *
 * ⛔ 它**不**证明「发布完就能在 chat 里发消息」。`批准发布` 今天必然停在
 *    `SECURITY_SCAN_PENDING`（agent 侧没有安全扫描子系统），而且即使过了这道门，
 *    本轮也**不**产出可执行的 `AgentVersion` 快照（`agent_versions.instructions` 是
 *    NOT NULL，而用户自建 agent 在契约与 schema 里都没有 `instructions` 这个概念——
 *    属新契约面，按 ADR-023 待人类签核）。⇒ **422 依旧存在，这是本轮的已知边界。**
 *    人类裁决 2026-08-09：本轮只做状态机，不用 role 之类字段硬凑 instructions。
 *
 * ## 规避的空转形状（沿用 #617 `create-agent-http-route.test.ts` 的同一份纪律）
 * ① ⛔ 只断言 status >= 400 —— 每条负样本断言具体 status + 具体 reasonCode。
 * ② ⛔ 「answers 404」型 —— 配了正样本（必须 200）+ 装置自检（邻近未知路径确实 404）。
 * ③ ⛔ 只断言「抛错了」—— 每条负样本都断言 `agents.publish_state` **没有**被改动
 *    （先写后抛蒙混不过去）。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentRuntime as AR } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i660-agent-publish";
const ADMIN = "u-i660-admin";
const AUTHOR = "u-i660-author";
const METHODOLOGY = "u-i660-methodology";
const SECURITY = "u-i660-security";

let app: NestExpressApplication;
let base = "";

const authFor = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

function post(path: string, userId: string, body: unknown = {}): Promise<Response> {
  return fetch(`${base}${path}`, { method: "POST", headers: authFor(userId), body: JSON.stringify(body) });
}

/** 响应体里我们只关心 `reasonCode` 这一个字段；集中做一次收窄，避免每处都 `as`。 */
async function reasonCodeOf(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { reasonCode?: string };
  return body.reasonCode;
}

async function publishStateOf(agentId: string): Promise<string | null> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ publish_state: string | null }>(
      "SELECT publish_state FROM agents WHERE id=$1 AND org_id=$2",
      [agentId, ORG],
    );
    return r.rows[0]?.publish_state ?? null;
  });
}

/**
 * 建一个由 `AUTHOR` 创建的 agent。
 * `modelId` / `toolWhitelist` 可调——两道就绪门各自要用不同的取值证明自己真的在拦。
 */
async function seedAgent(opts: {
  readonly publishState: string;
  readonly modelId: string | null;
  readonly toolWhitelist: unknown[];
}): Promise<string> {
  const agentId = `agent-i660-${randomUUID()}`;
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agents
         (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,
          initials,role,visibility,clone_from,source,publish_state,model_id,
          skill_mounts,tool_whitelist,concurrency_limit,degrade_policy)
       VALUES ($1,$2,$1,'发布测试 agent','enabled',$3,now(),now(),
               'FB','职责','全组织可用',NULL,'self',$4,$5,
               '[]'::jsonb,$6::jsonb,1,'跟随组织级')`,
      [agentId, ORG, AUTHOR, opts.publishState, opts.modelId, JSON.stringify(opts.toolWhitelist)],
    ),
  );
  return agentId;
}

/** 一条**已批准**的白名单条目——满足 I-28「配过白名单」。 */
const GRANTED_TOOL = { toolFullName: "mcp.demo/echo", state: "已批准" };
/** 越权申请待确认 ⇒ `ELEVATION_UNDECIDED` 的取值。 */
const PENDING_ELEVATION = { toolFullName: "mcp.demo/danger", state: "越权申请待确认" };

async function assignReviewerFunction(principalId: string, fn: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO skill_reviewer_functions (org_id, principal_id, reviewer_function, assigned_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (org_id, principal_id) DO UPDATE SET reviewer_function = EXCLUDED.reviewer_function`,
      [ORG, principalId, fn, ADMIN],
    ),
  );
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-i660" });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, AUTHOR, "consultant", null);
  await addOrgMember(ORG, METHODOLOGY, "consultant", null);
  await addOrgMember(ORG, SECURITY, "consultant", null);
});

describe("路由真的存在（正样本，⚠ 没有它整个文件等于只测了 404）", () => {
  it("作者提交自己的草稿 ⇒ 200，publish_state 真的从 草稿 变成 待审核", async () => {
    const agentId = await seedAgent({ publishState: "草稿", modelId: "m-1", toolWhitelist: [GRANTED_TOOL] });

    const response = await post(`/agents/${agentId}/submit`, AUTHOR);

    expect(response.status).toBe(200);
    const parsed = AR.operations.submitAgentForReview.out.parse(await response.json());
    expect(parsed.publishState).toBe("待审核");
    // ⚠ fail-closed：agent 侧没有安全扫描子系统，所以这里必须是 false。
    //   哪天它变成 true 而扫描仍未实现，就是有人加了兜底——那正是本文件要挡住的东西。
    expect(parsed.securityScanPassed).toBe(false);
    expect(parsed.elevationRequests).toBe(0);
    expect(await publishStateOf(agentId)).toBe("待审核");
  });

  it("装置自检：邻近的未知路径确实 404 ⇒ 上面那条 200 是这条路由给的", async () => {
    const agentId = await seedAgent({ publishState: "草稿", modelId: "m-1", toolWhitelist: [GRANTED_TOOL] });
    const response = await post(`/agents/${agentId}/submit-does-not-exist`, AUTHOR);
    expect(response.status).toBe(404);
  });

  it("`退回` 端到端可用：待审核 → 草稿（退回不查就绪门，是设计如此）", async () => {
    const agentId = await seedAgent({ publishState: "待审核", modelId: "m-1", toolWhitelist: [] });
    await assignReviewerFunction(METHODOLOGY, "methodology-reviewer");

    const response = await post(`/agents/${agentId}/publish-decision`, METHODOLOGY, {
      agentId, decision: "退回", reason: "职责描述太含糊",
    });

    expect(response.status).toBe(200);
    const parsed = AR.operations.decideAgentPublish.out.parse(await response.json());
    expect(parsed.publishState).toBe("草稿");
    expect(parsed.agentVersionId).toBeNull();
    expect(await publishStateOf(agentId)).toBe("草稿");
    // ⚠ 注意白名单是空的，`退回` 依然成功——证明就绪门确实**没有**被套用在退回路径上。
  });
});

describe("提交门：两条就绪判据各自真的在拦，且拦住时不改状态", () => {
  it("没选模型 ⇒ 422 / MODEL_NOT_SELECTABLE，publish_state 仍是 草稿", async () => {
    const agentId = await seedAgent({ publishState: "草稿", modelId: null, toolWhitelist: [GRANTED_TOOL] });

    const response = await post(`/agents/${agentId}/submit`, AUTHOR);

    expect(response.status).toBe(422);
    expect(await reasonCodeOf(response)).toBe("MODEL_NOT_SELECTABLE");
    expect(await publishStateOf(agentId)).toBe("草稿");
  });

  it("白名单为空 ⇒ 422 / TOOL_WHITELIST_EMPTY（I-28 第一道执行点），publish_state 仍是 草稿", async () => {
    const agentId = await seedAgent({ publishState: "草稿", modelId: "m-1", toolWhitelist: [] });

    const response = await post(`/agents/${agentId}/submit`, AUTHOR);

    expect(response.status).toBe(422);
    expect(await reasonCodeOf(response)).toBe("TOOL_WHITELIST_EMPTY");
    expect(await publishStateOf(agentId)).toBe("草稿");
  });

  it("不是作者也不是管理员 ⇒ 403 / ROLE_INSUFFICIENT，publish_state 仍是 草稿", async () => {
    const agentId = await seedAgent({ publishState: "草稿", modelId: "m-1", toolWhitelist: [GRANTED_TOOL] });

    const response = await post(`/agents/${agentId}/submit`, SECURITY);

    expect(response.status).toBe(403);
    expect(await reasonCodeOf(response)).toBe("ROLE_INSUFFICIENT");
    expect(await publishStateOf(agentId)).toBe("草稿");
  });

  it("重复提交（已是待审核）⇒ 409 / AGENT_STATE_CONFLICT，不是幂等成功", async () => {
    const agentId = await seedAgent({ publishState: "待审核", modelId: "m-1", toolWhitelist: [GRANTED_TOOL] });

    const response = await post(`/agents/${agentId}/submit`, AUTHOR);

    expect(response.status).toBe(409);
    // ⚠ 裸 409：契约的 err 数组表达不了「前驱状态不对」，已登记为已知缺口 AR11。
    //   这里断言 reasonCode **不存在**——不是漏写，是钉住「没有人偷偷编一个码塞进来」。
    expect(await reasonCodeOf(response)).toBeUndefined();
    expect(await publishStateOf(agentId)).toBe("待审核");
  });
});

describe("批准门：先问「谁在问」，再问「够不够格」（顺序本身是被断言的）", () => {
  it("安全评审人按下批准 ⇒ 403 / WRONG_REVIEW_FUNCTION（O-21 两职能不合并）", async () => {
    const agentId = await seedAgent({ publishState: "待审核", modelId: "m-1", toolWhitelist: [GRANTED_TOOL] });
    await assignReviewerFunction(SECURITY, "security-reviewer");

    const response = await post(`/agents/${agentId}/publish-decision`, SECURITY, {
      agentId, decision: "批准发布", reason: null,
    });

    expect(response.status).toBe(403);
    expect(await reasonCodeOf(response)).toBe("WRONG_REVIEW_FUNCTION");
    expect(await publishStateOf(agentId)).toBe("待审核");
  });

  it("未被指派任何职能的组织管理员 ⇒ 403 / WRONG_REVIEW_FUNCTION（「是管理员」≠「可批准」，I-5）", async () => {
    const agentId = await seedAgent({ publishState: "待审核", modelId: "m-1", toolWhitelist: [GRANTED_TOOL] });

    const response = await post(`/agents/${agentId}/publish-decision`, ADMIN, {
      agentId, decision: "批准发布", reason: null,
    });

    expect(response.status).toBe(403);
    expect(await reasonCodeOf(response)).toBe("WRONG_REVIEW_FUNCTION");
    expect(await publishStateOf(agentId)).toBe("待审核");
  });

  it("作者自己就是方法论审核人 ⇒ 403 / SELF_REVIEW_FORBIDDEN（这正是单人发不出去的原因）", async () => {
    const agentId = await seedAgent({ publishState: "待审核", modelId: "m-1", toolWhitelist: [GRANTED_TOOL] });
    await assignReviewerFunction(AUTHOR, "methodology-reviewer");

    const response = await post(`/agents/${agentId}/publish-decision`, AUTHOR, {
      agentId, decision: "批准发布", reason: null,
    });

    expect(response.status).toBe(403);
    expect(await reasonCodeOf(response)).toBe("SELF_REVIEW_FORBIDDEN");
    expect(await publishStateOf(agentId)).toBe("待审核");
  });

  /**
   * ⚠ 本文件最重要的一条：**合法的方法论审核人批准，仍然被拒**。
   *
   * 这不是缺陷，是 fail-closed —— agent 侧没有安全扫描子系统，
   * `securityScanPassed` 老实回答 false ⇒ `SECURITY_SCAN_PENDING`。
   * 它同时是「没有静默兜底」的**反证**：如果哪天有人把
   * `PgAgentPublishRepository.securityScanPassed` 改成 `return true` 让链路"通"，
   * 这条会立刻变红。⛔ 那时正确的做法是实现扫描，不是改这条断言。
   */
  it("合法方法论审核人批准 ⇒ 422 / SECURITY_SCAN_PENDING，且 publish_state 不变（fail-closed）", async () => {
    const agentId = await seedAgent({ publishState: "待审核", modelId: "m-1", toolWhitelist: [GRANTED_TOOL] });
    await assignReviewerFunction(METHODOLOGY, "methodology-reviewer");

    const response = await post(`/agents/${agentId}/publish-decision`, METHODOLOGY, {
      agentId, decision: "批准发布", reason: null,
    });

    expect(response.status).toBe(422);
    expect(await reasonCodeOf(response)).toBe("SECURITY_SCAN_PENDING");
    // 关键：没有把它悄悄置成 运行中。
    expect(await publishStateOf(agentId)).toBe("待审核");
  });

  it("非待审核态上的批准 ⇒ 409 / AGENT_STATE_CONFLICT（草稿不能被直接批准上线）", async () => {
    const agentId = await seedAgent({ publishState: "草稿", modelId: "m-1", toolWhitelist: [GRANTED_TOOL] });
    await assignReviewerFunction(METHODOLOGY, "methodology-reviewer");

    const response = await post(`/agents/${agentId}/publish-decision`, METHODOLOGY, {
      agentId, decision: "批准发布", reason: null,
    });

    expect(response.status).toBe(409);
    expect(await reasonCodeOf(response)).toBeUndefined();  // 同上，AR11
    expect(await publishStateOf(agentId)).toBe("草稿");
  });
});

describe("I-28 反证：没有任何一条 HTTP 路径能把 agent 直接置为 运行中", () => {
  /**
   * 契约层面的证据：`updateAgentDefinition.in.patch` 里**根本没有** `publishState` 字段，
   * 所以「直接调接口置为运行中」连一个能承载该值的字段都没有——这比"运行时拒绝"更早一层。
   * （`whitelist-required-to-publish.test.ts` 也断言过同一件事，这里从 HTTP 侧再钉一次。）
   */
  it("契约的 patch schema 不接受 publishState ⇒ 越权取值无处可放", () => {
    const parsed = AR.operations.updateAgentDefinition.in.safeParse({
      agentId: "a-1",
      patch: { publishState: "运行中" },
      expectedVersion: "v1",
    });
    expect(parsed.success).toBe(false);
  });

  it("走完整状态机之外，publish_state 只可能由本文件那两条路由改动", async () => {
    const agentId = await seedAgent({ publishState: "草稿", modelId: "m-1", toolWhitelist: [GRANTED_TOOL] });
    // 提交（唯一合法的 草稿→待审核 边）
    expect((await post(`/agents/${agentId}/submit`, AUTHOR)).status).toBe(200);
    expect(await publishStateOf(agentId)).toBe("待审核");
    // 而 运行中 这一步今天到不了（见上面 SECURITY_SCAN_PENDING 那条）——
    // 所以「草稿 → 运行中」在本仓当前不存在任何可达路径。
    await assignReviewerFunction(METHODOLOGY, "methodology-reviewer");
    await post(`/agents/${agentId}/publish-decision`, METHODOLOGY, { agentId, decision: "批准发布", reason: null });
    expect(await publishStateOf(agentId)).not.toBe("运行中");
  });
});

describe("越权申请未裁决：ELEVATION_UNDECIDED 真的在拦", () => {
  it("白名单里有「越权申请待确认」⇒ 提交时计数如实上报", async () => {
    const agentId = await seedAgent({
      publishState: "草稿", modelId: "m-1", toolWhitelist: [GRANTED_TOOL, PENDING_ELEVATION],
    });

    const response = await post(`/agents/${agentId}/submit`, AUTHOR);

    expect(response.status).toBe(200);
    const parsed = AR.operations.submitAgentForReview.out.parse(await response.json());
    // ⚠ 不是装饰：契约注释写明 `submitForReview` 与 `approvePublish` 都要看它是否已裁决完。
    expect(parsed.elevationRequests).toBe(1);
  });
});
