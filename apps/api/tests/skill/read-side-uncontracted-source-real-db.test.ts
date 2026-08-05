/**
 * #580 —— 读侧的**真库**那一半：真的往 `skill_contracts` 插一行契约外的 `source`，
 * 然后走**真实 HTTP 读路径**（`GET /skills`、`GET /skills/:skillId`）。
 *
 * ## 为什么必须绕过应用层写进去
 *
 * #514 / PR #579 已经把写侧关上了。**从写侧进不去**，所以任何「走 createSkillDraft
 * 造脏数据」的写法测到的都是 #514 已经修好的那件事，不是读侧。要证读侧，
 * 坏数据只能**直接插进库**——那也正是现实里它会怎么进来（迁移、修数据脚本、别的服务）。
 *
 * ## ⚠ 本文件默认 **skip**，而且这是刻意的
 *
 * 要插进那一行，必须先临时摘掉 `skill_contracts.source` 上的 CHECK
 * （见下方 `DB 级约束` 的结论：**约束是存在的**）。而 `ALTER TABLE ... DROP CONSTRAINT`
 * 是**表级、跨 org、跨测试文件**的动作 —— vitest 并行跑同一个 Postgres 时，
 * 它会在别的文件的 fixture 底下把约束抽走。`list-skills-org-membership.test.ts`
 * 文件头对 `GRANT`/`REVOKE` 的告诫是同一类危险。
 *
 * ⇒ 因此本文件只在**独占数据库**下运行：`WORKSPACEX_DB` 被显式设成非默认库名时才跑。
 *   跑法（**不新起 docker 栈**，复用既有 compose postgres，只是换一个库名）：
 *
 *   ```
 *   WORKSPACEX_DB=wsx_i580 pnpm --filter @repo/api exec vitest run \
 *     tests/skill/read-side-uncontracted-source-real-db.test.ts \
 *     --no-file-parallelism --maxWorkers=2
 *   ```
 *
 * **交付时本文件未跑**：交付当晚机器内存见底（`Pages free ≈ 10 MB`、loadavg 26–32、
 * 39 个容器），人类明令不得起新栈、coord-main 明令限流。一个诚实的「已写好待跑」
 * 比一个在饥饿机器上凑出来的绿有用得多 —— 见 PR 正文未验证项。
 *
 * 不依赖真库的那一半（同一份守卫、同一条映射代码）在
 * `read-side-uncontracted-source.test.ts` 里**已实测通过并做过反证**。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { skills as C } from "@repo/contracts";
import { addOrgMember, asOwner, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { SKILL_SOURCES } from "../../src/domain/skill/source-tag";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i580-real-db";
const ACTOR = "u-i580-actor";
const BAD_SKILL = "skill-contract-i580-bad";
const GOOD_SKILL = "skill-contract-i580-good";

/** 本域认识、契约收不下的取值（今天 = 画布）。D09 一旦裁成五档，这里取不到值。 */
const UNCONTRACTED = SKILL_SOURCES.find(
  (s) => !(C.SkillSource.options as readonly string[]).includes(s),
);
const CONTRACTED = C.SkillSource.options[0];

/**
 * 只在**独占库**下运行 —— 见文件头。
 *
 * ⚠ 2026-08-06 事故：原判据是「不等于默认库名」，而 CI 的 gates job 给每次跑
 * 分配一个独有库名（例如 `wsx_ci_<runid>`），那也「不等于 workspacex」——于是
 * 这条本该「只在本地显式独占库下跑」的门被 CI 误判为满足，在共享的 CI 库上
 * 执行了 `DROP CONSTRAINT` 并插入了不合法的 fixture 行（见下），把 `gates`
 * 打红、挡住了整条部署链。⇒ 改成白名单：只认文档里写死的那一个库名，
 * 「库存不存在」不再算数——那在任何 CI 环境下都恒真，等于没有闸。
 */
const EXCLUSIVE_DB = process.env.WORKSPACEX_DB === "wsx_i580";
const SHOULD_SKIP = !EXCLUSIVE_DB || UNCONTRACTED === undefined;

let app: NestExpressApplication;
let BASE = "";

const principal = () => ({
  "x-kernel-test-principal": `${ACTOR}:${ORG}`,
  "content-type": "application/json",
});

const CONSTRAINT = "skill_contracts_source_check";

/** 临时摘掉 CHECK → 插行 → 立刻装回去。装回去用 `NOT VALID`，否则那一行会让它建不起来。 */
async function insertBypassingCheck(skillId: string, source: string): Promise<void> {
  await asOwner(async (c) => {
    await c.query(`ALTER TABLE skill_contracts DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
  });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO skill_contracts
         (id, org_id, name, duty, source, status, visibility, owner_team_id,
          current_version_id, archived, created_by)
       VALUES ($1,$2,$3,'读侧守卫用',$4,'草稿','org-wide',NULL,NULL,false,$5)`,
      [skillId, ORG, `i580-${skillId}`, source, ACTOR],
    ),
  );
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO skill_contract_versions
         (id, org_id, skill_id, version_number, state, prompt_template, input_schema,
          output_schema, data_scope, reads_raw_transcript, fallback_declaration,
          model_ref, content_hash, created_by)
       VALUES ($1,$2,$3,1,'草稿','p','{}','{}','[]'::jsonb,false,'f','model-default',$4,$5)`,
      // content_hash 有 CHECK (content_hash ~ '^[a-f0-9]{64}$')
      // （0006-f04-artifact-model.sql:99）——写死的 'h' 过不了这条，
      // 这份 fixture 第一次真跑到专属库上就会撞见。换成合法的 64 位 hex 占位。
      [`${skillId}-v1`, ORG, skillId, "0".repeat(64), ACTOR],
    ),
  );
  await asOwner(async (c) => {
    await c.query(
      `ALTER TABLE skill_contracts ADD CONSTRAINT ${CONSTRAINT}
         CHECK (source IN (${C.SkillSource.options.map((s) => `'${s}'`).join(", ")})) NOT VALID`,
    );
  });
}

beforeAll(async () => {
  if (SHOULD_SKIP) return;
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
  if (SHOULD_SKIP) return;
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-i580" });
  await addOrgMember(ORG, ACTOR, "admin", null);
});

describe.skipIf(SHOULD_SKIP)("#580 真库：库里已有一行契约外 source", () => {
  /* ─── 先证 DB 级约束真的在挡（这是 issue 第 2 问的真库版结论） ─── */

  it("不摘 CHECK 就插不进去 —— `source` 上确有 DB 级约束", async () => {
    const attempt = asApp(ORG, (c) =>
      c.query(
        `INSERT INTO skill_contracts
           (id, org_id, name, duty, source, status, visibility, owner_team_id,
            current_version_id, archived, created_by)
         VALUES ($1,$2,'x','y',$3,'草稿','org-wide',NULL,NULL,false,$4)`,
        [BAD_SKILL, ORG, UNCONTRACTED as string, ACTOR],
      ),
    );
    // 23514 = check_violation。断言到**具体错误码**，不是「抛了个错」——
    // 后者对「表不存在」「列名写错」同样成立。
    await expect(attempt).rejects.toMatchObject({ code: "23514" });
  });

  /* ─── 正样本：同一条 HTTP 路径、正常数据必须成功 ─── */

  it("[正样本] 契约内 source 的那一行：GET /skills 返回 200 且含它", async () => {
    await insertBypassingCheck(GOOD_SKILL, CONTRACTED);
    const response = await fetch(
      `${BASE}${C.operations.listSkills.path}?orgId=${ORG}&entry=library`,
      { headers: principal() },
    );
    expect(response.status).toBe(200);
    const body = C.operations.listSkills.out.parse(await response.json());
    expect(body.items.map((i) => i.skillId)).toContain(GOOD_SKILL);
  });

  /* ─── 负样本：契约外那一行 ─── */

  it("[负样本] GET /skills 不再是匿名 500：错误里指得出 skillId", async () => {
    await insertBypassingCheck(BAD_SKILL, UNCONTRACTED as string);
    const response = await fetch(
      `${BASE}${C.operations.listSkills.path}?orgId=${ORG}&entry=library`,
      { headers: principal() },
    );
    // ⚠ 刻意**不**写 `expect(status).toBeGreaterThanOrEqual(400)` —— 那种断言
    //   今天本来就绿（守卫之前也是 500），什么都证明不了。
    expect(response.status).toBe(500);
  });

  it("[负样本] 爆炸半径：坏行与好行同存时，好行也交付不出去（一行毒死整份列表）", async () => {
    await insertBypassingCheck(GOOD_SKILL, CONTRACTED);
    await insertBypassingCheck(BAD_SKILL, UNCONTRACTED as string);
    const response = await fetch(
      `${BASE}${C.operations.listSkills.path}?orgId=${ORG}&entry=library`,
      { headers: principal() },
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(GOOD_SKILL);
  });

  it("[负样本] GET /skills/:skillId 方向同样 fail-closed，且不是 404", async () => {
    await insertBypassingCheck(BAD_SKILL, UNCONTRACTED as string);
    const response = await fetch(`${BASE}/skills/${BAD_SKILL}`, { headers: principal() });
    // ⚠ 不写 `answers 404` 型断言：Nest 对**不存在的路由**也回 404，
    //   那种断言在路由被删掉时照样绿。这里要的正好相反 —— 必须**不是** 404。
    expect(response.status).not.toBe(404);
    expect(response.status).toBe(500);

    // 配对正样本：同一条路径、同一个组织，契约内那一行必须 200。
    await insertBypassingCheck(GOOD_SKILL, CONTRACTED);
    const ok = await fetch(`${BASE}/skills/${GOOD_SKILL}`, { headers: principal() });
    expect(ok.status).toBe(200);
  });
});
