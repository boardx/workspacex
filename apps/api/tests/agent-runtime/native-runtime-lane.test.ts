// @global-scope-fixture seeder:backfillPlatformSkills: 与 `platform-owned-skills-real-stack.
//   test.ts` 同一份幂等种子（连同它的前置 `backfillPlatformOrg`），写 `org-platform` 名下的
//   四个官方 skill 行。`resetOrgs(<自己的 org>)` 收敛不到它、`wave2_skill_immutable_trg`
//   又挡着删除 ⇒ 没有文件能收敛它。本文件**必须**种它——#3051 的数据形态就是"组织自己的
//   同名行 + 平台副本同时存在"，没有平台副本就复现不出重名；断言一律按自己的 org 与显式
//   的版本 id 过滤，不按"库里有几个 skill"数数，所以谁先跑不改变本文件看见什么。
//   见 issue #2982 / PR #2978。
/**
 * #3052 —— 原生运行时车道（`KERNEL_NATIVE_RUNTIME=1`）的 API 侧取证。
 *
 * ## 这个文件存在的理由
 *
 * 2026-09-08，DevApp 的每一条 chat 在**所有门控全绿**的情况下挂了一整天，三层根因
 * 叠在同一条路径上（#3033）：
 *
 *   ① #3051 组织级遗留副本与平台官方 skill 同 `stable_name` ⇒ `canonicalNativePackageSet`
 *      抛裸 `Error("invalid native package set")`，provision 之前就死。
 *   ② #3058 URL 导入的遗留行 `stable_name` 是 `sk_<uuid>`（下划线）/ 中文名 ⇒
 *      `native_invalid_skill_stable_name`。
 *   ③ #3065 SKILL.md 前言 `name` ≠ `stable_name` ⇒ Deep Agent 侧
 *      `SkillsMiddleware.before_agent` 抛 `SkillActivityError`（那一层在 pytest 里，
 *      见 `apps/deep-agent-service/tests/test_native_skill_activity.py`）。
 *
 * 三层都躲过了 CI，原因逐字写在 #3033 的复盘里：**没有任何车道开着
 * `KERNEL_NATIVE_RUNTIME=1`，而且 CI 的真栈里没有这三种数据形态**。三个修复各自
 * 带了自己的单元/真库测试，但那些测试的输入是**手搓的 mock pins**；本文件把输入换成
 * **真实数据库里长出来的行**——4i/4j 补种出来的平台 skill、加上三条遗留坏行——再走
 * 真实的 `readPinnedSkills` → `bindNativeInvocation` → 真实沙箱 `provision`。
 *
 * 判据（PR 里贴了逐条 `git revert --no-commit` 的红输出）：
 *   - 撤 #3051 ⇒ 两条 `pdf-create` 一起进 pins ⇒ provision 抛 invalid native package set
 *   - 撤 #3058 ⇒ 迁移不存在，遗留 `sk_<uuid>` 行原样留着 ⇒ `native_invalid_skill_stable_name`
 *
 * ⚠ 本文件**故意不 import** `dedupeNativePins`、也**故意不读**迁移文件本身。import 一个
 * 修复才引入的符号、或 `readFileSync` 一个修复才引入的文件，撤掉修复时红的是
 * "symbol/文件不存在"，那是编译错误不是行为反证——上一次「红 ≠ 跑过」的教训。这里只调
 * 撤销前后都存在的 `bindNativeInvocation` 与真实 migrator，让红的原因就是 DevApp 当天的
 * 那句报错。
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PLATFORM_ORG_ID, toOrgId } from "../../src/domain/org-id";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgNativeSessionOwner } from "../../src/infrastructure/agent-run/pg-native-session-owner";
import { PgParentRunControlReader } from "../../src/infrastructure/agent-run/pg-parent-run-control";
import { PgNativeRunInputs } from "../../src/infrastructure/agent-run/pg-native-run-inputs";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { createNativeSessionTransport } from "../../src/infrastructure/agent-run/native-session-transport";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { bindNativeInvocation } from "../../src/application/agent-run/native-invocation";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import { backfillPlatformOrg } from "../../scripts/backfill-platform-org";
import { backfillPlatformSkills } from "../../scripts/backfill-platform-skills";

/**
 * 车道身份自检：本文件的全部意义就是"在原生准入打开的配置下跑"。忘了设这个变量的
 * CI 改动会让它退化成又一条与现有 lane 无差别的测试——那正是 #3052 要消灭的东西。
 */
if (process.env.KERNEL_NATIVE_RUNTIME !== "1") {
  throw new Error("native runtime lane requires KERNEL_NATIVE_RUNTIME=1");
}

const org = toOrgId("native-lane-" + randomUUID());
const parent = "run-" + randomUUID();
const workspace = join(process.cwd(), "../..");
const thread = `thread-${org}`;
const message = `message-${org}`;

let db: PgDatabase;
let root: string;
let relay: ReturnType<typeof createServer> | undefined;
let socket = "";

/** 遗留的 URL 导入包：SKILL.md 前言 name 是上游作者写的，与 stable_name 永远不等（#3065）。 */
const UPSTREAM_SKILL_MD =
  "---\nname: PDF Creator (upstream author's name)\ndescription: Imported from a third-party URL.\n---\n" +
  "Run python3 /skills/<stable>/scripts/report.py.\n";

function processRun(cmd: string, args: string[], input = ""): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", () => clearTimeout(timer));
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${String(code)}: ${err}`))));
    child.stdin.end(input);
  });
}

/**
 * 在**本组织**下插一个已发布的 skill 版本。走的是 `ensure-platform-skill-catalog.ts`
 * 发布真实版本的同一组语句（含 `wave2_publish_skill_version`），不手写第二份"怎样
 * 发布一个版本"。`stableName` 参数刻意不校验——本文件要造的就是不合规的遗留行。
 */
async function seedOrgSkill(
  skillId: string, stableName: string, displayName: string, skillMd: string,
): Promise<string> {
  const versionId = `ver-${skillId}`;
  const content = Buffer.from(skillMd, "utf8");
  const digest = createHash("sha256").update(content).digest("hex");
  // asApp（不是 asOwner）：`skill_version_files` 上有租户一致性触发器，只有在真实
  // 租户事务里写才过得去——production 走的也是这条路径。
  await asApp(org, async (c) => {
    await c.query(
      `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled','actor',now(),now()) ON CONFLICT (id) DO NOTHING`,
      [skillId, org, stableName, displayName]);
    await c.query(
      `INSERT INTO skill_versions
         (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,'actor',now(),false) ON CONFLICT (id) DO NOTHING`,
      [versionId, org, skillId, `pkg-${digest}`, digest]);
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4) ON CONFLICT (version_id,path) DO NOTHING`,
      [org, versionId, content, digest]);
    await c.query("SELECT wave2_publish_skill_version($1,$2)", [org, versionId]);
  });
  return versionId;
}

/** 平台组织（`org-platform`）下某个官方 stable_name 的已发布版本 id —— 4j 补种出来的那一行。 */
async function platformVersionId(stableName: string): Promise<string> {
  const found = await asOwner((c) => c.query<{ id: string }>(
    `SELECT v.id FROM skill_versions v JOIN skills sk ON sk.id=v.skill_id AND sk.org_id=v.org_id
      WHERE v.org_id=$1 AND sk.stable_name=$2 AND v.published=true ORDER BY v.created_at DESC LIMIT 1`,
    [PLATFORM_ORG_ID, stableName]));
  const id = found.rows[0]?.id;
  if (!id) throw new Error(`4j 补种没有产出平台 skill ${stableName}——车道前置步骤失败，不是本用例的结论`);
  return id;
}

beforeAll(async () => {
  await ensureDatabase();
  await migrateOnce();
  // 4i/4j —— deploy.sh 上那两步（`backfill-platform-org.ts` / `backfill-platform-skills.ts`）。
  // DevApp 的重名之所以存在，正是因为组织在这两步之前就自己装过同名 skill。
  await backfillPlatformOrg();
  await backfillPlatformSkills();

  await seedOrg({ orgId: org, projectId: `project-${org}` });
  await addOrgMember(org, "actor", "consultant", null);
  await addChatThread({ orgId: org, id: thread, projectId: null, visibilityScope: "private", createdBy: "actor" });
  await addChatMessage({ orgId: org, id: message, threadId: thread, body: "hi", authorId: "actor" });
  const agent = `agent-${org}`, version = `version-${org}`;
  await asApp(org, async (c) => {
    await c.query(
      `INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES($1,$2,'lane','Lane','enabled','actor',now(),now())`, [agent, org]);
    await c.query(
      `INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,
         skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES($1,$2,$3,'v1',$4,'pinned','{}','deep-agent','native','[]','actor',now(),now())`,
      [version, org, agent, createHash("sha256").update("pinned").digest("hex")]);
    await c.query(
      `INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,
         skill_version_ids,model_provider,model_id,status)
       VALUES($1,$2,$3,$4,$5,$6,'[]','deep-agent','native','queued')`,
      [parent, org, thread, message, agent, version]);
    await c.query(
      `UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,
         lease_expires_at=now()+interval '10 minutes' WHERE id=$1`, [parent]);
    await c.query(
      `INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at)
       VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())`, [randomUUID(), org, parent]);
  });

  db = new PgDatabase(appConfig());
  root = await mkdtemp(join(tmpdir(), "wx-native-lane-"));

  // 真实的隔离沙箱会话容器：HTTP over UDS，经 `docker exec` 中继（与
  // `native-full-chain.test.ts` / `native_sandbox_fixture.py` 同一段中继源码，不另写一份）。
  const container = process.env.WX_NATIVE_SANDBOX_CONTAINER;
  if (!container) throw new Error("native runtime lane requires an owned WX_NATIVE_SANDBOX_CONTAINER");
  const fixture = await readFile(join(workspace, "apps/deep-agent-service/tests/native_sandbox_fixture.py"), "utf8");
  const relayCode = fixture.split('_UDS_RELAY = r"""')[1]?.split('"""')[0];
  if (!relayCode) throw new Error("relay source missing");
  socket = join(root, "sandbox.sock");
  relay = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk as string;
      const output = JSON.parse(await processRun("docker", ["exec", "-i", container, "node", "-e", relayCode],
        JSON.stringify({ method: req.method, path: req.url, headers: req.headers, body }))) as
        { status: number; body: string };
      res.writeHead(output.status, { "content-type": "application/json" });
      res.end(output.body);
    } catch { res.writeHead(503); res.end("{}"); }
  });
  await new Promise<void>((resolve) => relay!.listen(socket, resolve));
}, 180_000);

afterAll(async () => {
  await db?.close();
  if (relay) await new Promise<void>((resolve, reject) => relay!.close((e) => (e ? reject(e) : resolve())));
  await resetOrgs(org);
  await rm(root, { recursive: true, force: true });
});

function nativeInput(skills: ModelCallInput["skills"]): ModelCallInput {
  return {
    modelProvider: "deep-agent", modelId: "native", system: "", user: "你好",
    orgId: org, runId: parent, executionAttemptId: `${parent}:0`, executionLeaseEpoch: 1,
    onSkillActivity: async () => {}, onRemoteRunStarted: async () => {}, skills,
  };
}

function owner(): PgNativeSessionOwner {
  return new PgNativeSessionOwner(
    db, new PgParentRunControlReader(db), createNativeSessionTransport(socket), "c".repeat(64),
    new PgNativeRunInputs(db, new FsObjectStore(root), {
      repo: new PgIdentityRepository(db), ids: { next: () => randomUUID() }, chat: new PgChatRepository(db),
    }));
}

/* ══════════════════════════════════════════════════════════════════════════════════
 * 唯一用例：DevApp 那天的数据形态，走真实的 pins 读取 → 绑定 → 真实沙箱 provision。
 * 三种坏行同时在库里，跟 DevApp 现场一样——不是三个互相独立的干净场景。
 * ═════════════════════════════════════════════════════════════════════════════════ */
it(
  "#3052 一个带遗留坏数据的组织，在 KERNEL_NATIVE_RUNTIME=1 下仍能把真实 pins 绑上真实沙箱会话",
  async () => {
    /* ① #3051 的数据形态：组织在 4j 之前自己装过的同名 `pdf-create`。 */
    const duplicateVersion = await seedOrgSkill(
      "skill-org-legacy-pdf", "pdf-create", "PDF 导出（组织自己装的旧版）", UPSTREAM_SKILL_MD);
    const platformPdf = await platformVersionId("pdf-create");

    /* ② #3058 的数据形态：URL 导入留下的 `sk_<uuid>`，以及一个中文展示名派生出的坏名。 */
    const legacyId = `sk_${randomUUID()}`;
    const legacyVersion = await seedOrgSkill(
      "skill-org-url-import", legacyId, "第三方导入的 PDF 工具", UPSTREAM_SKILL_MD);
    const cjkVersion = await seedOrgSkill(
      "skill-org-cjk", "报告生成器", "报告生成器", UPSTREAM_SKILL_MD);

    // 迁移 `*_skill_stable_name_conformance` 在 beforeAll 的 migrateOnce 里已经跑过，
    // 那时这三行还不存在——DevApp 上的顺序恰恰相反（行先在，迁移后到）。把版本表里
    // 该行删掉再跑一次真实 migrator，就是"库里已有坏行时这条迁移会做什么"。
    // ⚠ 撤掉 #3058 时这条 DELETE 命中 0 行、migrator 也没有这个文件可跑 —— 于是坏行
    //   原样留着，红在下面的 `bindNativeInvocation`，而不是红在"文件找不到"。
    await asOwner((c) => c.query(
      "DELETE FROM _kernel_migrations WHERE name LIKE '%skill_stable_name_conformance%'"));
    await migrateOnce();

    /* ── 真实读取：这一步就是 DevApp 上把两份 `pdf-create` 一起读回来的那条查询 ── */
    const repo = new PgAgentRunRepository(db);
    const versionIds = [platformPdf, duplicateVersion, legacyVersion, cjkVersion];
    const pinned = await repo.readPinnedSkills(org, versionIds);
    expect(pinned, "readPinnedSkills 必须把平台副本和组织副本一起读回——这正是 #3051 的前提")
      .toHaveLength(versionIds.length);
    expect(pinned.filter((p) => p.stableName === "pdf-create"), "两份同名 pdf-create 必须都在")
      .toHaveLength(2);

    const conforming = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    for (const pin of pinned) {
      expect(pin.stableName, `遗留行 ${pin.versionId} 的 stable_name 仍不合规（#3058 的迁移没生效）`)
        .toMatch(conforming);
    }

    /* ── 真实绑定 + 真实沙箱 provision：撤掉 #3051 时这里抛 invalid native package set ── */
    const o = owner();
    const bound = await bindNativeInvocation(o, nativeInput(
      pinned.map((p) => ({ versionId: p.versionId, stableName: p.stableName, name: p.name, content: p.content, package: p.package }))));
    try {
      expect(bound.input.nativeSession?.bindingId, "原生会话必须真的建起来").toBeTruthy();
      expect(bound.input.nativeSession?.profile).toBe("native-v1");
      const resolved = await o.resolve(bound.input.nativeSession!.bindingId, {
        orgId: org, parentRunId: parent, attemptId: `${parent}:0`, leaseEpoch: 1 });
      expect(resolved.sessionId, "真实沙箱容器必须真的返回了一个会话").toBeTruthy();
      console.log(JSON.stringify({
        lane: "native-runtime", KERNEL_NATIVE_RUNTIME: process.env.KERNEL_NATIVE_RUNTIME,
        pinsRead: pinned.length, stableNames: pinned.map((p) => p.stableName),
        sessionId: resolved.sessionId,
      }));
    } finally {
      await bound.release?.();
      await o.releaseForRun(org, parent).catch(() => {});
    }
  },
  240_000,
);
