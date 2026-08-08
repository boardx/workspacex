// workflow-event-append-only-gate.test.ts — H3A-034 的反证。
//
// checkDuplicateInstanceIds 是纯函数，直接喂构造的 WorkflowEvent 列表。
// checkAppendOnly 的输入（GitHistoryFact）已经是"git log/diff 算好的事实"，
// 所以这里同样是纯函数单测，不需要起真实 git 子进程——真实 git IO 的反证
// 走 doctor 层（见 PR 描述，会用临时 git 仓库构造场景，避免污染本仓库真实
// git 历史）。
import { describe, expect, it } from "vitest";
import { checkDuplicateInstanceIds, checkAppendOnly, type GitHistoryFact } from "./workflow-event-append-only-gate";
import type { WorkflowEvent } from "./workflow-event-model";

function progressEvent(overrides: Partial<WorkflowEvent> & { instance_id: string; sourceFile: string }): WorkflowEvent {
  return {
    template_id: "TPL-EVT-001",
    template_version: 1,
    task_id: "TSK-658-canvas-01",
    actor: "agt_01HXAMPLE",
    head_sha: "abcdef123456",
    evidence_refs: [],
    kind: "progress",
    delta: { implemented: [] },
    blockers: [],
    next_action: { owner_role: "canvas-verifier", action: "verify_exact_sha" },
    ...overrides,
  } as WorkflowEvent;
}

describe("checkDuplicateInstanceIds (H3A-034)", () => {
  it("全部 instance_id 唯一 → 干净通过", () => {
    const instances = [
      progressEvent({ instance_id: "EVT-658-0001", sourceFile: ".harness/events/EVT-658-0001.yaml" }),
      progressEvent({ instance_id: "EVT-658-0002", sourceFile: ".harness/events/EVT-658-0002.yaml" }),
    ];
    expect(checkDuplicateInstanceIds(instances)).toEqual([]);
  });

  it("0 份实例 → 干净通过（今天没有输入数据可判定，不是违规）", () => {
    expect(checkDuplicateInstanceIds([])).toEqual([]);
  });

  it("两个文件用了同一个 instance_id → 两份各报一条 FAIL，互相指名对方", () => {
    const instances = [
      progressEvent({ instance_id: "EVT-658-0007", sourceFile: ".harness/events/EVT-658-0007-a.yaml" }),
      progressEvent({ instance_id: "EVT-658-0007", sourceFile: ".harness/events/EVT-658-0007-b.yaml" }),
    ];
    const findings = checkDuplicateInstanceIds(instances);
    expect(findings).toHaveLength(2);
    for (const f of findings) {
      expect(f.severity).toBe("FAIL");
      expect(f.code).toBe("H3A034-DUPLICATE-INSTANCE-ID");
    }
    const sourceFiles = findings.map((f) => f.sourceFile).sort();
    expect(sourceFiles).toEqual([".harness/events/EVT-658-0007-a.yaml", ".harness/events/EVT-658-0007-b.yaml"]);
    // 每条 finding 都要指名跟它冲突的另一方文件，方便直接定位。
    const aFinding = findings.find((f) => f.sourceFile === ".harness/events/EVT-658-0007-a.yaml")!;
    expect(aFinding.message).toContain("EVT-658-0007-b.yaml");
    const bFinding = findings.find((f) => f.sourceFile === ".harness/events/EVT-658-0007-b.yaml")!;
    expect(bFinding.message).toContain("EVT-658-0007-a.yaml");
  });

  it("三个文件用了同一个 instance_id → 三份各报一条 FAIL，各自指名另外两个", () => {
    const instances = [
      progressEvent({ instance_id: "EVT-X", sourceFile: ".harness/events/x1.yaml" }),
      progressEvent({ instance_id: "EVT-X", sourceFile: ".harness/events/x2.yaml" }),
      progressEvent({ instance_id: "EVT-X", sourceFile: ".harness/events/x3.yaml" }),
    ];
    const findings = checkDuplicateInstanceIds(instances);
    expect(findings).toHaveLength(3);
    const x1 = findings.find((f) => f.sourceFile === ".harness/events/x1.yaml")!;
    expect(x1.message).toContain("x2.yaml");
    expect(x1.message).toContain("x3.yaml");
  });

  it("不同 instance_id 但相同 kind/task_id → 不算重复，不报", () => {
    const instances = [
      progressEvent({ instance_id: "EVT-A", sourceFile: ".harness/events/a.yaml" }),
      progressEvent({ instance_id: "EVT-B", sourceFile: ".harness/events/b.yaml" }),
    ];
    expect(checkDuplicateInstanceIds(instances)).toEqual([]);
  });
});

describe("checkAppendOnly (H3A-034)", () => {
  it("首次新增之后从未被改过（0 次真实内容变更）→ 干净通过", () => {
    const facts: GitHistoryFact[] = [{ relPath: ".harness/events/EVT-1.yaml", contentChangeCommitsAfterFirst: 0 }];
    expect(checkAppendOnly(facts)).toEqual([]);
  });

  it("还没提交过的文件（git log 查不到历史，视为 0 次变更）→ 干净通过", () => {
    const facts: GitHistoryFact[] = [{ relPath: ".harness/events/EVT-2.yaml", contentChangeCommitsAfterFirst: 0 }];
    expect(checkAppendOnly(facts)).toEqual([]);
  });

  it("0 份实例 → 干净通过（今天没有输入数据可判定，不是违规）", () => {
    expect(checkAppendOnly([])).toEqual([]);
  });

  it("首次新增之后被改过 1 次 → FAIL，报出精确变更次数", () => {
    const facts: GitHistoryFact[] = [{ relPath: ".harness/events/EVT-3.yaml", contentChangeCommitsAfterFirst: 1 }];
    const findings = checkAppendOnly(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("FAIL");
    expect(findings[0]!.code).toBe("H3A034-EVENT-HISTORY-REWRITTEN");
    expect(findings[0]!.sourceFile).toBe(".harness/events/EVT-3.yaml");
    expect(findings[0]!.message).toContain("1 次");
  });

  it("首次新增之后被改过 3 次 → FAIL，报出精确变更次数", () => {
    const facts: GitHistoryFact[] = [{ relPath: ".harness/events/EVT-4.yaml", contentChangeCommitsAfterFirst: 3 }];
    const findings = checkAppendOnly(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("3 次");
  });

  it("多个文件混合：干净的不报，被改写的报", () => {
    const facts: GitHistoryFact[] = [
      { relPath: ".harness/events/clean.yaml", contentChangeCommitsAfterFirst: 0 },
      { relPath: ".harness/events/rewritten.yaml", contentChangeCommitsAfterFirst: 2 },
    ];
    const findings = checkAppendOnly(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.sourceFile).toBe(".harness/events/rewritten.yaml");
  });
});
