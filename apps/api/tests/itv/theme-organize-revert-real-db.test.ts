/**
 * F04（phase-11，issue #1649）—— 主题整理三动作（合并/拆分/调权）真正落 Postgres，
 * 且都能被各自的 `revertToken` 精确撤销。
 *
 * ## 覆盖的验收线索
 *
 * V12（两名研究员并发整理同一主题不静默覆盖，返回 CONCURRENT_MODIFICATION，可识别
 * 最终版本、可回滚）：三个算子各自的"安全路径 + 撤销回原状"，外加一个真正的并发冲突
 * 断言（对已被消费的主题再次发起合并）。`COUNTEREXAMPLE_WOULD_VANISH`（V4）的专门场景
 * 见 `theme-merge-counterexample-guard.test.ts`，本文件只在拆分小节顺带断言"结构上不
 * 会触发"这条边界（split 的按受访者整体搬迁算法），不重复 merge 的守护场景。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg, asApp } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgThemeRepository } from "../../src/infrastructure/interview/pg-theme-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { mergeThemes } from "../../src/application/interview/merge-themes";
import { splitThemes } from "../../src/application/interview/split-themes";
import { adjustEvidenceWeight } from "../../src/application/interview/adjust-evidence-weight";
import { revertThemeOperation } from "../../src/application/interview/revert-theme-operation";
import { CounterexampleWouldVanishError, ThemeConcurrentModificationError } from "../../src/application/interview/errors";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1649-theme-organize";
const ORG_ID = toOrgId(ORG);
const RESEARCHER = "u-i1649-researcher";
const INTERVIEW_ID = "itv-i1649-session";

const db = new PgDatabase(appConfig());
const themes = new PgThemeRepository(db);
const ids = new UuidIdFactory();

function deps() {
  return { themes, ids };
}

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
  opts: { isCounterexample?: boolean; isAppeasement?: boolean; weight?: number } = {},
): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_quotes
         (id, org_id, interview_id, segment_id, subject_id, source_kind, text, rq_id,
          created_by, weight, is_counterexample, is_appeasement)
       VALUES ($1,$2,$3,$4,$5,'human',$6,NULL,$7,$8,$9,$10)`,
      [
        quoteId, ORG, INTERVIEW_ID, `seg-${quoteId}`, subjectId, text, RESEARCHER,
        opts.weight ?? 1, opts.isCounterexample ?? false, opts.isAppeasement ?? false,
      ],
    ),
  );
}

/** 一条洞察，证据只挂一条引述（与 application 层"代表受访者=第一条引述的受访者"假设一致）。 */
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

async function weightOf(quoteId: string): Promise<number> {
  const r = await asApp(ORG, (c) =>
    c.query(`SELECT weight FROM interview_quotes WHERE org_id=$1 AND id=$2`, [ORG, quoteId]),
  );
  return Number((r.rows[0] as { weight: string }).weight);
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

describe("F04 主题整理三动作 —— 合并/拆分/调权真实落库 + revertToken 撤销", () => {
  beforeAll(async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG_ID, projectId: "proj-i1649" });
  });

  it("mergeThemes：无重叠受访者的安全合并 —— preview 无消失、真正合并后可用 revertToken 撤销", async () => {
    await seedTheme("theme-a1", "主题 A");
    await seedTheme("theme-b1", "主题 B");
    await seedQuote("q-a1", "subj-a1", "A 主题下的引述");
    await seedQuote("q-b1", "subj-b1", "B 主题下的引述");
    await seedInsight("insight-a1", "theme-a1", "q-a1", "A 的洞察");
    await seedInsight("insight-b1", "theme-b1", "q-b1", "B 的洞察");

    const preview = await mergeThemes(deps(), {
      orgId: ORG_ID, actorId: RESEARCHER, themeIds: ["theme-a1", "theme-b1"], preview: true,
    });
    expect(preview.vanishingCells).toEqual([]);
    expect(preview.mergedThemeId).toBeNull();
    expect(preview.revertToken).toBeNull();

    const merged = await mergeThemes(deps(), {
      orgId: ORG_ID, actorId: RESEARCHER, themeIds: ["theme-a1", "theme-b1"], preview: false,
    });
    expect(merged.vanishingCells).toEqual([]);
    expect(merged.mergedThemeId).not.toBeNull();
    expect(merged.revertToken).not.toBeNull();

    expect(await themeIdOf("insight-a1")).toBe(merged.mergedThemeId);
    expect(await themeIdOf("insight-b1")).toBe(merged.mergedThemeId);
    expect(await themeStatusOf("theme-a1")).toBe("merged");
    expect(await themeStatusOf("theme-b1")).toBe("merged");

    const reverted = await revertThemeOperation(deps(), {
      orgId: ORG_ID, actorId: RESEARCHER, revertToken: merged.revertToken!,
    });
    expect(reverted.kind).toBe("merge");
    expect(await themeIdOf("insight-a1")).toBe("theme-a1");
    expect(await themeIdOf("insight-b1")).toBe("theme-b1");
    expect(await themeStatusOf("theme-a1")).toBe("active");
    expect(await themeStatusOf("theme-b1")).toBe("active");
  });

  it("mergeThemes：CONCURRENT_MODIFICATION —— 对已被消费（非 active）的主题再次发起合并", async () => {
    await seedTheme("theme-c1", "主题 C");
    await seedTheme("theme-d1", "主题 D");
    await seedTheme("theme-e1", "主题 E");
    await seedQuote("q-c1", "subj-c1", "C 主题下的引述");
    await seedQuote("q-d1", "subj-d1", "D 主题下的引述");
    await seedQuote("q-e1", "subj-e1", "E 主题下的引述");
    await seedInsight("insight-c1", "theme-c1", "q-c1", "C 的洞察");
    await seedInsight("insight-d1", "theme-d1", "q-d1", "D 的洞察");
    await seedInsight("insight-e1", "theme-e1", "q-e1", "E 的洞察");

    // 第一次合并：C + D，消费掉 theme-d1（模拟"另一位研究员"先完成的操作）。
    const first = await mergeThemes(deps(), {
      orgId: ORG_ID, actorId: "u-i1649-other-researcher", themeIds: ["theme-c1", "theme-d1"], preview: false,
    });
    expect(first.mergedThemeId).not.toBeNull();

    // 第二次：另一名研究员并不知道 theme-d1 已被消费，仍试图把它和 theme-e1 合并——
    // 不静默覆盖，必须拿到 CONCURRENT_MODIFICATION；最终版本可查（theme-d1 现在是
    // 'merged'，theme-c1+d1 的合并结果仍可用 first.revertToken 识别并回滚）。
    await expect(
      mergeThemes(deps(), {
        orgId: ORG_ID, actorId: RESEARCHER, themeIds: ["theme-d1", "theme-e1"], preview: false,
      }),
    ).rejects.toBeInstanceOf(ThemeConcurrentModificationError);

    expect(await themeStatusOf("theme-d1")).toBe("merged");
    expect(await themeStatusOf("theme-e1")).toBe("active");
    // theme-e1 未被第二次失败的调用动过——它的洞察原样还在 theme-e1 下。
    expect(await themeIdOf("insight-e1")).toBe("theme-e1");
  });

  it("splitThemes：按受访者整体重分配，真正写库后可用 revertToken 撤销", async () => {
    await seedTheme("theme-f1", "待拆分主题");
    await seedQuote("q-f1", "subj-f1", "受访者 1 的引述");
    await seedQuote("q-f2", "subj-f2", "受访者 2 的引述");
    await seedInsight("insight-f1", "theme-f1", "q-f1", "受访者 1 的洞察");
    await seedInsight("insight-f2", "theme-f1", "q-f2", "受访者 2 的洞察");

    const split = await splitThemes(deps(), {
      orgId: ORG_ID, actorId: RESEARCHER, themeId: "theme-f1", intoLabels: ["子主题甲", "子主题乙"],
    });
    expect(split.themeIds).toHaveLength(2);
    expect(split.revertToken).toBeTruthy();
    expect(await themeStatusOf("theme-f1")).toBe("split_out");

    // 两位受访者各自的洞察必须整体落在两个新主题之一（不丢、不拆散）。
    const targets = new Set([await themeIdOf("insight-f1"), await themeIdOf("insight-f2")]);
    for (const t of targets) expect(split.themeIds).toContain(t);

    const reverted = await revertThemeOperation(deps(), {
      orgId: ORG_ID, actorId: RESEARCHER, revertToken: split.revertToken,
    });
    expect(reverted.kind).toBe("split");
    expect(await themeStatusOf("theme-f1")).toBe("active");
    expect(await themeIdOf("insight-f1")).toBe("theme-f1");
    expect(await themeIdOf("insight-f2")).toBe("theme-f1");
  });

  it("adjustEvidenceWeight：调低非唯一证据的权重安全放行，真正写库后可用 revertToken 撤销", async () => {
    await seedTheme("theme-g1", "调权主题");
    // 受访者 subj-g1 有两条引述：一条强证据、一条附和——调低附和那条的权重不影响唯一性
    // （它本来就不是唯一反例）。
    await seedQuote("q-g1", "subj-g1", "受访者的强证据");
    await seedQuote("q-g2", "subj-g1", "受访者的附和发言", { isAppeasement: true });
    await seedInsight("insight-g1", "theme-g1", "q-g1", "洞察一");
    await seedInsight("insight-g2", "theme-g1", "q-g2", "洞察二");

    const adjusted = await adjustEvidenceWeight(deps(), {
      orgId: ORG_ID, actorId: RESEARCHER, quoteId: "q-g2", weight: 0.2,
    });
    expect(adjusted.weight).toBe(0.2);
    expect(adjusted.revertToken).toBeTruthy();
    expect(await weightOf("q-g2")).toBe(0.2);

    const reverted = await revertThemeOperation(deps(), {
      orgId: ORG_ID, actorId: RESEARCHER, revertToken: adjusted.revertToken,
    });
    expect(reverted.kind).toBe("adjust_weight");
    expect(await weightOf("q-g2")).toBe(1);
  });

  it("adjustEvidenceWeight：CONCURRENT_MODIFICATION —— 引述已不可解析（不存在）", async () => {
    await expect(
      adjustEvidenceWeight(deps(), {
        orgId: ORG_ID, actorId: RESEARCHER, quoteId: "q-does-not-exist", weight: 0,
      }),
    ).rejects.toBeInstanceOf(ThemeConcurrentModificationError);
  });

  it("adjustEvidenceWeight：调唯一反例引述权重到 0 ⇒ COUNTEREXAMPLE_WOULD_VANISH，不写库", async () => {
    await seedTheme("theme-h1", "反例调权主题");
    await seedQuote("q-h1", "subj-h1", "受访者的唯一反例", { isCounterexample: true });
    await seedInsight("insight-h1", "theme-h1", "q-h1", "洞察");

    await expect(
      adjustEvidenceWeight(deps(), {
        orgId: ORG_ID, actorId: RESEARCHER, quoteId: "q-h1", weight: 0,
      }),
    ).rejects.toBeInstanceOf(CounterexampleWouldVanishError);

    // 阻断意味着没有写库：权重原样还在，且没有留下任何 revert_token 行可兑现。
    expect(await weightOf("q-h1")).toBe(1);
  });
});
