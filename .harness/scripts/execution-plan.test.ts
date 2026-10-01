/**
 * execution-plan.mjs 的反证套件。
 *
 * 这道门最容易的失效形态：解析器一个节点都没认出来 ⇒「每个节点都有状态」平凡为真。
 * 所以空集防线本身也要有反证；每条判定都先证明它会红，再证明合规写法是绿。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkPlan,
  checkSkillEntry,
  setNodeStatus,
  summarize,
  run,
  classDefLine,
  PLAN_STATUSES,
  SPEC_FILE,
  TEMPLATE_FILE,
  // @ts-expect-error —— .mjs 无类型声明
} from "./execution-plan.mjs";

const ROOT = join(__dirname, "..", "..");
const DEFS = (PLAN_STATUSES as { id: string; def: string }[]).map((s) => `  ${classDefLine(s)}`).join("\n");

function plan(body: string, defs = DEFS): string {
  return `# 计划\n\n\`\`\`mermaid\nflowchart TD\n${body}\n${defs}\n\`\`\`\n`;
}
const GOOD = plan(`  G([目标：修好登录])
  S1[1. 复现问题] --> S2{2. 是后端吗?}
  S2 -->|是| S3[3. 修 API]
  G --> S1
  class G doing
  class S1 tested
  %% evidence S1: pnpm test login → exit 0
  class S2 doing
  class S3 blocked
  %% blocked S3: 等人类给测试账号`);

describe("合规计划 ⇒ 绿", () => {
  it("形状括号、判断节点、边标签都能解析；计数正确", () => {
    const r = checkPlan(GOOD);
    expect(r.failures).toEqual([]);
    expect(r.counts).toEqual({ todo: 0, doing: 2, done: 0, tested: 1, blocked: 1 });
  });
  it("仓库里的模板本身通过完整校验", () => {
    expect(checkPlan(readFileSync(join(ROOT, TEMPLATE_FILE), "utf8")).failures).toEqual([]);
  });
});

describe("判定①：一个流程图块", () => {
  it("没有 mermaid 块 ⇒ 红", () => {
    expect(checkPlan("# 只有文字").failures[0]).toMatch(/有且只有一个/);
  });
  it("两个块 ⇒ 红", () => {
    expect(checkPlan(GOOD + GOOD).failures[0]).toMatch(/实际 2 个/);
  });
  it("不是流程图 ⇒ 红", () => {
    expect(checkPlan(GOOD.replace("flowchart TD", "sequenceDiagram")).failures.join()).toMatch(/必须是流程图/);
  });
});

describe("判定②：调色板单源", () => {
  it("改了一个颜色 ⇒ 红并指出应为何值", () => {
    const r = checkPlan(GOOD.replace("fill:#bbf7d0", "fill:#00ff00"));
    expect(r.failures.join()).toMatch(/状态 done 的颜色与调色板不一致/);
  });
  it("少一个 classDef ⇒ 红", () => {
    const r = checkPlan(GOOD.replace(/^.*classDef blocked.*$/m, ""));
    expect(r.failures.join()).toMatch(/缺少状态 blocked/);
  });
  it("规范里通用提示词的 classDef 副本与调色板一致且齐全", () => {
    const spec = readFileSync(join(ROOT, SPEC_FILE), "utf8");
    for (const s of PLAN_STATUSES as { id: string; def: string }[]) expect(spec).toContain(classDefLine(s));
  });
});

describe("判定③：每个节点恰好一个合法状态", () => {
  it("节点没有 class 行 ⇒ 红", () => {
    expect(checkPlan(GOOD.replace("  class S2 doing\n", "")).failures.join()).toMatch(/「S2」.*没有状态/);
  });
  it("同一节点两条状态 ⇒ 红", () => {
    expect(checkPlan(GOOD.replace("class S2 doing", "class S2 doing\n  class S2 done")).failures.join()).toMatch(/多条状态/);
  });
  it("未知状态 ⇒ 红", () => {
    expect(checkPlan(GOOD.replace("class S2 doing", "class S2 wip")).failures.join()).toMatch(/未知状态「wip」/);
  });
  it("class 指向未声明节点 ⇒ 红", () => {
    expect(checkPlan(GOOD.replace("class S2 doing", "class S2,S9 doing")).failures.join()).toMatch(/未声明的节点「S9」/);
  });
  it(":::简写 ⇒ 红（状态只许写在一处）", () => {
    expect(checkPlan(GOOD.replace("S3[3. 修 API]", "S3[3. 修 API]:::blocked")).failures.join()).toMatch(/:::/);
  });
});

describe("判定④⑤：红必有原因、紫必有证据", () => {
  it("blocked 没写原因 ⇒ 红", () => {
    expect(checkPlan(GOOD.replace(/^.*%% blocked S3.*$/m, "")).failures.join()).toMatch(/「S3」标了 blocked/);
  });
  it("tested 没写证据 ⇒ 红", () => {
    expect(checkPlan(GOOD.replace(/^.*%% evidence S1.*$/m, "")).failures.join()).toMatch(/「S1」标了 tested/);
  });
});

describe("空集防线", () => {
  it("一个带标签的节点都没有 ⇒ 红（否则判定③平凡为真）", () => {
    expect(checkPlan(plan("  A --> B")).failures.join()).toMatch(/空集防线/);
  });
});

describe("set：只改一行，并维护原因 / 证据注释", () => {
  it("改状态 + 写证据 ⇒ 计划仍合规", () => {
    const next = setNodeStatus(GOOD, "S2", "tested", "pnpm test → exit 0");
    expect(next).toMatch(/class S2 tested\n\s*%% evidence S2: pnpm test → exit 0/);
    expect(checkPlan(next).failures).toEqual([]);
  });
  it("离开 blocked ⇒ 删掉旧原因，不留过期红色说明", () => {
    const next = setNodeStatus(GOOD, "S3", "doing");
    expect(next).not.toMatch(/%% blocked S3/);
    expect(checkPlan(next).failures).toEqual([]);
  });
  it("合并写法 `class A,B x` 里改一个 ⇒ 拆成一节点一行", () => {
    const merged = GOOD.replace("  class G doing\n", "").replace("class S2 doing", "class G,S2 doing");
    const next = setNodeStatus(merged, "S2", "done");
    expect(next).toMatch(/class G doing/);
    expect(next).toMatch(/class S2 done/);
  });
  it("未知节点 / 未知状态 / 对 doing 写 --note ⇒ 抛错", () => {
    expect(() => setNodeStatus(GOOD, "S9", "done")).toThrow(/不存在/);
    expect(() => setNodeStatus(GOOD, "S2", "finished")).toThrow(/未知状态/);
    expect(() => setNodeStatus(GOOD, "S2", "doing", "x")).toThrow(/--note/);
  });
});

describe("summary / run", () => {
  it("summary 给出各色计数与红色原因", () => {
    const s = summarize(GOOD);
    expect(s.text).toMatch(/共 4 步/);
    expect(s.text).toMatch(/S3.*等人类给测试账号/);
  });
  it("默认 check 扫描真实仓库 ⇒ 绿，且至少判过 skill 入口、规范、模板", () => {
    const r = run(["check"], ROOT);
    expect(r.out.join("\n")).toMatch(/SKILL\.md/);
    expect(r.out.join("\n")).toMatch(/execution-plan-visualization\.md/);
    expect(r.out.join("\n")).toMatch(/execution-plan\.template\.md/);
    expect(r.ok).toBe(true);
  });
  it("skill 入口抄了色值 / 没引用规范 ⇒ 红", () => {
    expect(checkSkillEntry(`见 ${SPEC_FILE}\n  classDef done fill:#bbf7d0`).join()).toMatch(/复述了调色板/);
    expect(checkSkillEntry("什么都没写").join()).toMatch(/没有引用规范/);
    expect(checkSkillEntry(null).join()).toMatch(/不存在/);
  });
});
