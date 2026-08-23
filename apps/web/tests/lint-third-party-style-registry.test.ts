import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * F07 — 第三方组件样式覆盖登记表 + lint 关卡（U9）的门控自身测试。
 *
 * 只验「脚本能跑」不验「脚本能抓到违规」等于没有门控（对齐 lint-design-gate.test.ts
 * 的验收标准）。这里用三个 CSS fixture 固化反证（R3-4）：
 *   1. 未登记的第三方覆盖 → 必须被 U9 拦截（exit 1）。
 *   2. 补登记后同一条覆盖 → 必须放行（exit 0）。
 *   3. 故意在文件头塞常见的"整文件禁用"式注释 → 仍必须被拦截，证明 U9 不支持
 *      行内 disable 绕过整个文件（R4-E2）。
 * 另外断言 globals.css 真实的登记表区块存在、且已登记的 CopilotKit 覆盖条目
 * 与它使用 lib/font-scale.ts 工具类（而非字面量数值）一致（R7）。
 */
function runLint(target: string): { code: number; out: string } {
  try {
    const out = execFileSync("./scripts/lint-design.sh", [target], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

describe("U9 未登记第三方组件样式覆盖门控", () => {
  it("反证①：未登记的第三方覆盖被拦截（exit 1，报 U9）", () => {
    const r = runLint("__fixtures__/lint-css-bad.css");
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/U9/);
    expect(r.out).toMatch(/acmeWidgetHeader/);
  });

  it("反证②：补登记 @third-party-override 后同一条覆盖放行（exit 0）", () => {
    const r = runLint("__fixtures__/lint-css-good.css");
    expect(r.code, r.out).toBe(0);
  });

  it("反证③：行内塞'禁用整个文件'式注释不能绕过 U9（仍 exit 1，仍报 U9）", () => {
    const r = runLint("__fixtures__/lint-css-disable-attempt.css");
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/U9/);
  });
});

describe("globals.css 头部第三方组件样式覆盖登记表", () => {
  const css = readFileSync("app/globals.css", "utf8");

  it("头部存在登记表区块", () => {
    expect(css).toMatch(/第三方组件样式覆盖登记表/);
    // 登记表必须在 body/:root token 定义之前 —— 在文件真正头部，而不是随便找个地方塞
    const registryIdx = css.indexOf("第三方组件样式覆盖登记表");
    const firstRuleIdx = css.indexOf("@layer base");
    expect(registryIdx).toBeGreaterThan(-1);
    expect(registryIdx).toBeLessThan(firstRuleIdx);
  });

  it("已登记 CopilotKit 覆盖条目，且指向实际存在的覆盖选择器", () => {
    const entry = css.match(/@third-party-override:\s*@copilotkit\/react-ui\s*\|([^|]+)\|/);
    expect(entry, "globals.css 应有 @copilotkit/react-ui 的登记行").not.toBeNull();
    const selector = (entry![1] ?? "").trim();
    expect(selector).toBe(".copilotkit-message-markdown .copilotKitParagraph");
    // 该选择器对应的真实覆盖规则必须存在于文件中
    expect(css).toContain(`${selector} {`);
  });

  it("CopilotKit 覆盖值引用 font-scale 生成的工具类，不是新写的字面量数值（R7）", () => {
    const ruleMatch = css.match(
      /\.copilotkit-message-markdown \.copilotKitParagraph \{([^}]*)\}/,
    );
    expect(ruleMatch, "覆盖规则本体应存在").not.toBeNull();
    const body = ruleMatch![1] ?? "";
    // 只允许出现 @apply 工具类，不允许出现裸 px/rem 字面量数值
    expect(body).toMatch(/@apply\s+text-\d+/);
    expect(body).not.toMatch(/\d+(px|rem|em)\b/);
  });
});
