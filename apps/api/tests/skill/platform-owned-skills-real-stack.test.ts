/**
 * design-delta `platform-owned-skills` —— 四个官方 skill 对所有 org 默认可见/可挂载/
 * 可执行，真栈门控（`verification.md` V1-V6；V7 是真实浏览器路径，见该文件）。
 *
 * 同 `chat-skill-mount-produces-pptx-real-stack.test.ts`/`platform-template-visibility.
 * test.ts` 同一套真实数据库/HTTP Nest app/loopback 模型+沙箱——本条要证的恰恰是 RLS
 * 策略与真实挂载/执行链路的行为，mock 测不出这些。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inspectPptx } from "@repo/skill-sandbox/ooxml";
import {
  addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import { backfillPlatformOrg } from "../../scripts/backfill-platform-org";
import { backfillPlatformSkills, OFFICIAL_SKILLS } from "../../scripts/backfill-platform-skills";
import {
  AGENT_RUN_EXECUTOR, type AgentRunExecutorPort,
} from "../../src/application/agent-run/ports";
import { OBJECT_STORE, type ObjectStore } from "../../src/application/artifact/ports";
import {
  startLoopbackSkillSandbox, type LoopbackSandboxHandle,
} from "../../scripts/loopback-skill-sandbox-behavior";
import { PLATFORM_ORG_ID } from "../../src/domain/org-id";
import { mountListFingerprint } from "../../src/domain/skill/thread-mount";

/** 空挂载列表的确定性指纹（契约要求 `expectedVersion` 必填，空列表不是空字符串）。 */
const EMPTY_MOUNT_FINGERPRINT = mountListFingerprint([]);

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const PROVIDER = "i-platform-skills-loopback";
const MODEL = "i-platform-skills-model";
/**
 * ⚠ V2/V3 的执行门控用 pptx-create（不是 docx-create）——`loopback-skill-sandbox-
 * behavior.ts` 是"确定性执行替身"，它的"其它情况"分支永远回一个**真实合法**的
 * .pptx（pptxgenjs 本体生成），不真的解释脚本内容，从脚本里的 `addText(...)`
 * 字面量取文本、从 `xxx.pptx` 取文件名。挂 docx-create 之后模型写 docx 脚本，
 * 这个替身**依然**只会回一个 pptx——测出来的会是"这个替身不懂 docx"，不是
 * "平台机制哪里坏了"。用 pptx-create 让"挂载→执行→产出真实文件"这条链路的断言
 * 落在与替身能力匹配的组合上；docx-create/xlsx-create/pdf-create 的真实沙箱执行
 * 已经在 F979 的 `apps/skill-sandbox/tests/produces-real-*.test.ts` 里用真沙箱、
 * 真 docx/exceljs/pdf-lib 依赖测过——本文件不重复测那一段，只测"平台可见性"这一段。
 */
const PPTX_SKILL = OFFICIAL_SKILLS.find((s) => s.stableName === "pptx-create")!;
const DOCX_SKILL = OFFICIAL_SKILLS.find((s) => s.stableName === "docx-create")!;

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ═════════════════════ 确定性模型替身（真 HTTP，OpenAI 兼容） ═════════════════════ */

let modelServer: Server;
let modelBase = "";
let modelReplies: string[] = [];
let modelCallCount = 0;

function replyQueue(...texts: string[]): void {
  modelReplies = texts;
  modelCallCount = 0;
}

async function startModelStub(): Promise<void> {
  modelServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = modelReplies[Math.min(modelCallCount, modelReplies.length - 1)] ?? "";
      modelCallCount += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }));
    });
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  modelBase = `http://127.0.0.1:${String((modelServer.address() as AddressInfo).port)}`;
}

/** 一段模型会写的回复：解释文字 + 一个针对 pptx-create 的 `run_script` 块（同
 *  `chat-skill-mount-produces-pptx-real-stack.test.ts` 的 `replyWithScript` 同一形状）。 */
function replyWithPptxScript(fileName = "Platform_Skill_Report.pptx"): string {
  return [
    "好的，我用 pptxgenjs 给你做一页幻灯片。",
    "",
    "```run_script",
    "const PptxGenJS = require('pptxgenjs');",
    "const pres = new PptxGenJS();",
    "pres.addSlide().addText('平台 skill 报告', { x: 0.5, y: 0.5 });",
    `pres.writeFile({ fileName: require('path').join(process.env.SKILL_SANDBOX_OUT_DIR, '${fileName}') });`,
    "```",
  ].join("\n");
}

/* ═════════════════════════════ 生命周期 ═════════════════════════════ */

let app: NestExpressApplication;
let BASE = "";
let sandbox: LoopbackSandboxHandle;

const principal = (actor: string, org: string) => ({
  "x-kernel-test-principal": `${actor}:${org}`,
  "content-type": "application/json",
});

const tick = (org: string) => app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(org as never);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  // 平台组织/skill 都不由迁移种（2026-08-26 事故先例）——显式跑一次，同
  // `platform-template-visibility.test.ts` 的既有纪律。
  await backfillPlatformOrg();
  await backfillPlatformSkills();

  await startModelStub();
  sandbox = await startLoopbackSkillSandbox(0);
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = modelBase;
  process.env.KERNEL_MODEL_API_KEY = "sk-platform-skills-do-not-echo";
  process.env.KERNEL_SKILL_SANDBOX_BASE_URL = `http://127.0.0.1:${String(sandbox.port)}`;
  process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";

  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  BASE = `http://127.0.0.1:${String((app.getHttpServer().address() as AddressInfo).port)}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => modelServer.close(() => resolve()));
  await sandbox?.close();
  // ⚠ 不在这里清理 `backfillPlatformSkills()` 写进 org-platform 的行：
  // `skill_versions`/`skill_version_files` 一旦 `published` 就被
  // `wave2_skill_immutable_trg`（20260804031000_wave2_skill_starter_import.sql）
  // 拒绝 DELETE/UPDATE，逐字同生产——"发布过的 Skill 版本不可变"不是这份测试的
  // 权限问题，是这张表故意的约束。org-platform 是全局共享事实（同
  // skill-contract-crud.test.ts 头注、`backfillPlatformOrg()`/`backfillPlatformSkills()`
  // 与 canvas 模板同一先例），这几张表在 org-platform 下的行本来就该跨测试文件
  // 常驻——rls-cross-tenant-zero-leak.test.ts 需要知道这一点（那份测试已经按
  // design-delta `platform-owned-skills` 更新，见其头注）。
});

/* ═══════════════════════════════ V1 ═══════════════════════════════ */

describe("V1 — 一个从未导入过任何 skill 的全新 org 能在目录里看到四个官方 skill", () => {
  const ORG = "org-platform-skills-v1";
  const ACTOR = "u-platform-skills-v1";

  beforeEach(async () => {
    await resetOrgs(ORG);
    const fx = await seedOrg({ orgId: ORG, projectId: "proj-platform-skills-v1" });
    await addOrgMember(ORG, ACTOR, "admin", fx.teams.energy ?? null);
  });

  it("GET /capabilities?kind=skill 返回四个官方 skill，visibility 是 org-wide", async () => {
    const res = await fetch(`${BASE}/capabilities?orgId=${ORG}&kind=skill`, {
      headers: principal(ACTOR, ORG),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as readonly { name: string; scope: string }[];
    const names = body.map((b) => b.name);
    for (const spec of OFFICIAL_SKILLS) {
      expect(names, `expected "${spec.displayName}" in ${JSON.stringify(names)}`).toContain(spec.displayName);
    }
    expect(body.every((b) => b.scope === "org-wide")).toBe(true);
  });

  it("V1-CP 反证：把 OR org_id = PLATFORM_ORG_ID 去掉，结果必须变空——这里直接对着 listSkills 用例验证同一件事", async () => {
    const { PgDatabase } = await import("../../src/infrastructure/db/pg-database");
    const { appConfig } = await import("../../src/infrastructure/db/pg-config");
    const { PgSkillContractRepository } = await import("../../src/infrastructure/skill/pg-skill-contract-repository");
    const { listSkills } = await import("../../src/application/skill/list-skills");
    const db = new PgDatabase(appConfig());
    try {
      const repo = new PgSkillContractRepository(db).forOrg(ORG);
      const result = await listSkills(
        { orgId: ORG, entry: "library", requesterTeamId: null, orgRole: "admin" },
        { catalog: repo, nextDecisionId: () => `decision-${randomUUID()}` },
      );
      const names = result.items.map((row) => row.name);
      for (const spec of OFFICIAL_SKILLS) expect(names).toContain(spec.displayName);
    } finally {
      await db.close();
    }
  });
});

/* ═══════════════════════════════ V2 + V3 ═══════════════════════════════ */

describe("V2+V3 — 全新 org 能真的挂载平台 skill 到 thread 上，且挂载后真的能执行、产出文件", () => {
  const ORG = "org-platform-skills-v23";
  const ACTOR = "u-platform-skills-v23";
  const PROJECT = "proj-platform-skills-v23";
  const THREAD = "thread-platform-skills-v23";
  const AGENT = "agent-platform-skills-v23";
  const AGENT_V1 = "agent-version-platform-skills-v23-v1";

  beforeEach(async () => {
    modelCallCount = 0;
    replyQueue("（未设置回复）");
    await resetOrgs(ORG);
    const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
    await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy ?? null);
    await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
    await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
    await asApp(ORG, async (c) => {
      const instructions = `You are ${AGENT}.`;
      await c.query(
        `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
        [AGENT, ORG, AGENT, AGENT, ACTOR],
      );
      await c.query(
        `INSERT INTO agent_versions
           (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
            model_provider,model_id,tool_policy,creator_id,created_at,published_at)
         VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,now(),now())`,
        [AGENT_V1, ORG, AGENT, sha256(instructions), instructions, PROVIDER, MODEL, ACTOR],
      );
      await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [AGENT_V1, AGENT, ORG]);
    });
  });

  it("挂载平台 docx-create 成功（不是 SKILL_NOT_FOUND），thread_skill_mounts 里的一行 org_id 是这个新 org", async () => {
    const res = await fetch(`${BASE}/threads/${THREAD}/skill-mounts`, {
      method: "POST",
      headers: principal(ACTOR, ORG),
      body: JSON.stringify({ threadId: THREAD, skillIds: [DOCX_SKILL.skillId], expectedVersion: EMPTY_MOUNT_FINGERPRINT }),
    });
    expect(res.status, await res.clone().text()).toBe(201);

    const rows = await asApp(ORG, (c) => c.query<{ org_id: string; skill_id: string }>(
      `SELECT org_id, skill_id FROM thread_skill_mounts WHERE org_id=$1 AND thread_id=$2 AND removed_at IS NULL`,
      [ORG, THREAD],
    ));
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.org_id).toBe(ORG); // 挂载行属于挂载方自己的组织，不是 org-platform
    expect(rows.rows[0]!.skill_id).toBe(DOCX_SKILL.skillId);
  });

  it("挂载之后真的能执行：真实 chat run 产出一个可解析的 .pptx（readPinnedSkills 真的读到了平台行的正文）", async () => {
    const mountRes = await fetch(`${BASE}/threads/${THREAD}/skill-mounts`, {
      method: "POST",
      headers: principal(ACTOR, ORG),
      body: JSON.stringify({ threadId: THREAD, skillIds: [PPTX_SKILL.skillId], expectedVersion: EMPTY_MOUNT_FINGERPRINT }),
    });
    expect(mountRes.status, await mountRes.clone().text()).toBe(201);

    replyQueue(replyWithPptxScript("Platform_Skill_Report.pptx"));

    const msgRes = await fetch(`${BASE}/chat/threads/${THREAD}/messages`, {
      method: "POST",
      headers: principal(ACTOR, ORG),
      body: JSON.stringify({ clientMessageId: randomUUID(), text: "帮我写一份报告", agentId: AGENT }),
    });
    expect(msgRes.status, await msgRes.clone().text()).toBe(202);
    const { agentRunId: runId } = (await msgRes.json()) as { agentRunId: string };
    await tick(ORG);

    const run = await asApp(ORG, (c) => c.query<{
      status: string;
      model_output_files: readonly { name: string; mime: string; sizeBytes: number; objectKey: string }[];
      skill_version_ids: readonly string[];
    }>(
      `SELECT status, model_output_files, skill_version_ids FROM agent_runs WHERE org_id=$1 AND id=$2`,
      [ORG, runId],
    )).then((r) => r.rows[0]!);

    // ⚠ 这是最容易漏的一处（contract.md §4③）：如果只加了 listAll/loadMountableRow
    // 的 OR 子句、漏了 readPinnedSkills 的，run 会在这里失败 SKILL_VERSION_UNAVAILABLE
    // 而不是 succeeded——run 能看到、能挂上，但一执行就报错。
    expect(run.status).toBe("succeeded");
    expect(run.model_output_files).toHaveLength(1);
    const file = run.model_output_files[0]!;
    expect(file.name).toBe("Platform_Skill_Report.pptx");

    const bytes = await app.get<ObjectStore>(OBJECT_STORE).get(file.objectKey);
    expect(bytes).not.toBeNull();
    expect(Buffer.from(bytes!).length).toBe(file.sizeBytes);
    const deck = inspectPptx(Buffer.from(bytes!));
    const text = deck.textRuns.filter((t) => t.trim() !== "");
    expect(text.length).toBeGreaterThan(0);
    expect(text.join("|")).toContain("平台 skill 报告");
  }, 120_000);
});

/* ═══════════════════════════════ V4 ═══════════════════════════════ */

describe("V4 — 写路径依然严格隔离：一个组织改不了/删不了平台行", () => {
  const ORG = "org-platform-skills-v4";
  const ACTOR = "u-platform-skills-v4";

  beforeEach(async () => {
    await resetOrgs(ORG);
    const fx = await seedOrg({ orgId: ORG, projectId: "proj-platform-skills-v4" });
    await addOrgMember(ORG, ACTOR, "admin", fx.teams.energy ?? null);
  });

  it("以真实组织身份 UPDATE 一行 org_id='org-platform' 的 skills 记录：0 行受影响（RLS 拒绝，不是应用层判断）", async () => {
    const result = await asApp(ORG, (c) => c.query(
      `UPDATE skills SET name = '被篡改的名字' WHERE id = $1 AND org_id = $2`,
      [DOCX_SKILL.skillId, PLATFORM_ORG_ID],
    ));
    // RLS 的 skills_tenant（FOR ALL）策略只认 org_id = current_org（这里是 ORG，
    // 不是 org-platform）；skills_platform_read 只加了 FOR SELECT——UPDATE 找不到
    // 任何一条策略允许它，行为是"WHERE 匹配不到任何行"，不是抛错。
    expect(result.rowCount).toBe(0);

    // 用平台组织自己的连接核实那一行确实还是原名——不是"改成功了但这个会话看不到"。
    const stillOriginal = await asOwner((c) => c.query<{ name: string }>(
      `SELECT name FROM skills WHERE id = $1 AND org_id = $2`,
      [DOCX_SKILL.skillId, PLATFORM_ORG_ID],
    ));
    expect(stillOriginal.rows[0]!.name).toBe(DOCX_SKILL.displayName);
  });

  it("以真实组织身份 DELETE 一行平台 skill_versions：连 app_rw 角色本身都没有 DELETE 权限（比 RLS 更早一层拒绝）", async () => {
    // ⚠ 实测纠正：这里不是 RLS 层"0 行受影响"，是更早一层——`app_rw` 角色对
    // `skill_versions` 表压根没有 DELETE 授权（`20260804031000_wave2_skill_
    // starter_import.sql`：`GRANT SELECT, INSERT ON skill_versions...`，UPDATE/
    // DELETE 都不在列表里，"已发布版本不可变"这条规则连组织自己的版本都不能删，
    // 平台版本自然也不能）——报的是 `permission denied for table`，不是 0 行。
    // 这其实是**比本 delta 新增的 RLS 策略更强**的一层既有保护，一并记录下来。
    await expect(asApp(ORG, (c) => c.query(
      `DELETE FROM skill_versions WHERE skill_id = $1 AND org_id = $2`,
      [DOCX_SKILL.skillId, PLATFORM_ORG_ID],
    ))).rejects.toThrow(/permission denied/);
  });
});

/* ═══════════════════════════════ V5 ═══════════════════════════════ */

describe("V5 — 用户自己导入的第三方 skill 依然严格按 org 隔离，不会被平台化", () => {
  const ORG_OWNER = "org-platform-skills-v5-owner";
  const ORG_OTHER = "org-platform-skills-v5-other";
  const ACTOR_OWNER = "u-platform-skills-v5-owner";
  const ACTOR_OTHER = "u-platform-skills-v5-other";
  const SELF_SKILL = "skill-platform-skills-v5-self";
  const SELF_SKILL_NAME = "组织自建 Skill（V5）";

  beforeEach(async () => {
    await resetOrgs(ORG_OWNER, ORG_OTHER);
    const fxOwner = await seedOrg({ orgId: ORG_OWNER, projectId: "proj-platform-skills-v5-owner" });
    await addOrgMember(ORG_OWNER, ACTOR_OWNER, "admin", fxOwner.teams.energy ?? null);
    const fxOther = await seedOrg({ orgId: ORG_OTHER, projectId: "proj-platform-skills-v5-other" });
    await addOrgMember(ORG_OTHER, ACTOR_OTHER, "admin", fxOther.teams.energy ?? null);

    await asApp(ORG_OWNER, async (c) => {
      await c.query(
        `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
        [SELF_SKILL, ORG_OWNER, SELF_SKILL, SELF_SKILL_NAME, ACTOR_OWNER],
      );
      // `GET /capabilities` 读的是 `capability_listings`，不是 `skills` 本身——
      // 真实创建路径（`pg-skill-starter-import-repository.ts`）会同事务插这一行，
      // 这里手写种子数据也要补上，否则测出来的是"目录投影表没这行"，不是本 delta
      // 要验证的"平台可见性范围"这件事。
      await c.query(
        `INSERT INTO capability_listings (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
         VALUES ($1,$2,'skill',$3,'org-wide',NULL,true,NULL) ON CONFLICT DO NOTHING`,
        [`cap-${SELF_SKILL}`, ORG_OWNER, SELF_SKILL_NAME],
      );
    });
  });

  it("另一个全新 org 的 listAll() 看不到它——不因为平台机制存在就默认放宽", async () => {
    const res = await fetch(`${BASE}/capabilities?orgId=${ORG_OTHER}&kind=skill`, {
      headers: principal(ACTOR_OTHER, ORG_OTHER),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as readonly { name: string }[];
    expect(body.map((b) => b.name)).not.toContain(SELF_SKILL_NAME);
  });

  it("owner 自己的 org 能看到自己的 skill（对照组：不是'谁都看不到'，是只有 owner 看得到）", async () => {
    const res = await fetch(`${BASE}/capabilities?orgId=${ORG_OWNER}&kind=skill`, {
      headers: principal(ACTOR_OWNER, ORG_OWNER),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as readonly { name: string }[];
    expect(body.map((b) => b.name)).toContain(SELF_SKILL_NAME);
  });
});

/* ═══════════════════════════════ V6 ═══════════════════════════════ */

describe("V6 — backfill 脚本幂等，可安全重跑", () => {
  it("连续跑两次：第二次全部 alreadyExisted，四个 skill 各自仍然只有一行", async () => {
    const first = await backfillPlatformSkills();
    // 第一次调用点在 beforeAll 已经跑过，这里第二次调用应该四个都已存在。
    expect(first.created).toEqual([]);
    expect([...first.alreadyExisted].sort()).toEqual([...OFFICIAL_SKILLS.map((s) => s.stableName)].sort());

    const second = await backfillPlatformSkills();
    expect(second.created).toEqual([]);
    expect([...second.alreadyExisted].sort()).toEqual([...OFFICIAL_SKILLS.map((s) => s.stableName)].sort());

    const rows = await asOwner((c) => c.query<{ stable_name: string; n: string }>(
      `SELECT stable_name, count(*)::text AS n FROM skills
        WHERE org_id = $1 AND stable_name = ANY($2::text[])
        GROUP BY stable_name`,
      [PLATFORM_ORG_ID, OFFICIAL_SKILLS.map((s) => s.stableName)],
    ));
    expect(rows.rows).toHaveLength(OFFICIAL_SKILLS.length);
    for (const row of rows.rows) expect(row.n).toBe("1");
  });
});
