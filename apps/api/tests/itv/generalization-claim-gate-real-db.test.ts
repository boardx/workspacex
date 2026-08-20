/**
 * F05（phase-11，issue #1650）—— 普遍性断言写作约束真正接线到持久化引述。
 *
 * ## 走的是真实的用例 → 真实的仓储 → 真实的 Postgres
 *
 * 复用 F01（phase-06）已合入的 `extractQuotes` 把引述真实落进 `interview_quotes`
 * （同一批引述用同一个 `rqBinding` 串起同一"主题"——`themeId` 在本仓当前实现下
 * 取值就是 `rqId`，见 `insight-ports.ts` `QuoteRepository.listByOrgAndRqId` 端口
 * 头注），再调 `checkGeneralizationClaim` 应用层函数验证它真的从数据库读数、
 * 而不是吃一份手写的进程内数组。
 *
 * ⚠ 纯计数口径（同一人多条只算 1、附和/虚拟不计入）已经在
 *   `domain/interview/generality-claim.ts` 的 `generality-claim-independent-le5.test.ts`
 *   证过（F95）——本文件不重复证那一层，只证"持久化引述真的能喂给它"这一条 F05
 *   新增的编排事实：4 位独立受访者阻断给出实际人数与改写建议，补到 5 位放行，
 *   同一人 3 条只算 1 人，`sourceKind=virtual` 不计入（虚拟来源信号确实持久化在
 *   `interview_quotes.source_kind`，本文件用真实虚拟受访者反证）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { indexSegment } from "../support/retrieval-fixtures";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { PgSegmentReader } from "../../src/infrastructure/interview/pg-segment-reader";
import { PgInterviewQuoteRepository } from "../../src/infrastructure/interview/pg-interview-quote-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { extractQuotes } from "../../src/application/interview/extract-quotes";
import { checkGeneralizationClaim } from "../../src/application/interview/check-generalization-claim";
import { GeneralizationUnsupportedError } from "../../src/application/interview/errors";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1650-generalization";
const ORG_ID = toOrgId(ORG);
const RESEARCHER = "u-i1650-researcher";
const INTERVIEW_ID = "itv-i1650-session";
const THEME_ID = "rq-i1650-responsibility";

const db = new PgDatabase(appConfig());
const scope = new PgInterviewScopeRepository(db);
const segments = new PgSegmentReader(db);
const quotes = new PgInterviewQuoteRepository(db);
const ids = new UuidIdFactory();
const decisions = new UuidDecisionIdFactory();

function extractDeps() {
  return { scope, decisions, segments, quotes, ids };
}

async function seedSubject(subjectId: string, sourceKind: "human" | "virtual"): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_subjects (id, org_id, display_name, source_kind, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [subjectId, ORG, `受访者 ${subjectId}`, sourceKind, RESEARCHER],
    ),
  );
}

async function seedSegment(segmentId: string, content: string, subjectId: string | null): Promise<void> {
  await indexSegment({
    orgId: ORG,
    segmentId,
    artifactId: `art-${segmentId}`,
    content,
    sourceType: "interview",
    speakerSubjectId: subjectId,
    anchor: { kind: "timecode", locator: "00:00:01" },
  });
}

/** 把一条引述真实抽进 `interview_quotes`，绑到 `THEME_ID` 这个 rqId 下。 */
async function extractIntoTheme(segmentId: string): Promise<void> {
  const extracted = await extractQuotes(extractDeps(), {
    orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID,
    segmentIds: [segmentId], rqBinding: THEME_ID,
  });
  expect(extracted.quotes).toHaveLength(1);
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG_ID, projectId: "proj-i1650" });
  await addOrgMember(ORG, RESEARCHER, "consultant", fx.teams.energy ?? null);
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_sessions (id, org_id, source_kind, title, created_by)
       VALUES ($1,$2,'human','U-8 普遍性断言',$3)`,
      [INTERVIEW_ID, ORG, RESEARCHER],
    ),
  );
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

describe("F05 · checkGeneralizationClaim 真接持久化引述（uc-6-5 R3 step7 / R4 E9 / AC7 V7）", () => {
  it("4 位独立受访者时阻断：GENERALIZATION_UNSUPPORTED，携带实际人数与改写建议", async () => {
    for (const n of [1, 2, 3, 4]) {
      const subjectId = `subj-i1650-p${n}`;
      const segmentId = `seg-i1650-p${n}`;
      await seedSubject(subjectId, "human");
      await seedSegment(segmentId, `受访者${n}说：责任归属不清楚。`, subjectId);
      await extractIntoTheme(segmentId);
    }

    const err = await checkGeneralizationClaim(
      { quotes },
      { orgId: ORG_ID, themeId: THEME_ID, draftText: "用户普遍认为责任归属不清" },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GeneralizationUnsupportedError);
    const gate = err as GeneralizationUnsupportedError;
    expect(gate.independentSubjects).toBe(4);
    expect(gate.suggestion).toContain("部分受访者提到");
    expect(gate.suggestion).toContain("4");
  });

  it("补到 5 位独立受访者后同一句放行（不再抛错，返回 blocked:false）", async () => {
    const subjectId = "subj-i1650-p5";
    const segmentId = "seg-i1650-p5";
    await seedSubject(subjectId, "human");
    await seedSegment(segmentId, "受访者5说：责任归属不清楚。", subjectId);
    await extractIntoTheme(segmentId);

    const result = await checkGeneralizationClaim(
      { quotes },
      { orgId: ORG_ID, themeId: THEME_ID, draftText: "用户普遍认为责任归属不清" },
    );

    expect(result).toEqual({ blocked: false, independentSubjects: 5, suggestion: null });
  });

  it("同一人 3 条引述只算 1 人：单独一个主题即便有 3 条持久化引述仍阻断", async () => {
    const soloThemeId = "rq-i1650-solo";
    const subjectId = "subj-i1650-solo";
    await seedSubject(subjectId, "human");
    for (const n of [1, 2, 3]) {
      const segmentId = `seg-i1650-solo-${n}`;
      await seedSegment(segmentId, `受访者反复第 ${n} 次说：责任归属不清楚。`, subjectId);
      const extracted = await extractQuotes(extractDeps(), {
        orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID,
        segmentIds: [segmentId], rqBinding: soloThemeId,
      });
      expect(extracted.quotes).toHaveLength(1);
    }

    const err = await checkGeneralizationClaim(
      { quotes },
      { orgId: ORG_ID, themeId: soloThemeId, draftText: "用户普遍认为责任归属不清" },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GeneralizationUnsupportedError);
    expect((err as GeneralizationUnsupportedError).independentSubjects).toBe(1);
  });

  it("虚拟来源受访者的引述不计入独立受访者数（sourceKind=virtual，反证：若被误计入会放行）", async () => {
    const virtualThemeId = "rq-i1650-virtual";
    for (const n of [1, 2, 3, 4]) {
      const subjectId = `subj-i1650-v-human-${n}`;
      const segmentId = `seg-i1650-v-human-${n}`;
      await seedSubject(subjectId, "human");
      await seedSegment(segmentId, `真人受访者${n}说：责任归属不清楚。`, subjectId);
      await extractQuotes(extractDeps(), {
        orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID,
        segmentIds: [segmentId], rqBinding: virtualThemeId,
      });
    }
    // 第 5 条是虚拟来源——若被误计入独立人数，总数会变成 5 从而错误放行。
    const virtualSubjectId = "subj-i1650-v-virtual-1";
    const virtualSegmentId = "seg-i1650-v-virtual-1";
    await seedSubject(virtualSubjectId, "virtual");
    await seedSegment(virtualSegmentId, "数字人受访者说：责任归属不清楚。", virtualSubjectId);
    await extractQuotes(extractDeps(), {
      orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID,
      segmentIds: [virtualSegmentId], rqBinding: virtualThemeId,
    });

    const err = await checkGeneralizationClaim(
      { quotes },
      { orgId: ORG_ID, themeId: virtualThemeId, draftText: "用户普遍认为责任归属不清" },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GeneralizationUnsupportedError);
    expect((err as GeneralizationUnsupportedError).independentSubjects).toBe(4);
  });

  it("未含普遍性措辞的草稿：即便独立受访者数远低于门槛也不阻断（永不误伤克制表述）", async () => {
    const modestThemeId = "rq-i1650-modest";
    const subjectId = "subj-i1650-modest";
    const segmentId = "seg-i1650-modest";
    await seedSubject(subjectId, "human");
    await seedSegment(segmentId, "受访者说：责任归属不清楚。", subjectId);
    await extractQuotes(extractDeps(), {
      orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID,
      segmentIds: [segmentId], rqBinding: modestThemeId,
    });

    const result = await checkGeneralizationClaim(
      { quotes },
      { orgId: ORG_ID, themeId: modestThemeId, draftText: "部分受访者提到责任归属不清" },
    );

    expect(result).toEqual({ blocked: false, independentSubjects: 1, suggestion: null });
  });

  it("空主题（没有任何持久化引述）：独立受访者数为 0，如实给出 0 而不是省略", async () => {
    const err = await checkGeneralizationClaim(
      { quotes },
      { orgId: ORG_ID, themeId: "rq-i1650-empty", draftText: "用户普遍认为" },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GeneralizationUnsupportedError);
    const gate = err as GeneralizationUnsupportedError;
    expect(gate.independentSubjects).toBe(0);
    expect(gate.suggestion).toContain("0");
  });
});
