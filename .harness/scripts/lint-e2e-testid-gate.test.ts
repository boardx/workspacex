/**
 * lint-e2e-testid-gate 的反证套件（issue #2128）。
 *
 * 这道门最危险的失效形态**不是判错**，是**恒绿**：正则失配 ⇒ 一条引用都没抽到 ⇒
 * 天天打印 ✅ 而什么都没在管。本仓已九次栽在这个形状上，所以下面每一条判定都配了
 * 反向反证：既证"该红时红"，也证"该绿时绿"。
 *
 * 最后一组跑**真仓库**，并在真数据上做一次变异（把源码里某个 testid 改名）——
 * 这是「门控真的会抓东西」唯一说得过去的证据；只断言"今天判绿"是自证空转。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkTestidGate, run, stripComments, toPattern, looksLikeTestid, extractReferences,
  SPEC_ROOTS, SOURCE_ROOTS, SOURCE_EXTS, listFiles,
// @ts-expect-error —— .mjs 无类型声明
} from "./lint-e2e-testid-gate.mjs";

const ROOT = join(__dirname, "..", "..");
type Result = { ok: boolean; failures: string[]; checked: number; exempted: number; skipped: number; declarations: number };

/** 一份最小但**非空**的源码，保证空集防线不会替判定背锅。 */
const SRC = ['src/a.tsx', '<div data-testid="kept-anchor" /><span data-testid="lonely" />'] as const;
const gate = (spec: string, src: readonly [string, string] = SRC): Result =>
  checkTestidGate([["e2e/x.spec.ts", spec]], [src]) as Result;

describe("核心判定：spec 锚着源码里不存在的 testid ⇒ 红", () => {
  it("testid 被删而 spec 没跟进 ⇒ 红，并点名文件、行号、testid", () => {
    const r = gate('await expect(page.getByTestId("gone-anchor")).toBeVisible();');
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/e2e\/x\.spec\.ts:1 引用的 `gone-anchor` 在源码里找不到/);
  });
  it("testid 还在 ⇒ 绿（反向反证：门不是逢引用必红）", () => {
    expect(gate('await expect(page.getByTestId("kept-anchor")).toBeVisible();')).toMatchObject({ ok: true, checked: 1 });
  });
  it("`[data-testid=\"x\"]` 选择器写法同样被抓", () => {
    expect(gate('page.locator(\'[data-testid="gone-anchor"]\')').ok).toBe(false);
    expect(gate('page.locator(\'[data-testid="kept-anchor"]\')').ok).toBe(true);
  });
  it("同文件常量能解析（`const A = \"…\"` + `getByTestId(A)`）", () => {
    expect(gate('const A = "gone-anchor";\npage.getByTestId(A);').ok).toBe(false);
    expect(gate('const A = "kept-anchor";\npage.getByTestId(A);').ok).toBe(true);
  });
});

describe("声明侧两层判据池——#2128 的「① 我的正则漏抓」那五条", () => {
  it("CSS 选择器里的声明算数（`copilot-assistant-message` 只写在 .css 里）", () => {
    expect(gate('page.getByTestId("copilot-assistant-message")',
      ["src/a.css", '[data-testid="copilot-assistant-message"] { color: red }']).ok).toBe(true);
  });
  it("经 `testid` prop 传递的声明算数（`skill-create-modal`）", () => {
    expect(gate('page.getByTestId("skill-create-modal")', ["src/a.tsx", '<Modal testid="skill-create-modal" />']).ok).toBe(true);
  });
  it("映射表/数组里的裸字符串算数（`ADMIN_NAV_TESTID` / 模板数组的 `id`）", () => {
    expect(gate('page.getByTestId("admin-nav-org-members")',
      ["src/a.ts", 'export const NAV = { "org-members": "admin-nav-org-members" };']).ok).toBe(true);
  });
  it("单词型 testid 只走属性锚定层（`loading` 没有连字符，泛字面量层不收）", () => {
    expect(looksLikeTestid("loading")).toBe(false);
    expect(gate('page.getByTestId("loading")', ["src/a.tsx", '<div data-testid="loading" />']).ok).toBe(true);
    expect(gate('page.getByTestId("loading")', ["src/a.tsx", 'const msg = "loading";']).ok).toBe(false);
  });
});

describe("插值：声明侧退化成通配符，引用侧同样折成模式", () => {
  it("``data-testid={`${p}-form`}`` 让 `tpl-wf-saveorg-form` 判绿（刻意的宽松，见头注）", () => {
    expect(gate('page.getByTestId("tpl-wf-saveorg-form")', ["src/a.tsx", "<div data-testid={`${prefix}-form`} />"]).ok).toBe(true);
  });
  it("带插值的引用也能落到带插值的声明上（`canvas-template-usage-${k}-1`）", () => {
    expect(gate("page.getByTestId(`canvas-template-usage-${key}-1`)",
      ["src/a.tsx", "<span data-testid={`canvas-template-usage-${t.key}-${t.version}`} />"]).ok).toBe(true);
  });
  it("⚠ 泛字面量层**不收**带插值的串：`skill-${uuid}` 折成 `skill-*` 会把半个仓库判绿", () => {
    // 这是实测出来的坑：`skill-${crypto.randomUUID()}` 是个业务 id 生成式，
    // 跟 testid 毫无关系，一旦进池子就让每个 `skill-…` 引用无条件判绿。
    expect(gate('page.getByTestId("skill-create-panel")',
      ["src/a.ts", "const id = `skill-${crypto.randomUUID()}`;"]).ok).toBe(false);
    // 写在 testid 属性位上时才算数（属性锚定层）。
    expect(gate('page.getByTestId("skill-create-panel")',
      ["src/a.tsx", "<div data-testid={`skill-${kind}-panel`} />"]).ok).toBe(true);
  });
  it("`${a}-${b}` 这种没有可用静态片段的模式不进判据池——否则门恒绿", () => {
    expect(toPattern("${a}-${b}")).toBeNull();
    expect(gate('page.getByTestId("anything-at-all")', ["src/a.tsx", "<div data-testid={`${a}-${b}`} />"]).ok).toBe(false);
  });
});

describe("注释不算引用（两侧都是）", () => {
  it("spec 注释里逐字引用已删掉的 testid ⇒ 不判红（core-loop.spec.ts 的复盘注释）", () => {
    expect(gate('// 原文是 page.getByTestId("chat-agent-run-status")\npage.getByTestId("kept-anchor");')).toMatchObject({ ok: true });
  });
  it("源码注释里提到的 testid 不算声明——拿「它不存在」证明「它存在」是反的", () => {
    expect(gate('page.getByTestId("ghost-anchor")',
      ["src/a.tsx", '/** `ghost-anchor` 这个锚点不存在于 DOM */\n<div data-testid="kept-anchor" />']).ok).toBe(false);
  });
  it("stripComments 不碰字符串里的 `//`，也不碰正则字面量", () => {
    const stripped = stripComments('const u = "https://x/y"; // 注释') as string;
    expect(stripped.trimEnd()).toBe('const u = "https://x/y";');
    expect(stripComments("x.replace(/\\//g, '') // c")).toContain("x.replace(/\\//g, '')");
  });
  it("stripComments 保留行数与下标（行号不能漂）", () => {
    const src = "a\n// 注释\nb";
    expect(stripComments(src).split("\n").length).toBe(3);
    expect(stripComments(src).length).toBe(src.length);
  });
});

describe("豁免：「断言它不存在」的故意引用", () => {
  const ABSENT = 'await expect(page.getByTestId("gone-anchor")).toHaveCount(0); // testid-gate: absent 已刻意撤掉';
  it("加了行内标注 ⇒ 绿，且计入 exempted 而不是 checked", () => {
    expect(gate(ABSENT)).toMatchObject({ ok: true, exempted: 1, checked: 0 });
  });
  it("不加标注 ⇒ 仍然红（反向反证：豁免不是默认行为）", () => {
    expect(gate('await expect(page.getByTestId("gone-anchor")).toHaveCount(0);').ok).toBe(false);
  });
  it("标注独占一行时豁免下一行", () => {
    expect(gate('// testid-gate: absent 已刻意撤掉\nawait expect(page.getByTestId("gone-anchor")).toHaveCount(0);')).toMatchObject({ ok: true, exempted: 1 });
  });
  it("⚠ 行尾标注**不**顺手豁免下一行——否则会静默放过一条真引用", () => {
    // core-loop.spec.ts 里 `registration-code` 的下一行正是 `registration-org-name`。
    const r = gate(`${ABSENT}\npage.getByTestId("also-gone");`);
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/`also-gone`/);
    expect(r.exempted).toBe(1);
  });
  it("防腐①：标注覆盖不到任何引用 ⇒ 红（陈旧标注）", () => {
    const r = gate('// testid-gate: absent 谁也没覆盖\nconst x = 1;\npage.getByTestId("kept-anchor");');
    expect(r.failures.join("\n")).toMatch(/陈旧标注/);
  });
  it("防腐②：被豁免的 testid 又回到源码里 ⇒ 红（豁免已无意义）", () => {
    const r = gate('await expect(page.getByTestId("kept-anchor")).toHaveCount(0); // testid-gate: absent');
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/标注已无意义/);
  });
});

describe("解析不了的引用：跳过并计数，不假装检查过", () => {
  it("正则参数与跨文件常量进 skipped，不影响判定", () => {
    const r = gate('page.getByTestId(/^chat-chip-/);\npage.getByTestId(IMPORTED_CONST);\npage.getByTestId("kept-anchor");');
    expect(r).toMatchObject({ ok: true, checked: 1 });
    expect(r.skipped).toBe(2);
  });
  it("extractReferences 把它们如实分到 skipped", () => {
    const { refs, skipped } = extractReferences('page.getByTestId("a-b");\npage.getByTestId(X);') as
      { refs: { literal: string }[]; skipped: unknown[] };
    expect(refs.map((r) => r.literal)).toEqual(["a-b"]);
    expect(skipped).toHaveLength(1);
  });
});

describe("空集防线：门控自己不许平凡为真", () => {
  it("一个 spec 都没扫到 ⇒ 红", () => {
    expect(checkTestidGate([], [SRC]).ok).toBe(false);
  });
  it("一个源码文件都没扫到 ⇒ 红", () => {
    expect(checkTestidGate([["e2e/x.spec.ts", 'page.getByTestId("a-b")']], []).ok).toBe(false);
  });
  it("判据池为空 ⇒ 红（正则失配时结论无意义，不许当成「全都不存在」）", () => {
    const r = checkTestidGate([["e2e/x.spec.ts", 'page.getByTestId("a-b")']], [["src/a.ts", "export const x = 1;"]]) as Result;
    expect(r.declarations).toBe(0);
    expect(r.failures.join("\n")).toMatch(/判据池是空的/);
  });
  it("一条引用都没抽到 ⇒ 红（引用侧正则失配的签名）", () => {
    const r = checkTestidGate([["e2e/x.spec.ts", "const a = 1;"]], [SRC]) as Result;
    expect(r.failures.join("\n")).toMatch(/一条 testid 引用都没抽到/);
  });
  it("⚠ 但「引用全被豁免」不算空转——判据是抽到的引用总数，不是 checked", () => {
    const r = gate('page.getByTestId("gone-anchor"); // testid-gate: absent');
    expect(r).toMatchObject({ ok: true, checked: 0, exempted: 1 });
    expect(r.failures).toEqual([]);
  });
});

describe("真仓库", () => {
  const real = run() as Result;
  it("今天判绿", () => {
    expect(real.failures).toEqual([]);
    expect(real.ok).toBe(true);
  });
  it("而且真的在管东西——引用/判据都不是零，豁免是少数", () => {
    expect(real.checked).toBeGreaterThan(500);
    expect(real.declarations).toBeGreaterThan(500);
    expect(real.exempted).toBeLessThan(real.checked / 50);
  });
  it("扫到的 spec 文件覆盖了真实 e2e 目录", () => {
    expect((listFiles(SPEC_ROOTS[0], [".spec.ts"]) as string[]).length).toBeGreaterThan(50);
    expect(SOURCE_ROOTS).toContain("apps/web/components");
  });

  /**
   * 真数据变异：把源码里 `copilotkit-v2-messages` 的**唯一**声明点改名，
   * 模拟 #2128 的「删东西」。门必须当场红，且点名这个 testid。
   * 这条与 `.harness/scripts/lib/gate-mutation-spec.ts` 登记的同名变异是一回事——
   * 那边在临时 worktree 里跑真进程，这边在内存里跑纯函数，快到可以进 verify:harness。
   */
  it("变异反证：源码里改掉一个 e2e 还锚着的 testid ⇒ 立刻红", () => {
    const declFile = "apps/web/components/chat/copilotkit-v2-panel-body.tsx";
    const specs = (listFiles(SPEC_ROOTS[0], [".ts"]) as string[]).map((f) => [f, readFileSync(join(ROOT, f), "utf8")]);
    const sources = SOURCE_ROOTS.flatMap((r: string) => listFiles(r, SOURCE_EXTS) as string[]).map((f: string) => {
      const text = readFileSync(join(ROOT, f), "utf8");
      return [f, f === declFile ? text.replaceAll('"copilotkit-v2-messages"', '"copilotkit-v2-messages-probe-renamed"') : text];
    });
    // 变异必须真的生效——否则下面的「红了」证明不了任何事（INEFFECTIVE ≠ CAUGHT）。
    expect(sources.find(([f]: string[]) => f === declFile)![1]).toContain("copilotkit-v2-messages-probe-renamed");

    const mutated = checkTestidGate(specs, sources) as Result;
    expect(mutated.ok).toBe(false);
    expect(mutated.failures.join("\n")).toMatch(/`copilotkit-v2-messages`/);
  });
});

describe("门控已接进标准验证路径——没有脚本的规范条目视为未落地", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  it("package.json 有 lint:e2e-testid-gate", () => {
    expect(pkg.scripts["lint:e2e-testid-gate"]).toContain("lint-e2e-testid-gate.mjs");
  });
  it("verify:harness:raw 真的会跑到它", () => {
    expect(pkg.scripts["verify:harness:raw"]).toContain("lint:e2e-testid-gate");
  });
});
