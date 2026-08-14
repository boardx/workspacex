/**
 * F155 L3 —— **权限约束**的真栈反证（verification.md V4/V5），外加
 * `scripts/lint-permission-paths.mjs` 里那条豁免条目的三条载荷断言。
 *
 * ## 这个文件同时是那条豁免的「不可只是声明」的那一半
 *
 * `pg-file-retrieval.ts` 走的是 allowlist：判权不是 `guard()`/`disclose()`，而是**编译进
 * WHERE 子句的谓词**（已签 delta §3.1 明确选的机制，理由见 lint 脚本里那条条目的正文）。
 * 本仓对这种豁免的既有纪律是「⚠ 豁免仅在 X 成立时有效，因此不留成一句声明：某测试解析该
 * 文件并在 X 消失时变红」。这里就是那个测试：既在真库上反证越权行召不回来，也解析源码
 * 断言两条 SELECT 的 scope 谓词没有被悄悄削掉。
 *
 * ## 为什么真库反证不能省
 *
 * 「SQL 谓词自带判权」这句话，只有让一个**真的没有权限的 actor** 去查一份**真的存在的**
 * 文件、并且真的查不到，才算被证明。解析源码只能证明那几行字还在，证明不了它们的语义。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgFileRetrieval } from "../../src/infrastructure/agent-run/pg-file-retrieval";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f155-scope";
const PROJECT_A = "proj-f155-a";
const PROJECT_B = "proj-f155-b";
const THREAD_A = "thr-f155-a";          // 项目 A 的全场线程
const THREAD_A_PRIVATE = "thr-f155-ap"; // 项目 A 的组内共享线程（非全场 ⇒ 受限）
const THREAD_B = "thr-f155-b";          // 项目 B 的全场线程
const THREAD_P_ALICE = "thr-f155-pa";   // alice 的个人线程（无项目）
const THREAD_P_BOB = "thr-f155-pb";     // bob 的个人线程（无项目）

const ALICE = "u-f155-alice";
const BOB = "u-f155-bob";

const CODE_A = "MARLIN3311";      // 项目 A 全场线程里的附件
const CODE_A_PRIVATE = "TAPIR7788"; // 项目 A 私聊线程里的附件
const CODE_ALICE = "IBIS2255";    // alice 个人线程里的附件
const CODE_BOB = "LEMUR6644";     // bob 个人线程里的附件

let db: PgDatabase;
let files: PgFileRetrieval;

async function addExtractedAttachment(opts: {
  id: string; threadId: string; messageId: string; filename: string; excerpt: string;
}): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO chat_message_attachments
         (id, org_id, thread_id, message_id, storage_ref, filename, mime, bytes,
          extraction_status, extracted_excerpt)
       VALUES ($1,$2,$3,$4,$5,$6,'text/markdown',512,'extracted',$7)`,
      [opts.id, ORG, opts.threadId, opts.messageId, `s3://${opts.id}`, opts.filename, opts.excerpt],
    ),
  );
}

async function seedThreadWithAttachment(opts: {
  threadId: string; projectId: string | null; visibility: string; owner: string;
  code: string; suffix: string;
}): Promise<void> {
  await addChatThread({
    orgId: ORG, id: opts.threadId, projectId: opts.projectId,
    visibilityScope: opts.visibility, createdBy: opts.owner,
  });
  const msgId = `f155s-m-${opts.suffix}`;
  await addChatMessage({
    orgId: ORG, id: msgId, threadId: opts.threadId, body: "我传了一份文件", authorId: opts.owner,
  });
  await addExtractedAttachment({
    id: `att-f155s-${opts.suffix}`, threadId: opts.threadId, messageId: msgId,
    filename: `doc-${opts.suffix}.md`,
    excerpt: `这份文件的内部代号是 ${opts.code}，正文若干。`,
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  files = new PgFileRetrieval(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT_A });
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, kind, status) VALUES ($1,$2,$3,'workshop','active')",
      [PROJECT_B, ORG, "F155 项目 B"]));
  await addOrgMember(ORG, ALICE, "consultant", null);
  await addOrgMember(ORG, BOB, "consultant", null);
  // alice 只在项目 A；bob 只在项目 B。这是 V4 的构造本身。
  await addProjectMember(ORG, PROJECT_A, ALICE, "member", null);
  await addProjectMember(ORG, PROJECT_B, BOB, "member", null);

  await seedThreadWithAttachment({
    threadId: THREAD_A, projectId: PROJECT_A, visibility: "plenary", owner: ALICE,
    code: CODE_A, suffix: "a",
  });
  await seedThreadWithAttachment({
    threadId: THREAD_A_PRIVATE, projectId: PROJECT_A, visibility: "group-shared", owner: ALICE,
    code: CODE_A_PRIVATE, suffix: "ap",
  });
  await addChatThread({
    orgId: ORG, id: THREAD_B, projectId: PROJECT_B, visibilityScope: "plenary", createdBy: BOB,
  });
  await seedThreadWithAttachment({
    threadId: THREAD_P_ALICE, projectId: null, visibility: "private", owner: ALICE,
    code: CODE_ALICE, suffix: "pa",
  });
  await seedThreadWithAttachment({
    threadId: THREAD_P_BOB, projectId: null, visibility: "private", owner: BOB,
    code: CODE_BOB, suffix: "pb",
  });
});

afterAll(async () => {
  await db.close();
});

describe("F155 L3 检索的权限约束（真库，谓词在 SQL 里）", () => {
  it("V4：项目 A 的附件，项目 B 的成员在自己的线程里怎么问都召不回来", async () => {
    // 前提：这份文件**确实存在且可被召回**——否则下面的「召不回」只是因为索引根本不工作。
    const alice = await files.search(
      toOrgId(ORG), { threadId: THREAD_A, projectId: PROJECT_A, actorUserId: ALICE }, CODE_A, 5);
    expect(alice.map((h) => h.text).join("")).toContain(CODE_A);

    const bob = await files.search(
      toOrgId(ORG), { threadId: THREAD_B, projectId: PROJECT_B, actorUserId: BOB }, CODE_A, 5);
    expect(bob).toEqual([]);
  });

  it("V4-b：同项目但非成员 —— 项目成员资格是查询条件，不是事后过滤", async () => {
    // bob 不是项目 A 的成员。即使把 scope 里的 projectId 填成项目 A（相当于伪造一次越权调用），
    // `EXISTS(project_memberships)` 谓词让这些行根本查不出来。
    const forged = await files.search(
      toOrgId(ORG), { threadId: THREAD_A, projectId: PROJECT_A, actorUserId: BOB }, CODE_A, 5);
    expect(forged).toEqual([]);
  });

  it("V4-c：受限可见性线程（group-shared，非全场）的附件，同项目成员也召不回来（fail closed）", async () => {
    // alice 是项目 A 成员、也是那条组内共享线程的创建者，但她**这次 run 不在那条线程里**。
    // 完整的两层可见性判定住在 domain/chat/thread-visibility.ts，本检索路径不复制它，
    // 因此对非本线程的受限线程一律不召回——方向是少召回（GAP-CE-FTS-SCOPE-GROUP-VISIBILITY）。
    const fromPlenary = await files.search(
      toOrgId(ORG), { threadId: THREAD_A, projectId: PROJECT_A, actorUserId: ALICE },
      CODE_A_PRIVATE, 5);
    expect(fromPlenary).toEqual([]);

    // 反证这条收窄不是「索引坏了」：在那条线程**自己**里，同一份附件是召得回来的。
    const inOwnThread = await files.search(
      toOrgId(ORG), { threadId: THREAD_A_PRIVATE, projectId: PROJECT_A, actorUserId: ALICE },
      CODE_A_PRIVATE, 5);
    expect(inOwnThread.map((h) => h.text).join("")).toContain(CODE_A_PRIVATE);
  });

  it("V5：个人线程只召回自己这条线程的附件（own_attachment_retrieval），跨范围恒零", async () => {
    const scope = { threadId: THREAD_P_ALICE, projectId: null, actorUserId: ALICE };

    // ① own_attachment_retrieval —— 自己这条线程自己传的文件，召得回来（F156 delta 的修订边界）。
    const own = await files.search(toOrgId(ORG), scope, CODE_ALICE, 5);
    expect(own.length).toBeGreaterThan(0);
    expect(own.map((h) => h.text).join("")).toContain(CODE_ALICE);
    expect(own.every((h) => h.kind === "chat-attachment")).toBe(true);

    // ② cross_scope_retrieval_requests == 0 —— 项目数据一条都不召回（这条**不放宽**）。
    const crossProject = await files.search(toOrgId(ORG), scope, CODE_A, 5);
    expect(crossProject).toEqual([]);

    // ③ 别人的个人线程同样零召回（个人线程仅创建者可见）。
    const otherPersonal = await files.search(toOrgId(ORG), scope, CODE_BOB, 5);
    expect(otherPersonal).toEqual([]);

    // ④ 反向：bob 在自己的个人线程里，召不回 alice 的个人线程附件。
    const bobScope = { threadId: THREAD_P_BOB, projectId: null, actorUserId: BOB };
    expect(await files.search(toOrgId(ORG), bobScope, CODE_ALICE, 5)).toEqual([]);
    expect((await files.search(toOrgId(ORG), bobScope, CODE_BOB, 5)).length).toBeGreaterThan(0);
  });

  it("V5-b：个人线程的 scope 不接受「拿别人的线程 id 当自己的」——created_by 也是谓词的一部分", async () => {
    // bob 拿着 alice 的个人线程 id 发起检索（伪造一次越权调用）：`t.created_by = $5` 不满足。
    const forged = await files.search(
      toOrgId(ORG), { threadId: THREAD_P_ALICE, projectId: null, actorUserId: BOB }, CODE_ALICE, 5);
    expect(forged).toEqual([]);
  });
});

/**
 * lint-permission-paths.mjs 那条豁免条目声明的三件事。任何一件被悄悄改掉，这里变红。
 * （条目正文里逐字写着「那个测试若被删除，本条目必须一并删除」——就是本段。）
 */
describe("F155 —— pg-file-retrieval 的 allowlist 豁免载荷", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../src/infrastructure/agent-run/pg-file-retrieval.ts", import.meta.url)),
    "utf8",
  );
  /** 只看 SQL 常量那一段，避免把文件头注释里出现的表名当成一条查询。 */
  const sql = source.slice(source.indexOf("const SEARCH_SQL"), source.indexOf("export class"));

  it("(a) 不出现四张允许之外的任何租户表", () => {
    const allowed = new Set([
      "chat_message_attachments", "chat_artifact_landings", "chat_threads", "project_memberships",
      // `q` 不是表，是本查询自己的 CTE（`WITH q AS (SELECT plainto_tsquery(...))`）——
      // 它不读任何行，只把 tsquery 算一次给两条 SELECT 共用。
      "q",
    ]);
    const named = new Set(
      [...sql.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]!.toLowerCase()),
    );
    for (const t of named) expect(allowed.has(t), `未预期的表：${t}`).toBe(true);
  });

  it("(b) 从不使用 withoutTenant（RLS 是这条路径的租户隔离底座）", () => {
    expect(source).not.toContain("withoutTenant");
  });

  it("(c) 两条 SELECT 的 scope 谓词都同时带着个人线程分支与项目成员资格 EXISTS 子句", () => {
    // 两类「文件」各一条 SELECT ⇒ 每个谓词片段恰好各出现两次。少一次就意味着某一类文件
    // 的召回绕过了判权——那正是 verification V4 要防的越权。
    const personalBranch = sql.match(/t\.project_id IS NULL AND t\.created_by = \$5/g) ?? [];
    const membershipExists = sql.match(/EXISTS \(SELECT 1 FROM project_memberships pm/g) ?? [];
    expect(personalBranch.length).toBe(2);
    expect(membershipExists.length).toBe(2);
  });
});
