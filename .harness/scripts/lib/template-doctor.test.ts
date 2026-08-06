// template-doctor.test.ts — HMV2-010/011/012 的反证。
//
// 结构同 rewrite-coverage.test.ts：先证明基线真的 PASS（否则下面反证全是空转），
// 再逐条注入违规，证明每一类都被抓住、且只抓住对应那一类。
import { describe, expect, it } from "vitest";
import {
  deadReferences,
  duplicateInstanceIds,
  retiredTemplateViolations,
  runTemplateDoctor,
  unregisteredOrUnsupportedTemplateReferences,
  type DoctorInput,
} from "./template-doctor";
import type { InstanceMetadata, TemplateRegistry } from "./template-model";

function inst(overrides: Partial<InstanceMetadata> = {}): InstanceMetadata {
  return {
    template_id: "TPL-EVT-001",
    template_version: 1,
    instance_id: "EVT-a",
    status: "active",
    scope: { project: "workspacex", phase: null },
    refs: [],
    sourceFile: "a.yaml",
    ...overrides,
  };
}

function registry(entries: TemplateRegistry["entries"] = []): TemplateRegistry {
  return {
    entries: entries.length > 0 ? entries : [
      { template_id: "TPL-EVT-001", template_version: 1, name: "Work Event", status: "active", owner: "x", consumers: [], authority: "y" },
    ],
  };
}

function baseInput(overrides: Partial<DoctorInput> = {}): DoctorInput {
  return {
    registry: registry(),
    registryParseError: null,
    instances: [inst()],
    instanceValidationFailures: [],
    ...overrides,
  };
}

describe("基线必须真的 PASS（否则下面反证都是空转）", () => {
  it("单份合法实例、注册表齐全 → PASS", () => {
    const r = runTemplateDoctor(baseInput());
    expect(r.status).toBe("PASS");
    expect(r.findings).toEqual([]);
    expect(r.instancesChecked).toBe(1);
  });

  it("0 份实例不是失败，是诚实的「还没人用」状态", () => {
    const r = runTemplateDoctor(baseInput({ instances: [] }));
    expect(r.status).toBe("PASS");
    expect(r.instancesChecked).toBe(0);
  });
});

describe("HMV2-010：instance_id 唯一性", () => {
  it("🔴 两份不同文件用同一个 instance_id → 红，且点名两个文件", () => {
    const findings = duplicateInstanceIds([
      inst({ instance_id: "EVT-a", sourceFile: "a.yaml" }),
      inst({ instance_id: "EVT-a", sourceFile: "b.yaml" }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("a.yaml");
    expect(findings[0]!.message).toContain("b.yaml");
    expect(findings[0]!.code).toBe("TPL-DUP-INSTANCE");
  });

  it("不同 instance_id 互不干扰", () => {
    expect(duplicateInstanceIds([inst({ instance_id: "EVT-a" }), inst({ instance_id: "EVT-b" })])).toEqual([]);
  });

  it("三份重复 → 报出重复的那两处配对，不是把全部三份打成一坨", () => {
    const findings = duplicateInstanceIds([
      inst({ instance_id: "EVT-a", sourceFile: "a.yaml" }),
      inst({ instance_id: "EVT-a", sourceFile: "b.yaml" }),
      inst({ instance_id: "EVT-a", sourceFile: "c.yaml" }),
    ]);
    expect(findings).toHaveLength(2); // b 撞 a、c 撞 a（c 与 b 的重复由 seen 里最早那个代表）
  });
});

describe("HMV2-012：未注册 / 版本不受支持", () => {
  it("🔴 引用了 registry 里不存在的 template_id → 红", () => {
    const findings = unregisteredOrUnsupportedTemplateReferences(
      [inst({ template_id: "TPL-XXX-999" })],
      registry(),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("TPL-REF-UNREGISTERED");
    expect(findings[0]!.message).toContain("TPL-XXX-999");
  });

  it("🔴 实例声称的 template_version 超过注册表当前登记版本 → 红", () => {
    const findings = unregisteredOrUnsupportedTemplateReferences(
      [inst({ template_version: 5 })],
      registry([{ template_id: "TPL-EVT-001", template_version: 1, name: "x", status: "active", owner: "y", consumers: [], authority: "z" }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("TPL-REF-VERSION-UNSUPPORTED");
  });

  it("版本等于注册表版本时合法（不是必须严格小于）", () => {
    expect(unregisteredOrUnsupportedTemplateReferences([inst({ template_version: 1 })], registry())).toEqual([]);
  });
});

describe("HMV2-011：retired 模板不得有活实例", () => {
  it("🔴 模板 retired、实例仍是 active → 红", () => {
    const findings = retiredTemplateViolations(
      [inst({ status: "active" })],
      registry([{ template_id: "TPL-EVT-001", template_version: 1, name: "x", status: "retired", owner: "y", consumers: [], authority: "z" }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("TPL-RETIRED-TEMPLATE-LIVE-INSTANCE");
  });

  it("模板 retired、实例也同步标成 retired → 不报（允许的历史遗留形态）", () => {
    const findings = retiredTemplateViolations(
      [inst({ status: "retired" })],
      registry([{ template_id: "TPL-EVT-001", template_version: 1, name: "x", status: "retired", owner: "y", consumers: [], authority: "z" }]),
    );
    expect(findings).toEqual([]);
  });

  it("模板仍 active 时，实例任何状态都不触发这条规则（这是版本/未注册规则的事，不是这条的事）", () => {
    expect(retiredTemplateViolations([inst({ status: "active" })], registry())).toEqual([]);
  });
});

describe("死链检测（doctor #11）", () => {
  it("🔴 refs 指向不存在的 instance_id → 红", () => {
    const findings = deadReferences([inst({ instance_id: "EVT-a", refs: ["EVT-does-not-exist"] })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("TPL-DEAD-REF");
  });

  it("refs 指向真实存在的 instance_id → 不报", () => {
    const findings = deadReferences([
      inst({ instance_id: "EVT-a", refs: ["EVT-b"] }),
      inst({ instance_id: "EVT-b" }),
    ]);
    expect(findings).toEqual([]);
  });
});

describe("G6/P7：权威数据源不可读时输出 UNKNOWN，不是「没有缺口」", () => {
  it("🔴 注册表解析失败 → UNKNOWN，且不会假装 PASS", () => {
    const r = runTemplateDoctor(baseInput({ registry: null, registryParseError: "解析失败：语法错误" }));
    expect(r.status).toBe("UNKNOWN");
    expect(r.findings[0]!.code).toBe("TPL-REGISTRY-UNREADABLE");
  });

  it("反证：这个保护确实在起作用 —— 去掉它，坏数据会被当成 PASS", () => {
    // 模拟"没有 UNKNOWN 保护"的世界：直接把 null registry 当空注册表塞进判定，
    // 会得到一个自欺欺人的 PASS（没有 registry.entries 可比对，什么都对不上）。
    const naive = runTemplateDoctor({ ...baseInput(), registry: { entries: [] }, registryParseError: null, instances: [] });
    expect(naive.status).toBe("PASS"); // 证明"看起来没问题"确实是伪装出来的
    // 而真正的判定函数在读不到注册表时不会走到这条路径，会先短路成 UNKNOWN
    const real = runTemplateDoctor(baseInput({ registry: null, registryParseError: "boom" }));
    expect(real.status).toBe("UNKNOWN");
  });

  it("notYetImplemented 如实列出 E1 阶段做不到的检查项，不假装齐全", () => {
    const r = runTemplateDoctor(baseInput());
    expect(r.notYetImplemented.length).toBeGreaterThan(0);
  });
});

describe("schema 校验失败也会汇入 doctor 报告", () => {
  it("instanceValidationFailures 里的条目会变成 FAIL finding", () => {
    const r = runTemplateDoctor(baseInput({ instanceValidationFailures: [{ sourceFile: "bad.yaml", message: "instance_id 缺失" }] }));
    expect(r.status).toBe("FAIL");
    expect(r.findings.some((f) => f.code === "TPL-INSTANCE-SCHEMA-INVALID")).toBe(true);
  });
});
