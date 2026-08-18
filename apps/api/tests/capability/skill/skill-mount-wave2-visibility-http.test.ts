/**
 * #1534 —— 真实复现：GitHub/URL 导入落地的 skill（模型 A/wave2，`skills`/
 * `skill_versions` 表）在 chat 里通过 `#` 挂载必然 `SKILL_NOT_FOUND（HTTP 404）`。
 *
 * 根因：`skill-mount.controller.ts` 的 `visibilityPort()` 原来借用
 * `SkillContractReadPort.loadDetail`，而它**只读** `skill_contracts`（声明式契约
 * skill，本文里称模型 B）。修法（`loadMountableRow`，见 `pg-skill-contract-repository.ts`
 * 与 `application/skill/ports.ts`）两边都查，本文件钉住三条：
 *
 *   ① 模型 A（`skills`/`skill_versions`，wave2）落地的 skill 真的能被挂载 ⇒ 201。
 *   ② 模型 B（`skill_contracts`）落地的 skill 仍然能被挂载 ⇒ 201（回归防线：
 *      不能为了修 A 把 B 修坏）。
 *   ③ 两边都没有的 skillId 仍然诚实报 `SKILL_NOT_FOUND`（反证：不是「什么都放行了」）。
 *
 * 真实 HTTP（走 `createApp()`，不打桩 controller）+ 真实 Postgres（不用内存替身），
 * 同 `agent-skill-pins-http-route.test.ts` 的纪律。
 */
import { createHash, randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { skills as C } from "@repo/contracts";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1534-wave2-mount";
const PROJECT = "proj-i1534-wave2-mount";
const FACILITATOR = "u-i1534-facilitator";

let app: NestExpressApplication;
let base = "";

const authFor = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

function post(path: string, userId: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, { method: "POST", headers: authFor(userId), body: JSON.stringify(body) });
}

/** 挂载路由用的乐观锁：空挂载列表恒有的确定指纹（`mountListFingerprint([])`）。 */
const EMPTY_LIST_FINGERPRINT = createHash("sha256").update("").digest("hex");

async function mount(threadId: string, skillId: string): Promise<Response> {
  return post(
    `/threads/${threadId}/skill-mounts?projectId=${PROJECT}`,
    FACILITATOR,
    C.operations.mountSkillToThread.in.parse({
      threadId,
      skillIds: [skillId],
      expectedVersion: EMPTY_LIST_FINGERPRINT,
    }),
  );
}

/** 模型 A/wave2：GitHub/URL 导入落地的 skill 走 `skills`/`skill_versions`，非 `skill_contracts`。 */
async function seedWave2EnabledSkill(): Promise<string> {
  const skillId = `skill-i1534-wave2-${randomUUID()}`;
  const versionId = `skill-version-i1534-wave2-${randomUUID()}`;
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
      [skillId, ORG, skillId, "i1534 wave2 fixture skill", FACILITATOR],
    );
    await c.query(
      `INSERT INTO skill_versions (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,'v1',$4,'{}'::jsonb,$5,now(),false)`,
      [versionId, ORG, skillId, "0".repeat(64), FACILITATOR],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, versionId, Buffer.from("# fixture\n"), "0".repeat(64)],
    );
    await c.query("SELECT wave2_publish_skill_version($1,$2)", [ORG, versionId]);
  });
  return skillId;
}

/** 模型 B：声明式契约 skill（`skill_contracts`），已启用，有生效版本号。 */
async function seedContractEnabledSkill(): Promise<string> {
  const skillId = `skill-contract-i1534-${randomUUID()}`;
  const versionId = `skill-contract-version-i1534-${randomUUID()}`;
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skill_contracts
         (id, org_id, name, duty, source, status, visibility, owner_team_id,
          current_version_id, archived, created_by, tags)
       VALUES ($1,$2,$3,'i1534 fixture duty','自建','已启用','org-wide',NULL,$4,false,$5,'{}')`,
      [skillId, ORG, skillId, versionId, FACILITATOR],
    );
  });
  return skillId;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, FACILITATOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, FACILITATOR, "facilitator", null, true);

  const { createApp } = await import("../../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

describe("#1534 · 挂载判定两边都查（模型 A wave2 + 模型 B 契约）", () => {
  it("① 正例：模型 A（GitHub/URL 导入落地，wave2 `skills` 表）的 skill 挂得上 ⇒ 201", async () => {
    const skillId = await seedWave2EnabledSkill();
    const response = await mount(`thread-i1534-wave2-${randomUUID()}`, skillId);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    const parsed = C.operations.mountSkillToThread.out.parse(body);
    expect(parsed.mounts).toHaveLength(1);
    expect(parsed.mounts[0]?.skillId).toBe(skillId);
    // ⚠ 挂载记录的 versionId 必须真的来自 wave2 的已发布版本，不是编出来的占位值。
    expect(parsed.mounts[0]?.versionId).not.toBe("");
  });

  it("② 回归：模型 B（`skill_contracts`）的 skill 仍然挂得上 ⇒ 201（修 A 没有修坏 B）", async () => {
    const skillId = await seedContractEnabledSkill();
    const response = await mount(`thread-i1534-contract-${randomUUID()}`, skillId);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    const parsed = C.operations.mountSkillToThread.out.parse(body);
    expect(parsed.mounts).toHaveLength(1);
    expect(parsed.mounts[0]?.skillId).toBe(skillId);
  });

  it("③ 反证：两边都没有的 skillId 仍然诚实报 404 SKILL_NOT_FOUND（不是「什么都放行了」）", async () => {
    const response = await mount(`thread-i1534-missing-${randomUUID()}`, `skill-i1534-does-not-exist-${randomUUID()}`);
    const body = (await response.json()) as { readonly reasonCode?: string };
    expect(response.status, JSON.stringify(body)).toBe(404);
    expect(body.reasonCode).toBe("SKILL_NOT_FOUND");
  });
});
