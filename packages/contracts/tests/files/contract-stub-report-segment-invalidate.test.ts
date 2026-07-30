/**
 * F47 ② —— `annotateWithdrawnEvidence` 契约先行桩（10-report / 13-deliv，phase-02 实现）
 *
 * D-19：引用被删证据的报告段落标「证据已撤回」——**对内可见，对外不自动改写，
 * 需人工确认后替换**。实现体属 phase-02；phase-01 只出契约与桩。
 *
 * ⚠ 本端口与 phase-00 **已签核**的 `artifact.markEvidenceWithdrawn` 形状高度相似。
 *   coverage C-3 要求一致性复核裁定「是不是同一个」。
 *   **F47 不替人裁**：既不合并（合并等于改一个已签核的操作），
 *   也不假装无关（那是第 N 次同一事实两处）。⇒ 下方有一条断言把这个疑似重复
 *   **钉在测试里**，任何一方改了形状都会红。
 */
import { describe, expect, it } from "vitest";
import * as artifact from "../../src/artifact";
import * as files from "../../src/files";
import {
  CascadeTargetUnavailableError,
  PHASE_02_OUT_OF_SCOPE,
  assertPortInput,
  phase01OutboundStubs,
} from "../../src/files-outbound-stubs";
import {
  VALID_INPUT,
  brokenImpls,
  callPort,
  checkCaseCoverage,
  runPortConformance,
} from "./outbound-port-conformance";

const PORT = "annotateWithdrawnEvidence" as const;

/** 「假装是 phase-02 的 10-report」——只走成功路径。**它证明契约断言不依赖桩** */
const fakePhase02Report = async (input: unknown) => {
  assertPortInput(PORT, input);
  const { versionIds } = input as { versionIds: string[] };
  return {
    annotatedSectionIds: versionIds.map((v) => `section-citing-${v}`),
    notifiedApprovers: ["approver-1"],
  };
};

/* ① + ② 同一套契约断言，跑两个完全不同的实现 */
runPortConformance(PORT, "phase-01 契约桩", phase01OutboundStubs[PORT]);
runPortConformance(PORT, "假装是 phase-02 的 10-report（成功路径）", fakePhase02Report);

describe("annotateWithdrawnEvidence · 契约登记", () => {
  it("端口登记在 OUTBOUND_PORTS 这一处，且指名 10-report / 13-deliv / phase-02", () => {
    expect(Object.keys(files.OUTBOUND_PORTS)).toContain(PORT);
    expect(files.OUTBOUND_PORTS[PORT].providedBy).toContain("10-report");
    expect(files.OUTBOUND_PORTS[PORT].providedBy).toContain("13-deliv");
    expect(files.OUTBOUND_PORTS[PORT].providedBy).toContain("phase-02");
  });

  it("🔴 它**不是**六类级联的第七类：cascadeKind 为 null 且不在 CascadeKind 里", () => {
    // 把它算成第七类会让 CascadeKind 的封闭六值失真，而六类逐一验收正是 AC2 的形式。
    expect(files.OUTBOUND_PORTS[PORT].cascadeKind).toBeNull();
    expect(files.CascadeKind.options).toHaveLength(6);
    expect(files.CascadeKind.options as readonly string[]).not.toContain("report-segments");
  });

  it("两个出站端口共用同一个失败码，调用方须标出是哪一类未完成", () => {
    expect(files.OUTBOUND_PORTS[PORT].err).toEqual(["CASCADE_TARGET_UNAVAILABLE"]);
    // 「哪一类」靠错误对象上的 port 字段，不是靠错误码——码只有一个。
    expect(files.OUTBOUND_PORTS.invalidateOntologyEdges.err).toEqual(files.OUTBOUND_PORTS[PORT].err);
  });
});

describe("annotateWithdrawnEvidence · 桩的语义（③）", () => {
  it("🔴 桩绝不返回成功：假成功会让「证据已撤回」的标注从未发生却记为完成", async () => {
    const outcome = await callPort(phase01OutboundStubs[PORT], VALID_INPUT[PORT]);
    expect(outcome.kind).toBe("err");
  });

  it("抛的是已声明的失败，且带上是哪个端口、谁该提供", async () => {
    const outcome = await callPort(phase01OutboundStubs[PORT], VALID_INPUT[PORT]);
    const err = (outcome as { error: unknown }).error;
    expect(err).toBeInstanceOf(CascadeTargetUnavailableError);
    expect((err as CascadeTargetUnavailableError).code).toBe("CASCADE_TARGET_UNAVAILABLE");
    expect((err as CascadeTargetUnavailableError).port).toBe(PORT);
    expect((err as CascadeTargetUnavailableError).providedBy).toContain("10-report");
  });
});

describe("annotateWithdrawnEvidence · 与已签核的 artifact.markEvidenceWithdrawn 的疑似重复（C-3）", () => {
  it("两者的 out 确实高度相似——这条断言就是那个疑似重复的机械形式", () => {
    const mine = Object.keys(files.OUTBOUND_PORTS[PORT].out.shape);
    const signed = Object.keys(artifact.operations.markEvidenceWithdrawn.out.shape);
    expect(mine).toEqual(["annotatedSectionIds", "notifiedApprovers"]);
    expect(signed).toEqual(["annotatedReferences", "notifiedApprovers", "provenanceEventId"]);
    // 交集非空 = 疑似重复成立；任何一方改名，下面这条会红，逼人回到 C-3 上裁。
    const overlap = mine.filter((k) => signed.includes(k));
    expect(overlap).toEqual(["notifiedApprovers"]);
  });

  it("F47 不替人裁：疑似重复具名登记在 FS11 与 PHASE_02_OUT_OF_SCOPE 里", () => {
    expect(files.KNOWN_CONTRACT_GAPS.FS11).toContain("markEvidenceWithdrawn");
    expect(PHASE_02_OUT_OF_SCOPE.DUPLICATE_WITH_MARK_EVIDENCE_WITHDRAWN).toContain("C-3");
    // 也没有偷偷把已签核的操作删掉或改掉
    expect(artifact.operations.markEvidenceWithdrawn.path).toBe("/artifacts/versions/:versionId/evidence-withdrawn");
  });
});

describe("annotateWithdrawnEvidence · 反证（④）", () => {
  const broken = brokenImpls(PORT);

  it("反证集合非空——空集不算通过", () => {
    expect(checkCaseCoverage("report 反证集合", broken.length, 5)).toEqual([]);
  });

  it.each(broken.map((b) => [b.name, b] as const))("必须抓住：%s", (_name, b) => {
    expect(b.check().length, "这个坏实现没被任何一条检查抓到 —— 断言太松").toBeGreaterThan(0);
  });
});

describe("annotateWithdrawnEvidence · phase-02 范围登记（不静默省略）", () => {
  it("10-report / 13-deliv 侧的实现体被具名登记为不在本 feature 范围内", () => {
    expect(PHASE_02_OUT_OF_SCOPE.REPORT_SEGMENT_ANNOTATION_BODY).toContain("10-report");
    expect(PHASE_02_OUT_OF_SCOPE.REPORT_SEGMENT_ANNOTATION_BODY).toContain("phase-02");
  });

  it("登记表本身非空，且每条都指名一个 phase-02 模块或一个缺口编号", () => {
    const entries = Object.entries(PHASE_02_OUT_OF_SCOPE);
    expect(checkCaseCoverage("PHASE_02_OUT_OF_SCOPE", entries.length, 5)).toEqual([]);
    for (const [key, text] of entries) {
      expect(
        /phase-02|09-kg|10-report|13-deliv|FS1[0-9]|C-3|F\d{2}/.test(text),
        `${key} 没指名归属方（phase-02 模块 / 别的 feature 编号）或缺口编号——那就等于静默省略`,
      ).toBe(true);
    }
  });
});
