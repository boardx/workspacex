/**
 * F192（design-delta `skill-model-a-b-convergence` 选项②，issue #598，已签核）——
 * 存量模型 B（`skill_contracts`/`skill_contract_versions`）数据在写入口冻结后
 * 仍必须只读可达，真实 HTTP、真实 Postgres 反证。
 *
 * ## 断的是什么（UC-3.7 R12 V3 + delta `verification.md` 选项②·V3/V4）
 *
 * 写路径关闭 ≠ 存量数据消失。本文件**直接往库里插**一条「冻结前就已存在」的
 * 模型 B 草稿（绕开已冻结的 `POST /skills`，模拟迁移/种子脚本/#598 之前的历史
 * 数据），断言：
 *   ① `GET /skills`（合并列表，`listAll` 逻辑不变）里看得见这一行；
 *   ② `GET /skills/:skillId`（详情，`loadDetail` 只读模型 B，行为不变）能读到
 *      完整契约正文，内容与插入时一致（不是「能 200」这种空转断言）；
 *   ③ 冻结（`POST /skills` 全域 410）不影响这两条读路径——同一时刻两条读路径
 *      与「写入口已冻结」这件事同时为真。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { skills as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f190-legacy-readable";
const ACTOR = "u-f190-legacy-reader";

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

const get = (path: string) => fetch(`${BASE}${path}`, { headers: principal(ACTOR, ORG) });

/**
 * 直接往库里插一条模型 B 草稿——**不经过**已冻结的 `POST /skills`。这正是「冻结前
 * 已存在的历史数据」在库里的真实形状：迁移脚本 / 种子 / #598 之前的存量行都是
 * 这样进来的，不是靠一个仍然活着的应用层写路径。
 */
async function seedLegacyContractDirectly(): Promise<{ skillId: string; versionId: string }> {
  const skillId = `skill-contract-f190-${randomUUID()}`;
  const versionId = `${skillId}-v1`;
  const contentHash = "1".repeat(64); // CHECK (content_hash ~ '^[a-f0-9]{64}$')

  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO skill_contracts
         (id, org_id, name, duty, source, status, visibility, owner_team_id,
          current_version_id, archived, created_by)
       VALUES ($1,$2,$3,$4,'自建','草稿','org-wide',NULL,$5,false,$6)`,
      [skillId, ORG, "冻结前的遗留契约-F192", "把访谈纪要压成三条结论", versionId, ACTOR],
    ),
  );
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO skill_contract_versions
         (id, org_id, skill_id, version_number, state, prompt_template, input_schema,
          output_schema, data_scope, reads_raw_transcript, fallback_declaration,
          model_ref, content_hash, created_by)
       VALUES ($1,$2,$3,1,'草稿',$4,$5,$6,'[]'::jsonb,false,$7,'model-default',$8,$9)`,
      [
        versionId,
        ORG,
        skillId,
        "对 F192-遗留内容 逐字读回",
        '{"type":"object","properties":{"notes":{"type":"string"}},"required":["notes"]}',
        '{"type":"object","properties":{"points":{"type":"array"}},"required":["points"]}',
        "读不到就如实说读不到",
        contentHash,
        ACTOR,
      ],
    ),
  );
  await asApp(ORG, (c) =>
    c.query("UPDATE skill_contracts SET current_version_id = $1 WHERE org_id = $2 AND id = $3", [
      versionId,
      ORG,
      skillId,
    ]),
  );
  return { skillId, versionId };
}

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
  await seedOrg({ orgId: ORG, projectId: "proj-f190-legacy" });
  await addOrgMember(ORG, ACTOR, "admin", null);
});

describe("F192 · 存量模型 B 数据冻结后仍只读可达", () => {
  it("GET /skills 合并列表里看得见冻结前插入的那一行（listAll 逻辑不变）", async () => {
    const { skillId } = await seedLegacyContractDirectly();

    const response = await get(`${C.operations.listSkills.path}?orgId=${ORG}&entry=library`);
    expect(response.status).toBe(200);
    const parsed = C.operations.listSkills.out.safeParse(await response.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    const body = parsed.success ? parsed.data : null!;

    expect(body.items.map((i) => i.skillId)).toContain(skillId);
    const row = body.items.find((i) => i.skillId === skillId)!;
    expect(row.name).toBe("冻结前的遗留契约-F192");
    expect(row.status).toBe("草稿");
  });

  it("GET /skills/:skillId 详情能读到完整契约正文，内容与插入时一致（不删数据、不 404 化存量）", async () => {
    const { skillId } = await seedLegacyContractDirectly();

    const response = await get(`/skills/${skillId}`);
    expect(response.status).toBe(200);
    const parsed = C.operations.getSkillDetail.out.safeParse(await response.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    const detail = parsed.success ? parsed.data : null!;

    expect(detail.skill.skillId).toBe(skillId);
    expect(detail.contract.promptTemplate).toBe("对 F192-遗留内容 逐字读回");
    expect(detail.contract.fallbackDeclaration).toBe("读不到就如实说读不到");
    // 门禁结论如实是「都没过」——这条历史数据从未走过扫描/审核。
    expect(detail.gateResults.securityScan).toBeNull();
    expect(detail.gateResults.methodologyReviewPassed).toBe(false);
  });

  it("同一时刻：写入口全域 410，两条读路径仍然 200——「唯一入口被摘」不等于「数据被摘」", async () => {
    const { skillId } = await seedLegacyContractDirectly();

    const createAttempt = await fetch(`${BASE}${C.operations.createSkillDraft.path}`, {
      method: "POST",
      headers: principal(ACTOR, ORG),
      body: JSON.stringify({
        orgId: ORG,
        name: "冻结期间试图新建",
        duty: "d",
        contract: {
          promptTemplate: "p",
          inputSchema: "{}",
          outputSchema: "{}",
          dataScope: [],
          readsRawTranscript: false,
          fallbackDeclaration: "f",
        },
        visibility: "org-wide",
        modelRef: "model-default",
      }),
    });
    expect(createAttempt.status).toBe(410);

    const list = await get(`${C.operations.listSkills.path}?orgId=${ORG}&entry=library`);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { items: { skillId: string }[] };
    expect(listBody.items.map((i) => i.skillId)).toContain(skillId);

    const detail = await get(`/skills/${skillId}`);
    expect(detail.status).toBe(200);
  });
});
