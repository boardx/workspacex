// rewrite-coverage-evidence.test.ts — E1 验收（不是 HMV2-066，见 rewrite-coverage-evidence.ts 头部注释）。纯函数，喂构造的
// CoverageReport，不碰文件系统（写盘那半在 lint-rewrite-coverage.mjs 里，
// 由「实测跑一遍 + templates doctor 捡到」做活体验证，见 PR 描述）。
import { describe, expect, it } from "vitest";
import { buildRewriteCoverageEvidence, REWRITE_COVERAGE_EVIDENCE_INSTANCE_ID } from "./rewrite-coverage-evidence";
import { validateInstanceMetadata } from "./template-model";
import type { CoverageReport } from "./rewrite-coverage";

function report(overrides: Partial<CoverageReport> = {}): CoverageReport {
  return {
    incomplete: false,
    incompleteReason: null,
    routes: [{ path: "/skills", head: "skills", bare: true, source: "skill.controller.ts" }],
    coveredBare: new Set(["skills"]),
    coveredDeep: new Set(["skills"]),
    gaps: [],
    ...overrides,
  };
}

describe("buildRewriteCoverageEvidence", () => {
  it("基线：干净结果 → 产出的实例符合 InstanceMetadata schema（HMV2-008），且 template_id 是 TPL-EVD-001", () => {
    const evidence = buildRewriteCoverageEvidence({
      report: report(),
      staleAllowlistEntries: [],
      allowlistSize: 0,
      generatedBy: "lint-rewrite-coverage.mjs",
      generatedAt: "2026-08-06T12:00:00.000Z",
      commit: "abc123",
    });
    expect(evidence.template_id).toBe("TPL-EVD-001");
    expect(evidence.instance_id).toBe(REWRITE_COVERAGE_EVIDENCE_INSTANCE_ID);
    expect(evidence.gaps_found).toBe(0);

    // 反证的核心：不是「看起来像」InstanceMetadata，是真的能过 E1 自己的 schema 校验器
    // （同一份 template-model.ts，不是本文件另写一份判断逻辑）。
    const result = validateInstanceMetadata(evidence, "instances/EVD-rewrite-coverage.yaml");
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("🔴 instance_id 不随 run 变化 —— 连续两次构建（不同 report）产出同一个 instance_id", () => {
    const a = buildRewriteCoverageEvidence({
      report: report({ gaps: [{ head: "recording", kind: "bare", example: "/recording" }] }),
      staleAllowlistEntries: [],
      allowlistSize: 0,
      generatedBy: "x",
      generatedAt: "t1",
      commit: null,
    });
    const b = buildRewriteCoverageEvidence({
      report: report(),
      staleAllowlistEntries: [],
      allowlistSize: 0,
      generatedBy: "x",
      generatedAt: "t2",
      commit: null,
    });
    expect(a.instance_id).toBe(b.instance_id);
  });

  it("incomplete=true 时仍产出合法实例（「扫不全」是真实的运行结果，不是没运行）", () => {
    const evidence = buildRewriteCoverageEvidence({
      report: report({ incomplete: true, incompleteReason: "0 个 controller", routes: [] }),
      staleAllowlistEntries: [],
      allowlistSize: 0,
      generatedBy: "lint-rewrite-coverage.mjs",
      generatedAt: "2026-08-06T12:00:00.000Z",
      commit: null,
    });
    expect(evidence.incomplete).toBe(true);
    expect(evidence.status).toBe("active");
    const result = validateInstanceMetadata(evidence, "x.yaml");
    expect(result.ok).toBe(true);
  });

  it("gaps 与 stale allowlist 条目原样带入证据载荷", () => {
    const evidence = buildRewriteCoverageEvidence({
      report: report({ gaps: [{ head: "recording", kind: "deep", example: "/recording/x" }] }),
      staleAllowlistEntries: ["skills"],
      allowlistSize: 1,
      generatedBy: "lint-rewrite-coverage.mjs",
      generatedAt: "t",
      commit: null,
    });
    expect(evidence.gaps_found).toBe(1);
    expect(evidence.gaps[0]).toEqual({ head: "recording", kind: "deep", example: "/recording/x" });
    expect(evidence.stale_allowlist_entries).toEqual(["skills"]);
  });

  it("commit 为 null 时原样透传（拿不到 git sha 不应该被静默替换成别的值）", () => {
    const evidence = buildRewriteCoverageEvidence({
      report: report(),
      staleAllowlistEntries: [],
      allowlistSize: 0,
      generatedBy: "x",
      generatedAt: "t",
      commit: null,
    });
    expect(evidence.commit).toBeNull();
  });

  it("写盘形态不含 sourceFile —— 那是扫描器派生的字段，不是本函数该产出的", () => {
    const evidence = buildRewriteCoverageEvidence({
      report: report(),
      staleAllowlistEntries: [],
      allowlistSize: 0,
      generatedBy: "x",
      generatedAt: "t",
      commit: null,
    });
    expect("sourceFile" in evidence).toBe(false);
  });
});
