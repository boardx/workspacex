/**
 * 让 `lint-permission-paths` 对 `pg-attachment-extraction-repository.ts` 的豁免**成立**的门
 * （#946 F153/W1，V9-b）。同 `tests/files/ingestion-repo-metadata-only.test.ts` 的形状：linter 的
 * 白名单条目对这个文件断言了几件事，这里把它们**执行**而不是信任——豁免的前提会在有人把
 * `readAttachment` 的 SELECT 拓宽到也返回 `filename`/`bytes`（去驱动某个未来界面）时悄悄失真，而
 * linter 因为文件已在白名单里保持沉默。
 *
 *   1. 文件里没有任何语句用 `withoutTenant`——每条读写都带显式 `org_id` 谓词。
 *   2. 每个方法的**实际返回值**（对真库核对，不只看源码）只带 worker 输入/作业元数据：
 *      outbox 作业 ⊆ {jobId, attachmentId, attempts}；`readAttachment` ⊆ {storageRef, mime}。
 *      绝不返回 filename / bytes / extracted_excerpt / 任何面向用户的内容。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAttachmentExtractionRepository } from "../../src/infrastructure/chat/pg-attachment-extraction-repository";
import { toOrgId } from "../../src/domain/org-id";

const FILE = fileURLToPath(new URL("../../src/infrastructure/chat/pg-attachment-extraction-repository.ts", import.meta.url));

describe("static: 没有语句绕过租户 scope，且白名单条目在位", () => {
  it("文件从不 CALL withoutTenant（注释里提到名字无妨）", () => {
    const codeLines = readFileSync(FILE, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));
    const callSites = codeLines.filter((line) => /\bwithoutTenant\s*\(/.test(line));
    expect(callSites, `withoutTenant(...) called at:\n  ${callSites.join("\n  ")}`).toEqual([]);
  });

  it("lint 白名单条目在位，且指名本文件 + 本测试", () => {
    const lint = readFileSync(fileURLToPath(new URL("../../scripts/lint-permission-paths.mjs", import.meta.url)), "utf8");
    expect(lint).toContain("src/infrastructure/chat/pg-attachment-extraction-repository.ts");
    expect(lint).toContain("attachment-extraction-repo-guard.test.ts");
  });
});

const ORG = "org-f153-repo-guard";
const PROJECT = "proj-f153-rg";
const THREAD = "thr-f153-rg";
const ACTOR = "u-f153-rg";
const JOB_FIELDS = ["jobId", "attachmentId", "attempts"];
const ATTACHMENT_FIELDS = ["storageRef", "mime"];
/** 绝不能从本仓储返回的、面向用户的内容——豁免的全部意义所在。 */
const FORBIDDEN = ["filename", "bytes", "extractedExcerpt", "extracted_excerpt", "extractedRef", "body", "content"];

function assertShape(obj: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(obj)) {
    expect(allowed, `unexpected field '${key}' —— 本仓储必须只回 worker 输入/作业元数据`).toContain(key);
  }
  for (const f of FORBIDDEN) {
    expect(obj, `字段 '${f}' 把内容泄漏进了一个 worker-only 读`).not.toHaveProperty(f);
  }
}

let db: PgDatabase;
let repo: PgAttachmentExtractionRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAttachmentExtractionRepository(db);
});

afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
  await addChatMessage({ orgId: ORG, id: "m1", threadId: THREAD, body: "带附件", authorId: ACTOR });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO chat_message_attachments (id, org_id, thread_id, message_id, storage_ref, filename, mime, bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      ["att-rg", ORG, THREAD, "m1", `chat-attachments/${ORG}/att-rg`, "机密文件名.csv", "text/csv", 42],
    ),
  );
});

describe("runtime: 每个返回形状都是 worker 输入/作业元数据，绝非用户内容", () => {
  it("claimNext ⊆ {jobId, attachmentId, attempts}；readAttachment ⊆ {storageRef, mime}", async () => {
    const org = toOrgId(ORG);
    await repo.enqueue(org, "att-rg");

    const job = await repo.claimNext(org, "guard-worker", 5 * 60 * 1000);
    expect(job).not.toBeNull();
    assertShape(job as unknown as Record<string, unknown>, JOB_FIELDS);

    const att = await repo.readAttachment(org, "att-rg");
    expect(att).not.toBeNull();
    assertShape(att as unknown as Record<string, unknown>, ATTACHMENT_FIELDS);

    // 那个「机密文件名.csv」（filename）绝不能出现在本仓储交回的任何东西里——最强形式的「无内容泄漏」。
    expect(JSON.stringify({ job, att })).not.toContain("机密文件名");
  });
});
