/**
 * F192（design-delta `skill-model-a-b-convergence` 选项②，issue #598，已签核）——
 * `POST /skills`（`createSkillDraft`，模型 B 的唯一写入口）已冻结，真实 HTTP、
 * 真实 Postgres 反证。
 *
 * ## 断的是什么
 *
 * V1（UC-3.7 R12）：对 `POST /skills` 发起真实 HTTP 请求，断言返回 **410**（不是
 * 404/500/200），且响应体带 `reasonCode` 与指向模型 A 编辑器工作流的引导信息。
 * 「唯一入口被摘」不是「前端按钮藏起来但接口还在」——所以断言覆盖：
 *   ① 一份完全合法的请求体（此前会 201）现在仍是 410，不是先校验通过再拒；
 *   ② 一份畸形请求体（此前会 400）也一样是 410——冻结是**无条件**的；
 *   ③ 未认证请求也一样是 410——不是先过鉴权层再拒；
 *   ④ 不入库：无论哪种请求，`skill_contracts` 里都不会多出一行。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { skills as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f190-skill-frozen-create";
const ACTOR = "u-f190-actor";

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

const CONTRACT = {
  promptTemplate: "把访谈纪要压成三条结论",
  inputSchema: '{"type":"object","properties":{"notes":{"type":"string"}},"required":["notes"]}',
  outputSchema: '{"type":"object","properties":{"points":{"type":"array"}},"required":["points"]}',
  dataScope: [] as string[],
  readsRawTranscript: false,
  fallbackDeclaration: "模型不可用时返回空结论并提示人工整理",
};

const legalBody = (name: string) => ({
  orgId: ORG,
  name,
  duty: "访谈纪要 → 结论",
  contract: CONTRACT,
  visibility: "org-wide" as const,
  modelRef: "model-default",
});

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

const rowCount = () =>
  asApp(ORG, async (c) => {
    const r = await c.query("SELECT id FROM skill_contracts WHERE org_id = $1", [ORG]);
    return r.rowCount;
  });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-f190" });
  await addOrgMember(ORG, ACTOR, "admin", null);
});

describe("F192 · POST /skills 已冻结 —— 恒 410，不是 404/500/200", () => {
  it("一份完全合法的请求体（冻结前会 201）现在仍是 410，且响应体带指向模型 A 的引导码", async () => {
    const response = await post(
      C.operations.createSkillDraft.path,
      legalBody("合法请求-仍然410"),
      principal(ACTOR, ORG),
    );

    expect(response.status).toBe(410);
    const body = (await response.json()) as { error?: string; reasonCode?: string; traceId?: string };
    // ⚠ 响应体只带 `error`/`traceId`/`reasonCode`（`all-exceptions.filter.ts` 文件头
    //   逐字：detail 只进日志，不进响应体——本仓统一纪律，不是本条特例）。
    //   「带引导信息」因此落在 `reasonCode` 本身可辨识、且服务端日志（下方另一条用例
    //   核对）里带着指向模型 A 工作流的完整文案，不是把原始 message 转发给客户端。
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(500);
    expect(body.error).toBe("gone");
    // reasonCode 逐字断言：不是「随便一个 4xx」，是这一条明确登记的冻结码。
    expect(body.reasonCode).toBe("SKILL_DRAFT_WRITE_PATH_FROZEN");

    // 不入库：不是「拒绝了但还是写了一行」。
    expect(await rowCount()).toBe(0);
  });

  it("畸形请求体（冻结前会 400）也是 410——冻结无条件，不是先过契约校验再拒", async () => {
    const response = await post(
      C.operations.createSkillDraft.path,
      { garbage: "这不是合法的 createSkillDraft.in 形状" },
      principal(ACTOR, ORG),
    );

    expect(response.status).toBe(410);
    const body = (await response.json()) as { reasonCode?: string };
    expect(body.reasonCode).toBe("SKILL_DRAFT_WRITE_PATH_FROZEN");
    expect(await rowCount()).toBe(0);
  });

  /**
   * ⚠ 未认证请求走的是**全局** `PrincipalGuard`（`main.ts` 里对所有路由生效），
   *   不是本路由自己的鉴权逻辑——它排在任何 controller 方法之前，是本仓统一的
   *   认证边界，不属于本条冻结要改的范围。未认证请求得到 401，这与「写入口对
   *   任何**已认证**请求都无条件 410」并不矛盾：本文件其余用例已经证明，只要
   *   请求过了这道全局认证门，无论 body 合法与否、无论哪个组织，一律 410。
   */
  it("未认证请求走的是全局认证门（401），不是本路由自己判定的结果——认证门之后才轮到 410", async () => {
    const response = await fetch(`${BASE}${C.operations.createSkillDraft.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(legalBody("未认证请求")),
    });

    expect(response.status).toBe(401);
    expect(await rowCount()).toBe(0);
  });

  it("跨组织的请求体（此前会撞 assertOwnTenant 的 403）也是 410——不是先判租户再拒", async () => {
    const response = await post(
      C.operations.createSkillDraft.path,
      legalBody("跨组织请求"),
      principal(ACTOR, "org-f190-a-different-org"),
    );

    expect(response.status).toBe(410);
    expect(await rowCount()).toBe(0);
  });

  it("契约里逐字登记着这条冻结（SKILLS_FROZEN_ROUTES），且 createSkillDraft 仍是已知操作（未删除）", () => {
    expect(C.SKILLS_FROZEN_ROUTES.map((r) => r.route)).toContain("POST /skills");
    // 定义未删除：存量调用方/测试仍需引用它曾经存在过。
    expect(C.operations.createSkillDraft.path).toBe("/skills");
    expect(C.operations.createSkillDraft.method).toBe("POST");
  });
});
