import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { contextPack as CP, omissionReason as OR, thresholds as TH } from "@repo/contracts";
import {
  addArtifact,
  addBinding,
  addOrgMember,
  addProjectMember,
  addSegment,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
import { disclose } from "../../src/application/security/permission-filter";
import { buildContextItems, type RetrievalFacts } from "../../src/application/context-pack/build-items";
import { finalizePack } from "../../src/application/context-pack/finalize-pack";
import { listOmissions, RunNotFoundError } from "../../src/application/context-pack/list-omissions";
import type { ContextPackAuditStore, StoredPackAudit } from "../../src/application/context-pack/ports";
import {
  assertOmissionClosure,
  auditableOmissions,
  omissionClosure,
  OmissionClosureError,
  outOfEnumOmissions,
} from "../../src/domain/context-pack/omission-audit";
import {
  applyRelevanceThreshold,
  dedupeCandidates,
  omissionFor,
  relevanceOf,
  screenCandidates,
  trimToBudget,
  unlocatableOmission,
  type ScreenableCandidate,
} from "../../src/domain/context-pack/screening";
import type { Omission } from "../../src/domain/context-pack/pack-structure";
import { toOrgId } from "../../src/domain/org-id";
import type { SegmentRecord } from "../../src/application/artifact/ports";

/**
 * F11 -- "被丢弃不等于不存在", as something that can fail.
 *
 * I-2 is the soul of this bundle (`domain.md` says so in as many words): everything in the
 * candidate set that did not become an item must be explained in `omissions[]`. Its failure mode
 * is SILENCE, and silence is invisible from the result -- a pack with three items and no
 * omissions looks exactly like a pack where nothing was dropped. So every assertion here is
 * anchored to the CANDIDATE SET, and every gate has an arrangement in which it must go red.
 *
 * The four discard paths R7 names -- 预算超限 / 低于相关度阈值 / 权限过滤 / 去重折叠 -- plus the
 * one ADR-021 added (`unlocatable`), are each exercised, and each one's omission is checked for
 * the thing that makes it useful: a reason from the closed enum and an explanation that says why.
 */

/** ⚠ 每个文件自带 id 前缀：`artifacts.id` / `segments.id` 是全局唯一的（见 filter-actions 那份的说明）。 */
const ORG = "org-f11-omit";
const PROJECT = "proj-f11-omit";

/** A relevance figure with an honest provenance. See `screening.ts` on why this is branded. */
const rel = (v: number) => relevanceOf(v, "fixture: hand-set relevance for this assertion");

function cand(over: Partial<ScreenableCandidate> & { segmentId: string }): ScreenableCandidate {
  return {
    relevance: rel(0.9),
    tokens: 10,
    fingerprint: over.segmentId,
    ...over,
  };
}

/* ────────────────── ① 阈值：唯一事实源，且规则真的被施加 ────────────────── */

describe("相关度阈值只有一份（O-36）", () => {
  it("取数口是契约，值就是裁决的 0.45", () => {
    expect(TH.relevanceThresholdFor("decision-support")).toBe(0.45);
    // 已裁决 ⇒ 登记为 known，且带出处。没有出处的数值等于没有依据。
    expect(TH.THRESHOLDS.contextPackRelevance.known).toBe(true);
    expect(TH.THRESHOLDS.contextPackRelevance.source).toMatch(/O-36/);
  });

  it("按任务类型可配：配了走配的，没配走默认（不是「没配就不过滤」）", () => {
    const v = TH.requireValue(TH.THRESHOLDS.contextPackRelevance, "contextPackRelevance");
    // 断言的是**取数规则**，不是某个任务今天配了什么——今天一个都没配。
    const withOverride: TH.RelevanceThresholdValue = { default: v.default, byTask: { search: 0.7 } };
    const pick = (task: "search" | "answer") => withOverride.byTask[task] ?? withOverride.default;
    expect(pick("search")).toBe(0.7);
    expect(pick("answer")).toBe(v.default);
    // 今天没有任何任务类型被单独配置，所以每个任务都拿到 default——
    // 这一条不是废话：它证明「按任务类型可配」现在是**规则可用、无人配置**，而不是已经配好了。
    for (const t of CP.QueryTask.options) expect(TH.relevanceThresholdFor(t)).toBe(v.default);
  });

  /**
   * ⚠ 反证式的守卫：后端代码里不得再出现字面量 0.45。
   * 收敛前它散在契约注释、usecases.md、前端 mock 三段文案与调用日志文案里；
   * 只要有人按任务类型配了新值，那些地方就会当场说谎而没有任何东西会红。
   */
  it("apps/api/src 里没有第二份阈值字面量", () => {
    const root = join(__dirname, "..", "..", "src");
    const files: string[] = [];
    (function walk(dir: string) {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        statSync(p).isDirectory() ? walk(p) : n.endsWith(".ts") && files.push(p);
      }
    })(root);
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return; // 注释里解释「不得写死 0.45」不算违规
        if (/\b0\.45\b/.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe("低于阈值的候选进丢弃集，且带得出为什么", () => {
  it("低于阈值 → low-confidence；不低于 → 留下", () => {
    const out = applyRelevanceThreshold(
      [cand({ segmentId: "s-low", relevance: rel(0.38) }), cand({ segmentId: "s-high", relevance: rel(0.61) })],
      "decision-support",
    );
    expect(out.thresholdUsed).toBe(0.45);
    expect(out.kept.map((c) => c.segmentId)).toEqual(["s-high"]);
    expect(out.omissions).toEqual([
      {
        ref: "s-low",
        reason: "low-confidence",
        compliance: false,
        // explain 取自单一事实源，末尾补本次上下文——两句都在，说明没有另写一套措辞。
        explain: expect.stringContaining(OR.omissionExplain("low-confidence")),
      },
    ]);
    expect(out.omissions[0]!.explain).toContain("0.38");
    expect(out.omissions[0]!.explain).toContain("0.45");
  });

  it("人工指定项不受阈值裁剪（A4）", () => {
    const out = applyRelevanceThreshold([cand({ segmentId: "s-manual", relevance: rel(0.01), manual: true })], "search");
    expect(out.kept.map((c) => c.segmentId)).toEqual(["s-manual"]);
    expect(out.omissions).toEqual([]);
  });

  /**
   * 反证：RRF 融合分不是相关度（`rrf.ts` 明写 `1/(60+1)` 已经是 0.016）。
   * 把它当相关度用会让**几乎所有**候选被判为「低置信」——而丢弃清单会煞有介事地
   * 写出一个看起来像相关度的数字。类型必须挡住它。
   */
  it("反证：融合分那种数只能带着出处显式构造，且越界值直接抛错", () => {
    expect(() => relevanceOf(1.7, "x")).toThrow(/\[0,1\]/);
    expect(() => relevanceOf(Number.NaN, "x")).toThrow();
    expect(() => relevanceOf(0.5, "  ")).toThrow(/provenance/);
    // 0.016 在 [0,1] 内，类型拦不住它——拦得住的是「没写来源」，所以来源是必填的。
    const asIfFused = relevanceOf(0.016, "RRF fused score — 这句话就是审查时要看到的那句");
    const out = applyRelevanceThreshold([cand({ segmentId: "s", relevance: asIfFused })], "search");
    expect(out.kept).toEqual([]);
    expect(out.omissions[0]!.reason).toBe("low-confidence");
  });
});

/* ────────────────── ② 去重与预算裁剪 ────────────────── */

describe("去重与预算裁剪各自留痕", () => {
  it("去重：保留先到的那条，被折叠的那条说得出跟谁重复", () => {
    const out = dedupeCandidates([
      cand({ segmentId: "s-first", fingerprint: "same" }),
      cand({ segmentId: "s-dup", fingerprint: "same" }),
    ]);
    expect(out.kept.map((c) => c.segmentId)).toEqual(["s-first"]);
    expect(out.omissions[0]).toMatchObject({ ref: "s-dup", reason: "deduped", compliance: false });
    expect(out.omissions[0]!.explain).toContain("s-first");
  });

  it("预算裁剪：**每一条**被裁的都有自己的一行，不是一句「预算超了」", () => {
    const out = trimToBudget(
      [
        cand({ segmentId: "s-a", relevance: rel(0.9), tokens: 60 }),
        cand({ segmentId: "s-b", relevance: rel(0.8), tokens: 60 }),
        cand({ segmentId: "s-c", relevance: rel(0.7), tokens: 60 }),
      ],
      100,
    );
    expect(out.kept.map((c) => c.segmentId)).toEqual(["s-a"]);
    expect(out.tokensUsed).toBeLessThanOrEqual(100);
    // 两条被裁 ⇒ 两行。「按相关度截断」⇒ 被裁的是分低的那两条。
    expect(out.omissions.map((o) => o.ref).sort()).toEqual(["s-b", "s-c"]);
    for (const o of out.omissions) {
      expect(o.reason).toBe("budget");
      expect(o.explain).toContain("100");
    }
  });

  it("人工指定项装不下是**报错**不是丢弃（E2）", () => {
    const out = trimToBudget([cand({ segmentId: "s-manual", tokens: 500, manual: true })], 100);
    expect(out.manualOverflow.map((c) => c.segmentId)).toEqual(["s-manual"]);
    // ⚠ 它没有变成一条 budget omission —— 那正是「静默丢弃人工指定项」的样子。
    expect(out.omissions).toEqual([]);
  });

  /**
   * 反证：顺序是有意义的。先裁预算再过阈值，会让「其实不该进来的候选」占掉预算，
   * 而被它挤下去的那条会拿到一条 `budget` 解释——把相关度决策说成预算决策。
   */
  it("反证：阈值在预算之前——低相关的那条不会占掉预算再让别人背 budget 的锅", () => {
    const out = screenCandidates({
      candidates: [
        cand({ segmentId: "s-junk", relevance: rel(0.1), tokens: 90 }),
        cand({ segmentId: "s-good", relevance: rel(0.9), tokens: 90 }),
      ],
      task: "search",
      tokenBudget: 100,
    });
    expect(out.kept.map((c) => c.segmentId)).toEqual(["s-good"]);
    expect(out.omissions.find((o) => o.ref === "s-junk")!.reason).toBe("low-confidence");
    expect(out.omissions.some((o) => o.reason === "budget")).toBe(false);
  });

  it("定位不到的候选被解释为 unlocatable（ADR-021），并被计数", () => {
    const out = screenCandidates({
      candidates: [cand({ segmentId: "s-ok" })],
      task: "search",
      tokenBudget: 1000,
      unanchorable: ["f11o-seg-photo"],
    });
    expect(out.unlocatableCount).toBe(1);
    expect(out.omissions).toContainEqual(unlocatableOmission("f11o-seg-photo"));
    // ⚠ compliance:false 是 ADR-021 刻意定的——定位失败是技术问题，
    // 标成 true 会把真正的撤回/过期条目挤出「必须始终可见」那一栏。
    expect(unlocatableOmission("f11o-seg-photo").compliance).toBe(false);
  });
});

/* ────────────────── ③ I-2 闭合性 ────────────────── */

describe("I-2：候选集里每一条没进 items 的都能被解释", () => {
  const base = { candidateIds: ["a", "b", "c"], itemIds: ["a"] };

  it("闭合时通过", () => {
    const omissions = [omissionFor("b", "budget"), omissionFor("c", "deduped")];
    expect(omissionClosure({ ...base, omissions }).closed).toBe(true);
    expect(() => assertOmissionClosure({ ...base, omissions })).not.toThrow();
  });

  it("反证：少解释一条 ⇒ 报出是哪一条被静默丢了", () => {
    const report = omissionClosure({ ...base, omissions: [omissionFor("b", "budget")] });
    expect(report.closed).toBe(false);
    expect(report.unexplained).toEqual(["c"]);
    expect(() => assertOmissionClosure({ ...base, omissions: [omissionFor("b", "budget")] })).toThrow(
      OmissionClosureError,
    );
  });

  it("反证：解释了一条其实给了你的东西，也是错的", () => {
    const report = omissionClosure({
      ...base,
      omissions: [omissionFor("a", "budget"), omissionFor("b", "budget"), omissionFor("c", "budget")],
    });
    expect(report.contradictory).toEqual(["a"]);
    expect(report.closed).toBe(false);
  });

  it("反证：解释了一条从来不是候选的东西 ⇒ phantom", () => {
    const report = omissionClosure({
      ...base,
      omissions: [omissionFor("b", "budget"), omissionFor("c", "budget"), omissionFor("zzz", "budget")],
    });
    expect(report.phantom).toEqual(["zzz"]);
    expect(report.closed).toBe(false);
  });

  /**
   * ⚠ 这一条守的是**门控本身不空转**：如果候选集是从 `items ∪ omissions` 推出来的，
   * 闭合检查将永远为真。`finalizePack` 因此要求调用方把候选集传进来。
   */
  it("反证：候选集若由两半推出，这道门控就是恒真的（所以它是外部输入）", () => {
    const items = ["a"];
    const omissions = [omissionFor("b", "budget")];
    const derived = [...items, ...omissions.map((o) => o.ref)];
    expect(omissionClosure({ candidateIds: derived, itemIds: items, omissions }).closed).toBe(true);
    // 真候选集里还有 c，于是同样的两半立刻不闭合——差别只在这一个入参。
    expect(omissionClosure({ candidateIds: [...derived, "c"], itemIds: items, omissions }).closed).toBe(false);
  });
});

/* ────────────────── ④ I-3 封闭枚举 ────────────────── */

describe("I-3：丢弃原因恒属封闭枚举", () => {
  it("枚举内的每个键都被契约接受，枚举外的进不来", () => {
    // ⚠ 刻意**不是** toHaveLength(8)：枚举从 7 长到 8 走的正是 ADR-021 这条正当路径，
    // 长度断言会把一次经评审的新增当成失败（contract-design 硬规则 7）。
    for (const k of OR.OMISSION_REASON_KEYS) expect(CP.OmissionReasonSchema.safeParse(k).success).toBe(true);
    for (const bogus of ["below-threshold", "budget-trimmed", "permission", "unknown"]) {
      expect(CP.OmissionReasonSchema.safeParse(bogus).success, `${bogus} 不该被接受`).toBe(false);
    }
    // ADR-021 的第八种确实在表内（断言它在，而不是断言一共几个）。
    expect(OR.OMISSION_REASON_KEYS).toContain("unlocatable");
  });

  it("outOfEnumOmissions 认得出表外取值", () => {
    const bad = { ref: "x", reason: "made-up", compliance: false, explain: "…" } as unknown as Omission;
    expect(outOfEnumOmissions([bad]).map((o) => o.ref)).toEqual(["x"]);
    expect(outOfEnumOmissions([omissionFor("y", "budget")])).toEqual([]);
  });

  it("compliance 是从单一事实源推出来的，不是另存的一份", () => {
    for (const k of OR.OMISSION_REASON_KEYS) {
      expect(omissionFor("r", k).compliance).toBe(OR.isComplianceOmission(k));
    }
  });
});

/* ────────────────── ⑤ I-4 合规性丢弃永不消失 ────────────────── */

describe("I-4：合规性丢弃在任何收窄下都还在", () => {
  /** 30 条丢弃，其中 3 条合规（withdrawn / expired / unauthorized）。 */
  const all: Omission[] = [
    omissionFor("c-withdrawn", "withdrawn"),
    omissionFor("c-expired", "expired"),
    omissionFor("c-unauth", "unauthorized"),
    ...Array.from({ length: 27 }, (_, i) => omissionFor(`low-${i}`, "low-confidence")),
  ];

  it("不加过滤：全量返回，droppedCount 是总数", () => {
    const out = auditableOmissions({ all, thresholdUsed: 0.45 });
    expect(out.omissions).toHaveLength(all.length);
    expect(out.droppedCount).toBe(30);
    expect(out.complianceAlwaysShown.map((o) => o.ref)).toEqual(["c-withdrawn", "c-expired", "c-unauth"]);
  });

  it("按 reason 收窄后：视图变窄，但合规三条与总数都不变", () => {
    const out = auditableOmissions({ all, thresholdUsed: 0.45, reasonFilter: "low-confidence" });
    expect(out.omissions).toHaveLength(27);
    expect(out.omissions.some((o) => o.compliance)).toBe(false);
    // ⚠ 这两条才是 I-4：收窄的是视图，不是「被丢弃了什么」这个事实。
    expect(out.droppedCount).toBe(30);
    expect(out.complianceAlwaysShown).toHaveLength(3);
  });

  /**
   * 反证：把 complianceAlwaysShown 写成「对过滤后的列表再筛一次」——
   * 这是这个 bug 唯一的形状，一行之差，且每条 happy path 都是绿的。
   */
  it("反证：合规栏若从过滤后的列表推出，这三条会当场消失", () => {
    const filtered = all.filter((o) => o.reason === "low-confidence");
    const buggy = filtered.filter((o) => OR.isComplianceOmission(o.reason));
    expect(buggy).toEqual([]); // ← 这就是错误实现的输出
    expect(auditableOmissions({ all, thresholdUsed: 0.45, reasonFilter: "low-confidence" }).complianceAlwaysShown)
      .toHaveLength(3); // ← 正确实现的输出
  });

  it("即使只按合规原因收窄，另外两类合规项也仍在合规栏里", () => {
    const out = auditableOmissions({ all, thresholdUsed: 0.45, reasonFilter: "withdrawn" });
    expect(out.omissions.map((o) => o.ref)).toEqual(["c-withdrawn"]);
    expect(out.complianceAlwaysShown).toHaveLength(3);
  });
});

/* ────────────────── ⑥ ListOmissions 用例 ────────────────── */

describe("ListOmissions：丢弃清单可通过接口列出", () => {
  const audit: StoredPackAudit = {
    runId: "run-1",
    orgId: toOrgId(ORG),
    items: [],
    omissions: [omissionFor("c-withdrawn", "withdrawn"), omissionFor("b-1", "budget")],
    thresholdUsed: 0.45,
  };
  const store: ContextPackAuditStore = {
    async findAudit(runId) {
      return runId === audit.runId ? audit : null;
    },
  };

  it("返回体逐字段满足契约的 out（strict）", async () => {
    const out = await listOmissions({ store }, { runId: "run-1" });
    const parsed = CP.operations.listOmissions.out.safeParse(out);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    expect(out.droppedCount).toBe(2);
    expect(out.thresholdUsed).toBe(0.45);
    expect(out.complianceAlwaysShown.map((o) => o.ref)).toEqual(["c-withdrawn"]);
  });

  /**
   * 反证：out schema 真的会拒绝漂移的 body——否则上面那条只是在断言「对象是对象」。
   * `.strict()` 不传播到数组元素，`omissions[]` 的元素尤其容易漏，所以两处都试。
   */
  it("反证：多一个字段（顶层或 omissions 元素内）都会被拒", async () => {
    const out = await listOmissions({ store }, { runId: "run-1" });
    expect(CP.operations.listOmissions.out.safeParse({ ...out, extra: 1 }).success).toBe(false);
    expect(
      CP.operations.listOmissions.out.safeParse({
        ...out,
        omissions: out.omissions.map((o) => ({ ...o, title: "被丢弃的那条叫什么" })),
      }).success,
    ).toBe(false);
  });

  it("未知 runId ⇒ RUN_NOT_FOUND，且不泄露别的 run 存不存在", async () => {
    await expect(listOmissions({ store }, { runId: "nope" })).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(listOmissions({ store }, { runId: "nope" })).rejects.toThrow(/nope/);
  });

  it("reasonFilter 收窄视图，但合规栏与总数不变（同 I-4）", async () => {
    const out = await listOmissions({ store }, { runId: "run-1", reasonFilter: "budget" });
    expect(out.omissions.map((o) => o.ref)).toEqual(["b-1"]);
    expect(out.droppedCount).toBe(2);
    expect(out.complianceAlwaysShown.map((o) => o.ref)).toEqual(["c-withdrawn"]);
  });
});

/* ────────────────── ⑦ 端到端：真实鉴权 + 真实锚点 ────────────────── */

let db: PgDatabase;
let repo: PgArtifactRepository;
let idDeps: { repo: PgIdentityRepository; ids: CountingDecisionIdFactory };
let fx: Awaited<ReturnType<typeof seedOrg>>;

const FACTS: RetrievalFacts = {
  content: "受访者原话：证据链比预算更紧缺。",
  sourceType: "interview",
  retrievalReasons: ["recall"],
  channels: ["fts"],
  score: 0.77,
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgArtifactRepository(db);
  idDeps = { repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory() };
});

afterAll(async () => {
  await db.close();
});

describe("端到端：一次装配里，被挡下的每一条都说得出为什么", () => {
  let openVersion: string;
  let secretVersion: string;
  let photoVersion: string;

  beforeEach(async () => {
    await resetOrgs(ORG);
    fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
    await addOrgMember(ORG, "u-in", "consultant", fx.teams.energy!);
    await addOrgMember(ORG, "u-out", "consultant", fx.teams.platform!);
    await addProjectMember(ORG, PROJECT, "u-in", "facilitator", null);
    await addProjectMember(ORG, PROJECT, "u-out", "facilitator", null);

    await addArtifact({ orgId: ORG, id: "f11o-art-open", projectId: PROJECT });
    ({ versionId: openVersion } = await addSegment({
      orgId: ORG, segmentId: "f11o-seg-open", artifactId: "f11o-art-open", anchor: { kind: "page", locator: "7" },
    }));

    // 权限过滤：原件是 team-only，u-out 不在该团队
    await addArtifact({ orgId: ORG, id: "f11o-art-secret", projectId: PROJECT });
    ({ versionId: secretVersion } = await addSegment({
      orgId: ORG, segmentId: "f11o-seg-secret", artifactId: "f11o-art-secret", anchor: { kind: "page", locator: "4" },
    }));
    await addBinding({
      orgId: ORG,
      subject: { kind: "team", id: fx.teams.energy! },
      object: { kind: "artifact", id: "f11o-art-secret" },
      scope: "team-only",
      ownerTeamId: fx.teams.energy!,
    });

    // 定位不到：只有 image-region 锚点（F09 查出的 E-1 缺口，ADR-021 的兜底对象）
    await addArtifact({ orgId: ORG, id: "f11o-art-photo", projectId: PROJECT });
    ({ versionId: photoVersion } = await addSegment({
      orgId: ORG, segmentId: "f11o-seg-photo", artifactId: "f11o-art-photo",
      anchor: { kind: "image-region", locator: "img-2#40,40,120,120" },
    }));
  });

  async function assemble(userId: string) {
    const guarded = [
      ...(await repo.findSegments(toOrgId(ORG), openVersion)),
      ...(await repo.findSegments(toOrgId(ORG), secretVersion)),
      ...(await repo.findSegments(toOrgId(ORG), photoVersion)),
    ];
    const candidateIds = guarded.map((g) => g.ref.id);
    const disclosure = await disclose<SegmentRecord>(idDeps, {
      userId, orgId: toOrgId(ORG), projectId: PROJECT,
      action: "read.allHands", path: "context-pack", items: guarded,
    });
    const built = buildContextItems(disclosure, (id) => ({ ...FACTS, content: `${FACTS.content}#${id}` }));

    const screened = screenCandidates({
      candidates: built.items.map((i) => cand({ segmentId: i.segmentId, tokens: 10 })),
      task: "decision-support",
      tokenBudget: 1000,
      // ⚠ ADR-021 落地点：F09 只能把这些「拿回来但说不出在哪」的候选单独返回，
      // 既不引用也不解释。第八种原因让它们终于有了交代。
      unanchorable: built.unanchorable.map((u) => u.segmentId),
    });

    const items = built.items.filter((i) => screened.kept.some((k) => k.segmentId === i.segmentId));
    return {
      candidateIds,
      pack: finalizePack({
        packId: "pack-e2e", runId: "run-e2e",
        query: {
          tenantId: ORG, principalId: userId, projectIds: [PROJECT], task: "decision-support",
          query: "证据链", timeRange: null, allowedSensitivity: ["internal"],
          tokenBudget: 1000, freshnessRequirement: null, evidencePolicy: "all",
        },
        retrievalPlan: [], items, claims: [],
        omissions: [...built.omissions, ...screened.omissions],
        candidateIds, tokensUsed: screened.tokensUsed,
      }),
      screened,
      built,
    };
  }

  it("越权的一条落 unauthorized（合规、始终可见），定位不到的一条落 unlocatable", async () => {
    const { pack, candidateIds } = await assemble("u-out");

    expect(pack.items.map((i) => i.segmentId)).toEqual(["f11o-seg-open"]);
    const byRef = new Map(pack.omissions.map((o) => [o.ref, o]));
    expect(byRef.get("f11o-seg-secret")).toMatchObject({ reason: "unauthorized", compliance: true });
    expect(byRef.get("f11o-seg-photo")).toMatchObject({ reason: "unlocatable", compliance: false });

    // I-2 端到端：候选集里没进 items 的两条，都在 omissions 里找得到。
    expect(omissionClosure({
      candidateIds,
      itemIds: pack.items.map((i) => i.segmentId),
      omissions: pack.omissions,
    }).closed).toBe(true);

    // 被挡下的内容本身不随解释外泄——解释里只有 ref。
    expect(JSON.stringify(pack.omissions)).not.toContain(FACTS.content);

    const listed = auditableOmissions({ all: pack.omissions, thresholdUsed: 0.45 });
    expect(listed.complianceAlwaysShown.map((o) => o.ref)).toEqual(["f11o-seg-secret"]);
  });

  it("有权限的人拿得到那一条 —— 上面那条不是「什么都挡」", async () => {
    const { pack } = await assemble("u-in");
    expect(pack.items.map((i) => i.segmentId).sort()).toEqual(["f11o-seg-open", "f11o-seg-secret"]);
    expect(pack.omissions.map((o) => o.ref)).toEqual(["f11o-seg-photo"]);
  });

  /**
   * 反证：把 unlocatable 那条解释拿掉——正是 ADR-021 之前的状态：
   * 照片派生的 segment 既不被引用也不被解释，且**悄无声息**。
   * finalizePack 必须在这里炸掉，否则整套「可审查」都是空的。
   */
  it("反证：漏掉任何一条解释，装配当场失败并指名道姓", async () => {
    const { pack, candidateIds, built, screened } = await assemble("u-out");
    const missing = [...built.omissions, ...screened.omissions].filter((o) => o.reason !== "unlocatable");

    expect(() =>
      finalizePack({
        packId: "pack-e2e", runId: "run-e2e", query: pack.query, retrievalPlan: [],
        items: pack.items, claims: [], omissions: missing,
        candidateIds, tokensUsed: 0,
      }),
    ).toThrow(/f11o-seg-photo/);
  });
});
