/**
 * F04（phase-11，issue #1649）—— `mergeThemes` 的唯一反例守护（uc-6-5 R12 V4，R4 E4）。
 *
 * ## 触发场景：同一受访者出现在两个待合并主题里，"先到先得"裁决落在错的一边
 *
 * `merge-themes.ts` 头注已说明：merge 不是简单并集——若某位受访者在多个待合并主题下
 * 都有证据，只有 `themeIds` 请求顺序里**排在前面**的主题拿下这位受访者的证据归属。
 * 本文件构造的正是这种冲突：受访者的**唯一反例**恰好落在"输"的那个主题里，安全的
 * 强证据落在"赢"的那个主题里——合并后受访者的反例状态会消失，`guardCounterexamplePreservation`
 * 必须在真正写库前拦下来，`preview:true` 必须诚实地把这件事显示给调用方。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg, asApp } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgThemeRepository } from "../../src/infrastructure/interview/pg-theme-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { mergeThemes } from "../../src/application/interview/merge-themes";
import { CounterexampleWouldVanishError } from "../../src/application/interview/errors";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1649-merge-guard";
const ORG_ID = toOrgId(ORG);
const RESEARCHER = "u-i1649-guard-researcher";
const INTERVIEW_ID = "itv-i1649-guard-session";

const db = new PgDatabase(appConfig());
const themes = new PgThemeRepository(db);
const ids = new UuidIdFactory();
const deps = { themes, ids };

async function seedTheme(themeId: string, label: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_themes (id, org_id, label, status, created_by) VALUES ($1,$2,$3,'active',$4)`,
      [themeId, ORG, label, RESEARCHER],
    ),
  );
}

async function seedQuote(
  quoteId: string,
  subjectId: string,
  text: string,
  opts: { isCounterexample?: boolean; weight?: number } = {},
): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_quotes
         (id, org_id, interview_id, segment_id, subject_id, source_kind, text, rq_id,
          created_by, weight, is_counterexample)
       VALUES ($1,$2,$3,$4,$5,'human',$6,NULL,$7,$8,$9)`,
      [quoteId, ORG, INTERVIEW_ID, `seg-${quoteId}`, subjectId, text, RESEARCHER, opts.weight ?? 1, opts.isCounterexample ?? false],
    ),
  );
}

async function seedInsight(insightId: string, themeId: string, quoteId: string, text: string): Promise<void> {
  const snapshotId = `${insightId}-snap`;
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_insight_source_snapshots (id, org_id, quotes) VALUES ($1,$2,$3::jsonb)`,
      [snapshotId, ORG, JSON.stringify([{ quoteId, text }])],
    ),
  );
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_insights
         (id, org_id, interview_id, text, source_kind, strong, evidence_quote_ids,
          pinned_source_snapshot_id, excluded_subject_ids, created_by, theme_id)
       VALUES ($1,$2,$3,$4,'human',false,$5::text[],$6,'{}',$7,$8)`,
      [insightId, ORG, INTERVIEW_ID, text, [quoteId], snapshotId, RESEARCHER, themeId],
    ),
  );
}

async function themeIdOf(insightId: string): Promise<string | null> {
  const r = await asApp(ORG, (c) =>
    c.query(`SELECT theme_id FROM interview_insights WHERE org_id=$1 AND id=$2`, [ORG, insightId]),
  );
  return (r.rows[0] as { theme_id: string | null } | undefined)?.theme_id ?? null;
}

async function themeStatusOf(themeId: string): Promise<string | null> {
  const r = await asApp(ORG, (c) =>
    c.query(`SELECT status FROM interview_themes WHERE org_id=$1 AND id=$2`, [ORG, themeId]),
  );
  return (r.rows[0] as { status: string } | undefined)?.status ?? null;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

describe("F04 mergeThemes —— 唯一反例守护（preview 预警 + preview:false 阻断）", () => {
  beforeAll(async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG_ID, projectId: "proj-i1649-guard" });
  });

  it("V4：preview:true 如实报告 vanishingCells，且不写库", async () => {
    await seedTheme("theme-win1", "赢家主题（排第一）");
    await seedTheme("theme-lose1", "输家主题（排第二，反例在这）");
    // 同一受访者 subj-shared1：赢家主题下是普通强证据，输家主题下是唯一反例。
    await seedQuote("q-win1", "subj-shared1", "受访者的普通证据");
    await seedQuote("q-lose1", "subj-shared1", "受访者的唯一反例", { isCounterexample: true });
    await seedInsight("insight-win1", "theme-win1", "q-win1", "赢家主题下的洞察");
    await seedInsight("insight-lose1", "theme-lose1", "q-lose1", "输家主题下的反例洞察");

    const preview = await mergeThemes(deps, {
      orgId: ORG_ID, actorId: RESEARCHER, themeIds: ["theme-win1", "theme-lose1"], preview: true,
    });

    expect(preview.mergedThemeId).toBeNull();
    expect(preview.revertToken).toBeNull();
    expect(preview.vanishingCells).toHaveLength(1);
    expect(preview.vanishingCells[0]).toEqual({
      themeId: "theme-lose1", subjectId: "subj-shared1", counterexample: true,
    });

    // preview 不写库：两个主题仍是 active，洞察仍挂在原主题下。
    expect(await themeStatusOf("theme-win1")).toBe("active");
    expect(await themeStatusOf("theme-lose1")).toBe("active");
    expect(await themeIdOf("insight-win1")).toBe("theme-win1");
    expect(await themeIdOf("insight-lose1")).toBe("theme-lose1");
  });

  it("V4：preview:false 在同样的场景下真正阻断 ⇒ COUNTEREXAMPLE_WOULD_VANISH，不写库", async () => {
    await seedTheme("theme-win2", "赢家主题（排第一）");
    await seedTheme("theme-lose2", "输家主题（排第二，反例在这）");
    await seedQuote("q-win2", "subj-shared2", "受访者的普通证据");
    await seedQuote("q-lose2", "subj-shared2", "受访者的唯一反例", { isCounterexample: true });
    await seedInsight("insight-win2", "theme-win2", "q-win2", "赢家主题下的洞察");
    await seedInsight("insight-lose2", "theme-lose2", "q-lose2", "输家主题下的反例洞察");

    await expect(
      mergeThemes(deps, {
        orgId: ORG_ID, actorId: RESEARCHER, themeIds: ["theme-win2", "theme-lose2"], preview: false,
      }),
    ).rejects.toBeInstanceOf(CounterexampleWouldVanishError);

    // 阻断意味着两个主题都原样保持 active，没有半截合并的痕迹。
    expect(await themeStatusOf("theme-win2")).toBe("active");
    expect(await themeStatusOf("theme-lose2")).toBe("active");
    expect(await themeIdOf("insight-win2")).toBe("theme-win2");
    expect(await themeIdOf("insight-lose2")).toBe("theme-lose2");
  });

  it("对照组：交换合并顺序，反例主题排第一 ⇒ 反例胜出裁决，合并安全放行", async () => {
    await seedTheme("theme-lose3", "原输家主题（这次排第一，反例胜出）");
    await seedTheme("theme-win3", "原赢家主题（这次排第二）");
    await seedQuote("q-lose3", "subj-shared3", "受访者的唯一反例", { isCounterexample: true });
    await seedQuote("q-win3", "subj-shared3", "受访者的普通证据");
    await seedInsight("insight-lose3", "theme-lose3", "q-lose3", "反例洞察");
    await seedInsight("insight-win3", "theme-win3", "q-win3", "普通洞察");

    const merged = await mergeThemes(deps, {
      orgId: ORG_ID, actorId: RESEARCHER, themeIds: ["theme-lose3", "theme-win3"], preview: false,
    });

    expect(merged.vanishingCells).toEqual([]);
    expect(merged.mergedThemeId).not.toBeNull();
    // 反例证据的洞察整体搬进合并主题；输掉裁决的普通证据洞察退回未整理池（theme_id=NULL），
    // 不是被静默丢弃或抹掉的证据——它仍然可查，只是不再计入这次合并的结果。
    expect(await themeIdOf("insight-lose3")).toBe(merged.mergedThemeId);
    expect(await themeIdOf("insight-win3")).toBeNull();
  });
});
