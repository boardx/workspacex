/**
 * F93 -- the per-speaker Context Pack front-filter (O-05), wired into the real assembly path
 * (`application/retrieval/retrieve-candidates.ts`), through the real PostgreSQL retriever.
 *
 * Where `consent-per-speaker-prefilter.test.ts` proves the pure decision, this file proves the
 * WIRING: a segment attributed (`segment_text.speaker_subject_id`) to a subject whose
 * `ai_analysis` bit is declined never reaches `ranked[]` -- i.e. it can never become a
 * `ContextItem` and can never be cited by the AI pipelines this Context Pack feeds (T23 副驾驶,
 * T26/T27 归纳). The `user_visible_behavior` this issue promises is proved by rerunning with the
 * consent bit flipped: the SAME segment appears once its subject is no longer declined, which is
 * only true of a front-filter and would be false of an exit mask applied to a cached response.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { omissionReason as OR } from "@repo/contracts";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { IdentityRerank, TableEmbedding, indexSegment, registerEmbeddingModel } from "../support/retrieval-fixtures";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgSegmentRetriever } from "../../src/infrastructure/retrieval/pg-segment-retriever";
import { retrieveCandidates, type RetrieveDeps } from "../../src/application/retrieval/retrieve-candidates";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f93-consent-pf";
const PROJECT = "proj-f93-consent-pf";
const MODEL = { model: "fixture-embed-f93", modelVersion: "1" };

let db: PgDatabase;
let deps: RetrieveDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db),
    ids: new CountingDecisionIdFactory(),
    retriever: new PgSegmentRetriever(db),
    embeddings: new TableEmbedding(MODEL.model, MODEL.modelVersion, { 责任归属: [1, 0, 0, 0] }),
    rerank: new IdentityRerank(),
  } as RetrieveDeps;
  await registerEmbeddingModel(MODEL.model, MODEL.modelVersion, 4);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-researcher", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-researcher", "facilitator", null);
});

const run = (declinedSpeakerSubjectIds?: ReadonlySet<string>) =>
  retrieveCandidates(deps, {
    userId: "u-researcher",
    orgId: toOrgId(ORG),
    projectId: PROJECT,
    task: "answer",
    query: "责任归属",
    timeRange: null,
    limit: 20,
    declinedSpeakerSubjectIds,
  });

describe("F93 / O-05 -- Context Pack 前置过滤把拒绝 AI 分析的受访者片段挡在装配之前", () => {
  it("拒绝 AI 分析的受访者的片段不出现在 ranked[]，且以 unauthorized 留痕，不泄露内容", async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-declined", artifactId: "a-declined", projectId: PROJECT,
      content: "责任归属：P-11 说这件事不该我负责。", speakerSubjectId: "subj-p11",
    });
    await indexSegment({
      orgId: ORG, segmentId: "s-authorized", artifactId: "a-authorized", projectId: PROJECT,
      content: "责任归属：P-04 说流程上确实卡在这里。", speakerSubjectId: "subj-p04",
    });

    const out = await run(new Set(["subj-p11"]));

    expect(out.ranked.map((r) => r.row.segmentId)).toEqual(["s-authorized"]);
    expect(out.ranked.map((r) => r.row.segmentId)).not.toContain("s-declined");

    const om = out.omissions.find((o) => o.ref === "s-declined");
    expect(om).toBeDefined();
    expect(om?.reason).toBe("unauthorized");
    expect(om?.compliance).toBe(true); // I-4 的同一条纪律：合规性丢弃恒可见，不因折叠而消失。
    expect(om?.explain).toBe(OR.omissionExplain("unauthorized"));
    // 内容不通过任何字段泄露 -- 与 F10 对被拒授权文档的同一条纪律。
    expect(JSON.stringify(out)).not.toContain("不该我负责");

    // 留痕：本次运行排除了哪些受访者（类别与去重名单，不是逐条 segment）。
    expect(out.consentExcludedSubjectIds).toEqual(["subj-p11"]);
  });

  it("反证：把同意位改为「是」后重跑（declined 名单不再含该受访者），其片段才出现 -- 证明是前置过滤而非出口遮盖", async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-flip", artifactId: "a-flip", projectId: PROJECT,
      content: "责任归属：P-12 提供了反例。", speakerSubjectId: "subj-p12",
    });

    const before = await run(new Set(["subj-p12"]));
    expect(before.ranked.map((r) => r.row.segmentId)).not.toContain("s-flip");

    // 同一条查询、同一段数据 -- 唯一变化的是调用方现在传入的同意位事实。一个「出口遮盖」实现
    // （例如缓存了装配结果再按同意位过滤展示）在这里会继续隐藏该片段；前置过滤不会。
    const after = await run(new Set());
    expect(after.ranked.map((r) => r.row.segmentId)).toContain("s-flip");
    expect(after.omissions.find((o) => o.ref === "s-flip")).toBeUndefined();
    expect(after.consentExcludedSubjectIds).toEqual([]);
  });

  it("counter-proof: 没有归属到任何受访者的普通材料（speakerSubjectId = null）永远不受此过滤影响", async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-file", artifactId: "a-file", projectId: PROJECT,
      content: "责任归属：项目章程原文摘录。",
    });
    const out = await run(new Set(["subj-p11", "subj-anyone"]));
    expect(out.ranked.map((r) => r.row.segmentId)).toContain("s-file");
  });

  it("counter-proof: declined 名单为空时（全体已授权），什么都不被排除", async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-both-ok", artifactId: "a-both-ok", projectId: PROJECT,
      content: "责任归属：P-07 的原话。", speakerSubjectId: "subj-p07",
    });
    const out = await run();
    expect(out.ranked.map((r) => r.row.segmentId)).toContain("s-both-ok");
    expect(out.consentExcludedSubjectIds).toEqual([]);
  });
});
