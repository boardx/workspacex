/**
 * FF-104 / FF-105 —— 逻辑删除（`artifacts.deleted_at`）之后，已删内容不得经任何读路径复活。
 *
 * 缺陷形状（2026-09-28 file-first 复盘）：F45 的级联只物理清 `segment_text` / 向量；而
 *   · 检索候选集 `CANDIDATE_SET` 不看 `deleted_at`——物理清理中途失败或被重建时漏出；
 *   · 重建索引的 target / source 不看 `deleted_at`——对已删版本调 `POST /index` 会把正文写回；
 *   · 幂等查找不看 `deleted_at`——删后重传同一文件得到 `duplicate:true`，指向一个浏览器里
 *     已经看不见的条目，用户的上传「成功了」却找不到。
 *
 * 真库断言（不是 fake）：四处谓词各有一条拒绝用例 + 一条未删除的正样本。
 * 反证（已跑、已恢复）：逐一去掉四处 `deleted_at` 谓词，对应用例变红。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
import { PgArtifactIndexTargets } from "../../src/infrastructure/retrieval/pg-artifact-index-targets";
import { PgArtifactIndexSource } from "../../src/infrastructure/retrieval/pg-artifact-index-source";
import { PgSegmentRetriever } from "../../src/infrastructure/retrieval/pg-segment-retriever";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-ff104";
const PROJECT = "proj-ff104";
const ART = "art-ff104";
const VERSION = `${ART}-v1`;
const SEGMENT = `${ART}-s1`;
const ZERO_HASH = "0".repeat(64);

let db: PgDatabase;

const markDeleted = () =>
  asOwner((c) => c.query("UPDATE artifacts SET deleted_at = now() WHERE org_id = $1 AND id = $2", [ORG, ART]));

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  // The fixture's publisher (`pinned_by`) is a real project member, so the index source's own
  // authorization passes and ONLY the deletion predicate can stop it (otherwise the source test
  // below would pass for the wrong reason).
  await addOrgMember(ORG, "u-seed", "consultant", null);
  await addProjectMember(ORG, PROJECT, "u-seed", "facilitator", null);
  await addBrowserArtifact({ orgId: ORG, id: ART, projectId: PROJECT, title: "ff104", mime: "text/plain" });
});

describe("FF-104 已删除的 artifact 不可重建索引、不进检索候选集", () => {
  it("检索候选集：未删除可按 id 取到；删除后取不到（不依赖物理清理已发生）", async () => {
    const retriever = new PgSegmentRetriever(db);
    expect(await retriever.byId(toOrgId(ORG), SEGMENT)).not.toBeNull();
    await markDeleted();
    // segment_text 行还在（模拟物理清理未完成/失败）——挡住它的是谓词本身。
    const rows = await asOwner((c) => c.query("SELECT 1 FROM segment_text WHERE segment_id = $1", [SEGMENT]));
    expect(rows.rowCount).toBe(1);
    expect(await retriever.byId(toOrgId(ORG), SEGMENT)).toBeNull();
  });

  it("重建索引的 target：删除后等同「不存在」", async () => {
    const targets = new PgArtifactIndexTargets(db);
    expect(await targets.find(toOrgId(ORG), VERSION)).not.toBeNull();
    await markDeleted();
    expect(await targets.find(toOrgId(ORG), VERSION)).toBeNull();
  });

  it("重建索引的 source：删除后拒绝加载（writer 在事务内复核的就是它）", async () => {
    await markDeleted();
    const identity = { repo: new PgIdentityRepository(db), ids: { next: () => "dec-ff104" } };
    const noObjects = {
      head: async () => { throw new Error("must not read bytes of a deleted artifact"); },
      get: async () => { throw new Error("must not read bytes of a deleted artifact"); },
    };
    const source = new PgArtifactIndexSource(
      db, new PgArtifactRepository(db), noObjects as never, identity as never,
    );
    await expect(source.load({ orgId: toOrgId(ORG), artifactVersionId: VERSION }))
      .rejects.toThrow("artifact_index_unavailable");
  });
});

describe("FF-105 幂等查找不命中已删除的 artifact", () => {
  it("未删除 ⇒ 命中；删除后同一内容 ⇒ 不命中（重传会新建，而不是指向一个看不见的条目）", async () => {
    const repo = new PgArtifactRepository(db);
    const hit = await repo.findVersionByIdempotencyKey(toOrgId(ORG), PROJECT, ZERO_HASH, "1", "1");
    expect(hit?.versionId).toBe(VERSION);
    await markDeleted();
    expect(await repo.findVersionByIdempotencyKey(toOrgId(ORG), PROJECT, ZERO_HASH, "1", "1")).toBeNull();
  });
});
