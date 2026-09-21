/**
 * lint-contract-state-names 的反证套件（#3140）。
 *
 * 本仓已九次「全绿但空转」，#3122 刚又栽一次。写完门控立刻造反证是纪律，不是可选项：
 * 每一条断言都对应一种**真实发生过或极可能发生**的破坏方式，先确认它会红，
 * 才有资格相信它绿的时候说明了什么。
 *
 * 分工：本文件用**构造出来的文本**逐条钉抽取与判定规则（快、可穷举、不依赖仓库现状），
 * 外加两条对真实仓库的断言（基线必须绿；把真文件的内容注入漂移必须红）。
 * 「整道门在真 worktree 上跑一遍」那层由 `pnpm harness gate-probe --gate contract-state-names`
 * 负责（登记在 lib/gate-mutation-spec.ts），两者不重叠。
 */
import { beforeAll, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error —— .mjs 无类型声明，故意直接引（单行写法：@ts-expect-error 必须贴在报错那一行上）
import { BINDINGS, LABEL_CHAIN_ACTIVATION, auditContractStateNames, blankComments, extractCodeClaims, extractDocClaims, inScope, judgeClaims, loadVocabulary, selfCheck } from "./lint-contract-state-names.mjs";

const REPO_ROOT = join(__dirname, "..", "..");
const PLAN_PHASE = BINDINGS.find((b: { name: string }) => b.name === "PlanPhase")!;
const ANCHOR = PLAN_PHASE.scopeAnchors[0];

/*
 * 词表**从契约里取**，不在本文件里抄一份：抄了就又是「同一事实声明在两处」——
 * 本仓已五次因此漂移，而一份抄歪的期望值清单会让整套反证对着错的东西变绿。
 */
let VALUES: string[];
let LABELS: Record<string, string>;
beforeAll(async () => {
  ({ values: VALUES, labels: LABELS } = await loadVocabulary(PLAN_PHASE));
});

function violationsIn(source: string, { doc = false } = {}) {
  const claims = doc
    ? extractDocClaims(source, PLAN_PHASE, LABELS)
    : extractCodeClaims(source, PLAN_PHASE);
  return judgeClaims({ claims, values: VALUES, labels: LABELS }).map((v: { name: string }) => v.name);
}

describe("词表来自契约本身，不是副本", () => {
  it("枚举与文案都从 plan-control.ts 读出来", async () => {
    const { values, labels } = await loadVocabulary(PLAN_PHASE);
    // 只断言形状，与那两个今天确实出过事的名字**不在**里面。
    expect(values.length).toBeGreaterThan(0);
    expect(values).not.toContain("awaiting-approval");
    expect(values).not.toContain("completed");
    expect(Object.keys(labels).sort()).toEqual([...values].sort());
  });

  it("契约模块不存在 / export 改名 ⇒ 抛错，不是静默放行", async () => {
    await expect(loadVocabulary({ ...PLAN_PHASE, module: "packages/contracts/src/no-such-file.ts" }))
      .rejects.toThrow(/契约模块不存在/);
    await expect(loadVocabulary({ ...PLAN_PHASE, valuesExport: "PlanPhaseRenamed" }))
      .rejects.toThrow(/读不到非空枚举/);
    await expect(loadVocabulary({ ...PLAN_PHASE, labelsExport: "LABELS_RENAMED" }))
      .rejects.toThrow(/读不到文案映射/);
  });
});

describe("范围：谁在管、谁不在管", () => {
  it("提到锚点 testid 的文件在范围内", () => {
    expect(inScope(`const X = "${ANCHOR}";`, PLAN_PHASE)).toBe(true);
  });

  it("没提锚点的文件不在范围内——录音器那条 data-phase 不该被误判", () => {
    // 真实存在的假红风险：core-loop.spec.ts 的录音器也叫 data-phase，值是 idle/recording。
    const recorder = `await expect(status).toHaveAttribute("data-phase", "recording");`;
    expect(inScope(recorder, PLAN_PHASE)).toBe(false);
    // 万一范围划错，这些值确实会被判违规——所以范围那一层是真在挡事，不是摆设。
    expect(violationsIn(recorder)).toEqual(["recording"]);
  });

  it("仓库里真有一个这样的文件（否则上一条只是假想）", () => {
    const src = readFileSync(join(REPO_ROOT, "apps/web/e2e/core-loop.spec.ts"), "utf8");
    expect(src).toContain('"data-phase", "recording"');
    expect(inScope(src, PLAN_PHASE)).toBe(false);
  });
});

describe("抽取：三种声明形态各自会红", () => {
  it("toHaveAttribute 式属性断言", () => {
    const src = `const a = "${ANCHOR}";\nawait expect(x).toHaveAttribute("data-phase", "completed", { timeout: 1 });`;
    expect(violationsIn(src)).toEqual(["completed"]);
  });

  it("JSX / 文档式属性字面量", () => {
    expect(violationsIn(`"${ANCHOR}"\n<div data-phase="awaiting-approval" />`)).toEqual(["awaiting-approval"]);
  });

  it("名字带 PHASE 的数组常量", () => {
    const src = `const SIX_PHASES = ["preparing", "planning", "executing", "awaiting-approval", "completed", "failed"];`;
    expect(violationsIn(src)).toEqual(["awaiting-approval", "completed"]);
  });

  it("合法态名不红（否则这门只会吵，没人会留着它）", () => {
    const src = `const PHASE_LINE = ["preparing", "planning", "executing", "approving", "done"];\n` +
      `await expect(x).toHaveAttribute("data-phase-step", "failed");`;
    expect(violationsIn(src)).toEqual([]);
  });
});

describe("抽取：哪些东西**不该**被当成声明（假红的来源）", () => {
  it("块注释里逐字引用的旧错名不算声明", () => {
    // 真实形状：那条 spec 的头注就写着「原先写的 awaiting-approval / completed 并不存在」。
    const src = `/* 原先写的 data-phase="awaiting-approval" 在实现里并不存在 */\nconst PHASES = ["done"];`;
    expect(violationsIn(src)).toEqual([]);
  });

  it("整行行注释同理", () => {
    expect(violationsIn(`// data-phase="completed" 是旧名\nconst PHASES = ["done"];`)).toEqual([]);
  });

  it("涂白注释不偏行号", () => {
    const src = `/* a\nb */\nconst PHASES = ["completed"];`;
    expect(blankComments(src).split("\n").length).toBe(3);
    expect(extractCodeClaims(src, PLAN_PHASE)[0].line).toBe(3);
  });

  it("装 testid 的字符串常量不是态名数组", () => {
    // 真实形状：chat-read-plan-surface-visibility.spec.ts 的 PHASE_INDICATOR。
    expect(violationsIn(`const PHASE_INDICATOR = "${ANCHOR}";`)).toEqual([]);
  });

  it("只问不比的 getAttribute 不声明任何态名", () => {
    expect(extractCodeClaims(`"${ANCHOR}"\nn.getAttribute("data-phase")`, PLAN_PHASE)).toEqual([]);
  });
});

describe("验收文档：中文态机链", () => {
  const chain = (...s: string[]) => `1. 存在显式状态机：**${s.join(" → ")}**，当前态可读。`;

  it("链里出现枚举外的态名 ⇒ 红", () => {
    expect(violationsIn(chain("准备", "计划", "执行", "等待审批", "完成", "失败"), { doc: true }))
      .toEqual(["等待审批"]);
  });

  it("句首引导语与句尾标点不会被当成链的一段（否则真文档天天红）", () => {
    expect(violationsIn(chain("准备", "计划", "执行", "审批", "完成", "失败"), { doc: true })).toEqual([]);
  });

  it("只判成员资格，不判完整性——ui.md 明写 failed 不上指示器那条线", () => {
    expect(violationsIn(chain("准备", "计划", "执行", "审批", "完成"), { doc: true })).toEqual([]);
  });

  it(`命中不足 ${LABEL_CHAIN_ACTIVATION} 段的箭头句不激活`, () => {
    // 真实形状：同一份文档 TW-P0-5 里的「语音 → 连接中 → 停止 + 音量条」。
    const noise = "（语音 → 连接中 → 停止 + 音量条 + 计时 → 继续 → 出错「重试」）";
    expect(violationsIn(noise, { doc: true })).toEqual([]);
    expect(violationsIn("上传材料 → 开「材料」；运行中 → 开「进度」", { doc: true })).toEqual([]);
  });

  it("漂走两个名字之后仍然激活（阈值留了余量）", () => {
    expect(violationsIn(chain("准备", "计划", "执行", "等待审批", "已完成", "失败"), { doc: true }))
      .toEqual(["等待审批", "已完成"]);
  });
});

describe("自检：门自己不许变成恒真门", () => {
  const surfaces = (files: unknown[]) => ({ binding: PLAN_PHASE, surfaces: [{ id: "spec", files }] });

  it("范围一个文件都没匹配上 ⇒ 红", () => {
    expect(selfCheck(surfaces([])).join("")).toMatch(/一个文件都没匹配上/);
  });

  it("匹配到文件但一条声明都没抽到 ⇒ 红（抽取规则漂移的形状）", () => {
    expect(selfCheck(surfaces([{ rel: "x.spec.ts", claims: [], violations: [] }])).join(""))
      .toMatch(/抽到 0 条态名声明/);
  });

  it("有声明就不报自检问题", () => {
    expect(selfCheck(surfaces([{ rel: "x.spec.ts", claims: [{ name: "done" }], violations: [] }]))).toEqual([]);
  });
});

describe("真仓库：基线绿，注入漂移红", () => {
  it("今天的 main 上没有对不上的态名", async () => {
    const reports = await auditContractStateNames();
    const violations = reports.flatMap((r: any) =>
      r.surfaces.flatMap((s: any) => s.files.flatMap((f: any) => f.violations.map((v: any) => `${f.rel}:${v.line} ${v.name}`))),
    );
    expect(violations).toEqual([]);
    for (const r of reports) expect(selfCheck(r)).toEqual([]);
  });

  it("门确实盯着那两个文件，且在看真东西（不是扫了个空）", async () => {
    const reports = await auditContractStateNames();
    const files = reports.flatMap((r: any) => r.surfaces.flatMap((s: any) => s.files));
    const spec = files.find((f: any) => f.rel.endsWith("chat-task-workbench-workflow-states.spec.ts"));
    const doc = files.find((f: any) => f.rel.endsWith("chat-task-workbench-acceptance.md"));
    expect(spec.claims.length).toBeGreaterThan(0);
    expect(doc.claims.length).toBeGreaterThan(0);
  });

  it("把 #3140 现场的两个错名注回真文件内容 ⇒ 红", async () => {
    const { values, labels } = await loadVocabulary(PLAN_PHASE);
    const rel = "apps/web/e2e/chat-task-workbench-workflow-states.spec.ts";
    const drifted = readFileSync(join(REPO_ROOT, rel), "utf8")
      .replace(/"approving"/g, '"awaiting-approval"')
      .replace(/"done"/g, '"completed"');
    const violations = judgeClaims({ claims: extractCodeClaims(drifted, PLAN_PHASE), values, labels });
    expect(violations.map((v: any) => v.name)).toContain("awaiting-approval");
    expect(violations.map((v: any) => v.name)).toContain("completed");
  });
});
