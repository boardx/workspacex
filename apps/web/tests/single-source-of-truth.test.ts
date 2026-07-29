import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FONT_SCALE, FONT_SCALE_KEYS } from "../lib/font-scale";

/**
 * 单一事实源断言（UC-0.4 R12 V4 / AC2 —— 「副本数 = 1」可被机器断言）
 *
 * §1.2 记录的事故根因是「字号表有三份副本靠人肉对齐」。这里逐条钉死：
 * tailwind.config.ts 与 lib/utils.ts 都必须**从 font-scale.ts 取值**，不得手抄。
 */
describe("字号档位单一事实源", () => {
  const twConfig = readFileSync(new URL("../tailwind.config.ts", import.meta.url), "utf8");
  const utils = readFileSync(new URL("../lib/utils.ts", import.meta.url), "utf8");

  it("tailwind.config.ts 从 font-scale.ts import", () => {
    expect(twConfig).toMatch(/import\s*\{\s*FONT_SCALE\s*\}\s*from\s*"\.\/lib\/font-scale"/);
  });

  it("tailwind.config.ts 不含字面量 fontSize 对象（第二份副本）", () => {
    expect(twConfig).not.toMatch(/fontSize:\s*\{/);
    expect(twConfig).toMatch(/fontSize:\s*FONT_SCALE/);
  });

  it("lib/utils.ts 用 FONT_SCALE_KEYS 登记 tailwind-merge，不手抄清单", () => {
    expect(utils).toMatch(/FONT_SCALE_KEYS/);
    // 手抄的迹象：utils 里出现成串的数字字面量
    expect(utils).not.toMatch(/\[\s*"?\d+"?\s*,\s*"?\d+"?\s*,\s*"?\d+"?/);
  });

  it("档位表非空且键为纯数字", () => {
    expect(FONT_SCALE_KEYS.length).toBeGreaterThan(0);
    FONT_SCALE_KEYS.forEach((k) => expect(k).toMatch(/^\d+$/));
  });

  it("每档都带 lineHeight（避免行高散落各处成为第二份隐性副本）", () => {
    Object.entries(FONT_SCALE).forEach(([, v]) => {
      expect(v[1].lineHeight).toBeTruthy();
    });
  });
});

/**
 * 认证策略数值单一事实源（F20 / O-28、O-29）
 *
 * 事故形状与字号表那次一模一样：`lib/mock/entry.ts` 手写了 sessionDays / passwordMinLen /
 * resetLinkHours / lockAfterFails / lockWindowMinutes / lockDurationMinutes 六个数字，
 * 而后端实现登录锁定与密码重置时必然要再写一份。两份都自洽，直到有人只改其中一份。
 *
 * ⇒ 唯一那份收敛进 `packages/contracts/src/auth.ts`。这里钉死「前端没有第二份」。
 */
describe("认证策略数值单一事实源", () => {
  const entry = readFileSync(new URL("../lib/mock/entry.ts", import.meta.url), "utf8");

  it("entry.ts 从契约 re-export AUTH_POLICY，不自己声明", () => {
    expect(entry).toMatch(/export\s*\{\s*AUTH_POLICY\s*\}\s*from\s*"@repo\/contracts\/auth"/);
    // 手抄的迹象：本地又出现 `export const AUTH_POLICY = {`
    expect(entry).not.toMatch(/export\s+const\s+AUTH_POLICY\s*=/);
  });

  it("契约里的策略数值与 O-28 / O-29 裁决逐条一致", async () => {
    const { AUTH_POLICY } = await import("@repo/contracts/auth");
    // ⚠ 断言的是「每一项与裁决一致」而不是 `toHaveLength(n)`——后者会把一次经评审的
    // 正当新增当成失败（contract-design 硬规则 7）。
    expect(AUTH_POLICY.sessionDays).toBe(30); //           UC-1.1 R3 第 2 步 [Backlog]
    expect(AUTH_POLICY.passwordMinLen).toBe(12); //        O-28 ①
    expect(AUTH_POLICY.resetLinkHours).toBe(1); //         O-28 ④
    expect(AUTH_POLICY.lockAfterFails).toBe(5); //         O-28 ③
    expect(AUTH_POLICY.lockWindowMinutes).toBe(15); //     O-28 ③
    expect(AUTH_POLICY.lockDurationMinutes).toBe(15); //   O-28 ③
    expect(AUTH_POLICY.resendCooldownSeconds).toBe(60); // O-28 ④
    expect(AUTH_POLICY.resendDailyMax).toBe(5); //         O-28 ④
    expect(AUTH_POLICY.inviteCodeLength).toBe(14); //      UC-1.5 / O-29 ①
  });

  /**
   * ⚠ 断言的是**代码**不是注释。
   *
   * 本条第一版写的是 `expect(loginForm).not.toMatch(/AUTH_POLICY 无此项/)`——
   * 于是解释「为什么原来那样写不对」的注释本身把门控打红了。
   * 这正是 coding-standards 里那条「过度触发的门控会被静音」：一个会因为注释措辞
   * 而失败的检查，第一次误报就会被人删掉，之后真正的副本回来了也没人拦。
   * ⇒ 改成断言真正要守的性质：长度判断从契约取值，不是字面量。
   */
  it("登录页组件的邀请码长度判断取自契约，不是字面量 14", () => {
    const loginForm = readFileSync(new URL("../components/entry/login-form.tsx", import.meta.url), "utf8");
    expect(loginForm).toMatch(/codeLen === AUTH_POLICY\.inviteCodeLength/);
    // 手抄的迹象：直接拿字面量比长度
    expect(loginForm).not.toMatch(/codeLen\s*===\s*14/);
  });
});

describe("设计 token 单一事实源", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  it("globals.css 同时定义明暗两套主题", () => {
    expect(css).toMatch(/:root\s*\{/);
    expect(css).toMatch(/\.dark\s*\{/);
  });

  it("每个被标注的色面 token 都有配对 foreground", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
    const declared = [...root.matchAll(/--([a-z0-9-]+)\s*:\s*[\d.]+\s+[\d.]+%\s+[\d.]+%/g)].map((m) => m[1]!);
    const bases = declared.filter((k) => !k.endsWith("-foreground"));
    const structural = new Set(["border", "border-subtle", "input", "ring"]);
    bases.filter((b) => !structural.has(b)).forEach((b) => {
      expect(declared, `--${b} 缺少配对 --${b}-foreground`).toContain(`${b}-foreground`);
    });
  });
});
