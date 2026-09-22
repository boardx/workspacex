import { describe, expect, it } from "vitest";
import {
  ACTIVE_FEATURES_BASENAME,
  ACTIVE_FEATURES_REGEN_CMD,
  auditStartupDocs,
  buildActiveFeaturesView,
  inProgressFeatures,
  renderActiveFeaturesView,
} from "./startup-discovery";
import type { Feature } from "./types";

function mkFeature(over: Partial<Feature> & Pick<Feature, "id">): Feature {
  return {
    priority: 1,
    area: "core",
    title: `title-${over.id}`,
    user_visible_behavior: "",
    status: "not_started",
    sprint: "01",
    owner: null,
    verification: [],
    evidence: "",
    notes: "",
    ...over,
  };
}

describe("派生视图的确定性（#401 验收第二条）", () => {
  const features = [mkFeature({ id: "F02", priority: 2 }), mkFeature({ id: "F01", priority: 1 })];

  it("同一份权威输入 ⇒ 同样的字节", () => {
    const a = renderActiveFeaturesView(buildActiveFeaturesView("11", "02", features));
    const b = renderActiveFeaturesView(buildActiveFeaturesView("11", "02", features));
    expect(a).toBe(b);
  });

  it("视图里没有挂钟字段——带时间戳的投影没法和权威源做逐字等价比对", () => {
    const json = renderActiveFeaturesView(buildActiveFeaturesView("11", "02", features));
    expect(json).not.toContain("generated_at");
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("features 逐字等于喂进去的权威子集（投影不增删不改写）", () => {
    const view = buildActiveFeaturesView("11", "02", features);
    expect(view.features).toEqual(features);
  });

  it("note 里点名重建命令——读到投影的人立刻知道怎么刷新它", () => {
    expect(buildActiveFeaturesView("11", "02", features).note).toContain(ACTIVE_FEATURES_REGEN_CMD);
  });
});

describe("inProgressFeatures", () => {
  it("只挑 in_progress，并按 id 稳定排序", () => {
    const fs = [
      mkFeature({ id: "F09", status: "in_progress" }),
      mkFeature({ id: "F01", status: "passing" }),
      mkFeature({ id: "F03", status: "in_progress" }),
      mkFeature({ id: "F07", status: "blocked" }),
    ];
    expect(inProgressFeatures(fs).map((f) => f.id)).toEqual(["F03", "F09"]);
  });
});

describe("auditStartupDocs：指示读投影的文档必须点名重建命令", () => {
  it("只说『读 active-features.json』⇒ 红（干净 clone 上那个文件不存在）", () => {
    const findings = auditStartupDocs([
      { path: "AGENTS.md", text: `1. 读 progress.md\n2. 读当前 sprint 的 ${ACTIVE_FEATURES_BASENAME}，找到唯一 in_progress。\n` },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("STARTUP-PROJECTION-UNREACHABLE");
    expect(findings[0]!.line).toBe(2);
    expect(findings[0]!.message).toContain(ACTIVE_FEATURES_REGEN_CMD);
  });

  it("命令块里 `cat` 投影同样算「读」", () => {
    const findings = auditStartupDocs([
      { path: "x/SKILL.md", text: `cat phases/<p>/sprints/sprint-<MM>/${ACTIVE_FEATURES_BASENAME} | jq .\n` },
    ]);
    expect(findings.map((f) => f.path)).toEqual(["x/SKILL.md"]);
  });

  it("文中点名了重建命令 ⇒ 绿（同一文件里先重建再读是自洽的）", () => {
    const text =
      `跑 \`${ACTIVE_FEATURES_REGEN_CMD}\` 重建派生视图，\n` +
      `再读 ${ACTIVE_FEATURES_BASENAME} 找唯一 in_progress。\n`;
    expect(auditStartupDocs([{ path: "AGENTS.md", text }])).toEqual([]);
  });

  it("「它是脚本派生的只读视图，禁止手改」不算读指令——那是禁止写的告诫", () => {
    const text = `| 不要手改 \`${ACTIVE_FEATURES_BASENAME}\` | 它是脚本派生的只读视图 |\n`;
    expect(auditStartupDocs([{ path: "x/SKILL.md", text }])).toEqual([]);
  });

  it("不提这个文件的文档不进入判定", () => {
    expect(auditStartupDocs([{ path: "y.md", text: "读 feature_list.json 就够了\n" }])).toEqual([]);
  });
});
