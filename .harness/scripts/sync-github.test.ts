import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildIssueBody,
  decideClose,
  diffLabels,
  isProjectedBody,
  partitionTitleMatches,
  projectionMarker,
} from "./sync-github";
import type { ProjectedIssue } from "./sync-github";
import { PHASES_DIR } from "./lib/paths";
import type { Feature, FeatureList } from "./lib/types";

// findPhaseDir("p27") 需要真实存在的 phases/phase-p27-*/ 目录（模板仓的 phases/
// 默认为空，不像来源仓那样带着 p27 真实阶段）——建一次性 fixture，测完即清。
const PHASE_DIR = join(PHASES_DIR, "phase-p27-fixture");
beforeEach(() => mkdirSync(PHASE_DIR, { recursive: true }));
afterEach(() => rmSync(PHASE_DIR, { recursive: true, force: true }));

function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: "F01",
    priority: 1,
    area: "ai-store-data",
    title: "Team tenancy",
    user_visible_behavior: "Team resources are isolated.",
    status: "not_started",
    sprint: "01",
    owner: null,
    capability: "CAP-DATA",
    depends_on: [],
    wave: 0,
    verification: ["true"],
    evidence: "",
    notes: "Parent issue projection test.",
    ...overrides,
  };
}

// decideClose 的集成事实夹具（#1557）：只有 on-main 才允许关 issue。
const ON_MAIN = { kind: "on-main", commit: "a".repeat(40), rel: "phases/x/evidence/F01.verify.log" } as const;
const NOT_ON_MAIN = { kind: "not-on-main", commit: "b".repeat(40), rel: "phases/x/evidence/F01.verify.log" } as const;
const UNCOMMITTED = { kind: "uncommitted", rel: "phases/x/evidence/F01.verify.log" } as const;
const NO_SPRINT = { kind: "no-sprint" } as const;

describe("buildIssueBody", () => {
  it("links p27 feature issues to parent issue 662", () => {
    const feature = makeFeature();
    const featureList: FeatureList = { phase: "p27", features: [feature] };

    const body = buildIssueBody(
      feature,
      "p27",
      "01",
      "acme/acme-dev-template",
      featureList,
      662,
    );

    expect(body).toContain("## Parent Tracking Issue");
    expect(body).toContain("Parent: #662");
    expect(body).toContain(
      "https://github.com/acme/acme-dev-template/issues/662",
    );
  });

  it("embeds the projection marker so future syncs can recognize their own issues", () => {
    const feature = makeFeature();
    const featureList: FeatureList = { phase: "p27", features: [feature] };

    const body = buildIssueBody(feature, "p27", "01", "acme/acme-dev-template", featureList);

    expect(body).toContain(projectionMarker("p27", "F01"));
    expect(isProjectedBody(body, "p27", "F01")).toBe(true);
    // marker 是 per-feature 的：不会误认别的 feature 的投影
    expect(isProjectedBody(body, "p27", "F02")).toBe(false);
  });

  describe("Story section（闭环延伸到 GitHub）", () => {
    it("缺 spec_ref → 醒目提示，不是静默省略", () => {
      const feature = makeFeature(); // 无 spec_ref
      const featureList: FeatureList = { phase: "p27", features: [feature] };
      const body = buildIssueBody(feature, "p27", "01", "acme/acme-dev-template", featureList);
      expect(body).toContain("## Story");
      expect(body).toContain("⚠ 缺少可追溯的 story");
    });

    it("有效 spec_ref → 渲染指向 requirements 文件的链接 + 章节 ID", () => {
      const phaseDir = join(PHASES_DIR, "phase-zz-sync-test-fixture");
      const reqDir = join(phaseDir, "requirements");
      mkdirSync(reqDir, { recursive: true });
      writeFileSync(join(reqDir, "auth.md"), "## R3 验收线索\n内容", "utf8");
      try {
        const feature = makeFeature({ spec_ref: "auth.md#R3" });
        const featureList: FeatureList = { phase: "zz-sync-test", features: [feature] };
        const body = buildIssueBody(feature, "zz-sync-test", "01", "acme/acme-dev-template", featureList);
        expect(body).toContain("[requirements/auth.md]");
        expect(body).toContain("requirements/auth.md");
        expect(body).toContain("`R3`");
        expect(body).not.toContain("⚠ 缺少可追溯的 story");
      } finally {
        rmSync(phaseDir, { recursive: true, force: true });
      }
    });
  });
});

describe("partitionTitleMatches (marker guard)", () => {
  const phaseId = "p29";
  const featureId = "F03";
  const marker = projectionMarker(phaseId, featureId);

  const manualIssue = {
    number: 100,
    title: "[F03] 修登录",
    body: "人工开的 issue，标题恰好和投影撞名。没有任何 marker。",
    state: "OPEN",
  };
  const projectedIssue = {
    number: 101,
    title: "[F03] 修登录",
    body: `${marker}\n\n## 交付契约（user_visible_behavior）\n...`,
    state: "OPEN",
  };

  it("treats a title-colliding manual issue (no marker) as a collision, never as the projection", () => {
    const { projection, collisions } = partitionTitleMatches([manualIssue], phaseId, featureId);
    expect(projection).toBeNull();
    expect(collisions).toEqual([manualIssue]);
    // 净效果：edit 路径拿不到 existing → 不 edit；close 路径 decideClose(null) → 不关。
    expect(decideClose(projection, ON_MAIN)).toBe("skip-missing");
  });

  it("picks the marker-bearing projection even when a manual issue shadows it in search order", () => {
    const { projection, collisions } = partitionTitleMatches(
      [manualIssue, projectedIssue],
      phaseId,
      featureId,
    );
    expect(projection).toBe(projectedIssue);
    expect(collisions).toEqual([manualIssue]);
  });

  it("does not accept a marker for a different feature", () => {
    const otherFeatureIssue = {
      ...projectedIssue,
      body: `${projectionMarker(phaseId, "F04")}\n\n...`,
    };
    const { projection } = partitionTitleMatches([otherFeatureIssue], phaseId, featureId);
    expect(projection).toBeNull();
  });

  it("marker judgement uses the pre-edit body, so injecting the marker via edit cannot bypass the guard", () => {
    // 根因回归测试：旧实现在 edit 后用「刚写入的新 body」（必带 marker）回填
    // issueForClose，导致人工 issue 被当作投影关闭。守卫必须只看 GitHub 上的现存 body。
    const { projection } = partitionTitleMatches([manualIssue], phaseId, featureId);
    expect(projection).toBeNull();
    const bodyWeWouldWrite = `${marker}\n...`;
    expect(isProjectedBody(bodyWeWouldWrite, phaseId, featureId)).toBe(true); // 新 body 必带 marker
    expect(isProjectedBody(manualIssue.body, phaseId, featureId)).toBe(false); // 但判定依据是现存 body
  });
});

describe("diffLabels (#1676: sprint:*/area:* must reconcile, not just status:*)", () => {
  const AREA_PREFIX = "area:";
  const ALL_STATUS_LABELS = ["status:blocked", "status:in-progress", "status:merged"];

  it("removes stale sprint:/area: labels left over from an issue-number collision, and adds the correct ones", () => {
    // #1676 实况：issue 因 marker 撞号被判给了另一个 feature，旧 body 时期的
    // sprint:12-03 + area:project 从未被 remove 过（旧逻辑只 reconcile status:* label）。
    const current = ["status:merged", "status:in-progress", "area:project", "sprint:12-03"];
    const desired = ["sprint:12-01", "area:component-primitives", "status:merged"];
    const { toAdd, toRemove } = diffLabels(current, desired, AREA_PREFIX, ALL_STATUS_LABELS);
    expect(toAdd.sort()).toEqual(["area:component-primitives", "sprint:12-01"]);
    expect(toRemove.sort()).toEqual(["area:project", "sprint:12-03", "status:in-progress"]);
  });

  it("is a no-op once current already equals desired (idempotent)", () => {
    const desired = ["sprint:12-01", "area:component-primitives", "status:merged"];
    const { toAdd, toRemove } = diffLabels(desired, desired, AREA_PREFIX, ALL_STATUS_LABELS);
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });

  it("never touches labels outside the managed namespaces (manual labels survive)", () => {
    const current = ["sprint:12-01", "area:component-primitives", "status:merged", "needs-design-review"];
    const desired = ["sprint:12-01", "area:component-primitives", "status:merged"];
    const { toAdd, toRemove } = diffLabels(current, desired, AREA_PREFIX, ALL_STATUS_LABELS);
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });
});

describe("decideClose (idempotency)", () => {
  it("never closes when no projection issue was found", () => {
    expect(decideClose(null, ON_MAIN)).toBe("skip-missing");
  });

  it("does not re-close an already closed projection issue (and never reopens)", () => {
    const closed: ProjectedIssue = {
      number: 7,
      title: "[F01] Team tenancy",
      body: projectionMarker("p27", "F01"),
      state: "CLOSED",
    };
    expect(decideClose(closed, ON_MAIN)).toBe("skip-closed");
  });

  it("closes an open projection issue whose implementation is already on main", () => {
    const open: ProjectedIssue = { number: 8, title: "[F01] Team tenancy", body: projectionMarker("p27", "F01"), state: "OPEN" };
    expect(decideClose(open, ON_MAIN)).toBe("close");
  });
});

describe("decideClose (#1557: passing alone is not enough — the implementation must be on main)", () => {
  const open: ProjectedIssue = { number: 9, title: "[F01] Team tenancy", body: projectionMarker("p27", "F01"), state: "OPEN" };

  it("does not close when the evidence commit is not yet an ancestor of origin/main", () => {
    expect(decideClose(open, NOT_ON_MAIN)).toBe("skip-not-on-main");
  });

  it("does not close when the evidence log was never committed (verify ran, nothing pushed)", () => {
    expect(decideClose(open, UNCOMMITTED)).toBe("skip-not-on-main");
  });

  it("does not close when the feature has no sprint (evidence cannot be located)", () => {
    expect(decideClose(open, NO_SPRINT)).toBe("skip-not-on-main");
  });

  it("integration is judged before the issue lookup, so dry-run (no issue object) reaches the same verdict", () => {
    expect(decideClose(null, NOT_ON_MAIN)).toBe("skip-not-on-main");
    expect(decideClose(null, ON_MAIN)).toBe("skip-missing");
  });
});
