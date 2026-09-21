/**
 * lint-root-router 的反证套件。
 *
 * 每条判定都先造一个**当时真实存在过的坏状态**，确认门控会红：
 * 主用例（判定①）用的就是 #390 修复前根 AGENTS.md 里的原话——这条测试在修复前是红的，
 * 那才叫反证，不是补一张合影。
 *
 * 门控自身最容易的失效形态是**平凡为真**（签名写错、预算解析不出来就当没这回事），
 * 所以空集防线也各有一条反证。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error —— .mjs 无类型声明
import { checkRootRouter, projectNameFrom, run, TEMPLATE_RESIDUE, ROUTER_FILE, IDENTITY_SOURCE } from "./lint-root-router.mjs";

const ROOT = join(__dirname, "..", "..");

/** 一个「合格目录页」的最小骨架：判定 ①①b②③④ 全过。 */
const IDENTITY_LINE = "- **WorkSpaceX**——AI 原生的团队协作系统。";
const OK = ["# AGENTS.md", "> 硬上限 6 行。", IDENTITY_LINE, "- 分支 `worker/<owner>-<phase>-<feature>`", "- 细则见 `.harness/instructions/contract-design.md`", "最后一行"].join("\n");
const base = { projectName: "workspacex", exists: () => true };

describe("判定①：目录页不许留未解析占位符", () => {
  it("#390 修复前的原话 ⇒ 红（本套件的主反证）", () => {
    const r = checkRootRouter({ ...base, router: OK.replace(IDENTITY_LINE, "- <一句话说明你的项目>（turbo + pnpm + TypeScript monorepo）。") });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/AGENTS\.md:3 留着未解析占位符「<一句话说明你的项目>」\(human\)/);
  });
  it("换一种写法的人工占位符也要红——判据是语法，不是那一句原话", () => {
    expect(checkRootRouter({ ...base, router: OK.replace("最后一行", "<在此填写本项目目标>") }).ok).toBe(false);
  });
  it("机器替换占位符没被替掉也要红", () => {
    expect(checkRootRouter({ ...base, router: OK.replace("最后一行", "目标：{{PHASE_GOAL}}") }).ok).toBe(false);
  });
  it("路径元变量不许误伤：ASCII 的 `<phase>` 判绿（该取舍由 lib/placeholder-gate.ts 定义）", () => {
    expect(checkRootRouter({ ...base, router: OK.replace("最后一行", "`phases/<phase>/feature_list.json`") })).toMatchObject({ ok: true });
  });
});

describe("判定①b：语法合法但内容还是模板原话", () => {
  it("scaffold 残留的 ASCII 原话 ⇒ 红（判定①按定义看不见它）", () => {
    const r = checkRootRouter({ ...base, router: OK.replace("最后一行", "本仓由 agentic-harness-template 生成。") });
    expect(r.failures.join("\n")).toMatch(/仍留着模板原话「agentic-harness-template 生成」/);
  });
});

describe("判定②：删掉占位符 ≠ 写上了身份", () => {
  it("把占位符那行整行删掉 ⇒ 仍然红（否则①一删了之就能糊弄过去）", () => {
    const r = checkRootRouter({ ...base, router: OK.replace(IDENTITY_LINE, "- 一个 monorepo。") });
    expect(r.failures.join("\n")).toMatch(/通篇没出现项目名「workspacex」/);
  });
  it("项目名取自 github-sync.yaml 的 repo 字段，不在门控里另写一份", () => {
    expect(projectNameFrom('repo: "boardx/workspacex"   # 注释')).toBe("workspacex");
    expect(projectNameFrom(null)).toBe(null);
  });
});

describe("判定③：行数 ≤ 目录页自己声明的硬上限", () => {
  it("超出声明的上限 ⇒ 红并报出实际行数", () => {
    const r = checkRootRouter({ ...base, router: `${OK}\n多出来的一行\n再多一行` });
    expect(r.failures.join("\n")).toMatch(/有 8 行，超过它自己声明的硬上限 6 行/);
  });
  it("上限声明两次 ⇒ 红（同一事实不得声明在两处）", () => {
    const r = checkRootRouter({ ...base, router: OK.replace("最后一行", "> 硬上限 200 行。") });
    expect(r.failures.join("\n")).toMatch(/声明了 2 次行数上限/);
  });
});

describe("判定④：搬出去的规则必须还点得到", () => {
  it("引用的 instructions 文件不存在 ⇒ 红", () => {
    const r = checkRootRouter({ ...base, router: OK, exists: () => false });
    expect(r.failures.join("\n")).toMatch(/指向 \.harness\/instructions\/contract-design\.md，但该文件不存在/);
  });
});

describe("空集防线：门控自己不许平凡为真", () => {
  it("目录页读不到 ⇒ 红，不是跳过", () => {
    expect(checkRootRouter({ ...base, router: null }).ok).toBe(false);
  });
  it("没有「硬上限 N 行」的声明 ⇒ 红（旧文件写的是「~100 行」，机器读不出数字）", () => {
    const r = checkRootRouter({ ...base, router: OK.replace("> 硬上限 6 行。", "> 硬上限 ~100 行。") });
    expect(r.failures.join("\n")).toMatch(/没有声明「硬上限 N 行」/);
  });
  it("身份来源读不到 ⇒ 红，不是跳过", () => {
    expect(checkRootRouter({ ...base, router: OK, projectName: null }).ok).toBe(false);
  });
  it("模板残留签名列表为空 ⇒ 红", () => {
    expect(checkRootRouter({ ...base, router: OK, residue: [] }).ok).toBe(false);
  });
});

describe("真仓库", () => {
  it("今天判绿，且预算确实被声明成了一个会红的数字", () => {
    const r = run();
    expect(r).toMatchObject({ ok: true });
    expect(typeof r.budget).toBe("number");
    expect(r.lines).toBeLessThanOrEqual(r.budget);
  });
  it("残留签名列表非空，身份来源与目录页真实存在——否则上面那条会变成另一种绿", () => {
    expect(TEMPLATE_RESIDUE.length).toBeGreaterThan(0);
    expect(readFileSync(join(ROOT, IDENTITY_SOURCE), "utf8")).toMatch(/^\s*repo:/m);
    expect(readFileSync(join(ROOT, ROUTER_FILE), "utf8")).toContain("WorkSpaceX");
  });
});
