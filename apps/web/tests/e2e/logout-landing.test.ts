/**
 * `judgeLogoutLanding`（#2499）的反例——独立审要求「红在测试里，不是红在注释里」。
 * 每条反例同时对照旧的宽松断言 `/\/login(\?.*)?$/`：旧写法放行、新判定拒绝，
 * 这就是把断言从正则换成解析的全部理由。
 */
import { describe, expect, it } from "vitest";
import { expectedPostLoginLanding, judgeLogoutLanding } from "../../e2e/logout-landing";

const OLD_BROAD = /\/login(\?.*)?$/;
const ORIGIN = "http://127.0.0.1:3000";

describe("judgeLogoutLanding：只接受两种有意的登出落点", () => {
  it("接受 /login（登出按钮先到）", () => {
    expect(judgeLogoutLanding(`${ORIGIN}/login`, "/profile", ORIGIN).ok).toBe(true);
  });

  it("接受 /login?next=%2Fprofile（匿名守卫先到，next 就是登出时所在路径）", () => {
    expect(judgeLogoutLanding(`${ORIGIN}/login?next=%2Fprofile`, "/profile", ORIGIN).ok).toBe(true);
  });

  const counterexamples: Array<[string, string]> = [
    ["外域落点（pathname / 查询串全合规，只有 origin 能拦）", `https://evil.example/login?next=%2Fprofile`],
    ["外域落点（不带 next）", `https://evil.example/login`],
    ["同主机不同端口也算外域", `http://127.0.0.1:3001/login`],
    ["重复的 next（第二个是外域）", `${ORIGIN}/login?next=%2Fprofile&next=https%3A%2F%2Fevil.example`],
    ["外域回跳目标", `${ORIGIN}/login?next=https%3A%2F%2Fevil.example%2F`],
    ["指回 /login 的循环值", `${ORIGIN}/login?next=%2Flogin`],
    ["错误的站内目标", `${ORIGIN}/login?next=%2Fprojects`],
    ["多余的查询参数", `${ORIGIN}/login?next=%2Fprofile&foo=1`],
    ["带 hash", `${ORIGIN}/login?next=%2Fprofile#x`],
    ["pathname 不是 /login（子路径）", `${ORIGIN}/login/extra`],
  ];

  for (const [name, url] of counterexamples) {
    it(`拒绝：${name}`, () => {
      const verdict = judgeLogoutLanding(url, "/profile", ORIGIN);
      expect(verdict.ok, verdict.reason).toBe(false);
      expect(verdict.reason.length).toBeGreaterThan(0);
    });
  }

  it("反证：旧的宽松正则对上面的坏落点大多放行——这就是换成解析的理由", () => {
    const leaked = counterexamples
      .filter(([, url]) => OLD_BROAD.test(new URL(url).pathname + new URL(url).search))
      .map(([name]) => name);
    // 至少「外域落点 / 重复 next / 外域回跳值 / 循环 / 错误站内目标 / 多余参数」都被旧写法放行
    expect(leaked).toEqual(expect.arrayContaining([
      "外域落点（pathname / 查询串全合规，只有 origin 能拦）",
      "外域落点（不带 next）",
      "重复的 next（第二个是外域）",
      "外域回跳目标",
      "指回 /login 的循环值",
      "错误的站内目标",
      "多余的查询参数",
    ]));
  });
});

describe("expectedPostLoginLanding：登录后落点由提交时 URL 上的 next 决定（run 33662212857 的红）", () => {
  it("登出落点带 next=/profile → 登录后回 /profile，不是 /projects", () => {
    expect(expectedPostLoginLanding(`${ORIGIN}/login?next=%2Fprofile`)).toBe("/profile");
  });
  it("登出落点不带 next → /projects", () => {
    expect(expectedPostLoginLanding(`${ORIGIN}/login`)).toBe("/projects");
  });
  it("与产品代码同一规则：外域 / 循环值被 sanitizeReturnTo 收敛成 /projects", () => {
    expect(expectedPostLoginLanding(`${ORIGIN}/login?next=https://evil.example`)).toBe("/projects");
    expect(expectedPostLoginLanding(`${ORIGIN}/login?next=%2Flogin`)).toBe("/projects");
  });
});

describe("judgeLogoutLanding：expectedOrigin 只比 origin，不受 baseURL 带路径 / 尾斜杠影响", () => {
  it("baseURL 形如 http://127.0.0.1:3000/ 或带路径时仍能匹配同 origin 的落点", () => {
    expect(judgeLogoutLanding(`${ORIGIN}/login`, "/profile", `${ORIGIN}/`).ok).toBe(true);
    expect(judgeLogoutLanding(`${ORIGIN}/login`, "/profile", `${ORIGIN}/some/base`).ok).toBe(true);
  });
  it("外域落点的理由写明两边 origin", () => {
    const v = judgeLogoutLanding("https://evil.example/login", "/profile", ORIGIN);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("evil.example");
    expect(v.reason).toContain(ORIGIN);
  });
});
