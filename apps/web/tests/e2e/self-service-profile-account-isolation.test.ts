/**
 * #2086 —— 机械门控：同一个 playwright config 下的 spec 文件之间**不得共用登录账号**。
 *
 * 这条规矩原本只写在散文里（`self-service-profile-fixture.ts` 头注、
 * `seed-self-service-profile-e2e.ts` 头注、`keyboardEmail` / `orgAdminKeyboardAdminEmail`
 * 两条字段头注，共四处），F15 还是破了它——`profile-org-fidelity.spec.ts` 复用了
 * admin 账号，理由是「只读」。代价是 `e2e-full` 连红十次、藏了 39 小时。
 *
 * 本仓根 AGENTS.md 的原话：**没有脚本的规范条目视为未落地**。所以这里把它变成
 * 一条会红的东西。
 *
 * 为什么「只读」不是共用账号的理由：`playwright.self-service-profile.config.ts` 里的
 * `fullyParallel: false` **只保证同一个文件内的用例串行**，不阻止不同 spec 文件被
 * 分到不同 worker 并行跑。CI 日志逐字是 `Running 4 tests using 2 workers`。
 * `self-service-profile.spec.ts` 会真的改掉它那个账号的密码并 logout；任何**读**
 * 同一个账号的 spec，其已建立的会话都会在半路失效。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = resolve(__dirname, "../..");
const E2E_DIR = resolve(WEB_ROOT, "e2e");

/** 与 `playwright.self-service-profile.config.ts` 的 `testMatch` 保持一致。 */
const TEST_MATCH =
  /(self-service-profile|profile-keyboard-navigation|org-admin-keyboard-navigation|profile-org-fidelity)\.spec\.ts$/;

/**
 * `self-service-profile.spec.ts` 自己那条「改密码后旧密码不可登录」的反证要用到
 * 两个口令字面量（原密码 + 新密码），它们指的是**同一个账号**，因此归并成一个身份。
 */
const ALIASES: Record<string, string> = { newPassword: "adminPassword" };

function specFiles(): string[] {
  return readdirSync(E2E_DIR)
    .filter((name) => TEST_MATCH.test(name))
    .sort();
}

/** 抽出某个 spec 引用到的登录身份（以 `SELF_SERVICE_PROFILE_E2E.<x>Password` 为锚）。 */
function accountsUsedBy(specName: string): string[] {
  const src = readFileSync(resolve(E2E_DIR, specName), "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/SELF_SERVICE_PROFILE_E2E\.([A-Za-z0-9_]*Password)\b/g)) {
    const field = m[1];
    if (!field) continue;
    found.add(ALIASES[field] ?? field);
  }
  return [...found].sort();
}

describe("#2086 self-service-profile config 下的 spec 账号隔离", () => {
  it("testMatch 真的匹配到了 spec（否则本门控是空转的）", () => {
    // 反证保护：如果哪天 spec 改名/移走而这里的 TEST_MATCH 没同步，
    // 下面那条唯一性断言会因为「没有数据」而假绿。先把这种情况打红。
    expect(specFiles().length).toBeGreaterThanOrEqual(4);
  });

  it("每个 spec 文件都真的声明了登录身份", () => {
    for (const spec of specFiles()) {
      expect(accountsUsedBy(spec), `${spec} 没有引用任何 SELF_SERVICE_PROFILE_E2E.*Password`)
        .not.toHaveLength(0);
    }
  });

  it("任何一个账号都不被两个 spec 文件共用", () => {
    const owners = new Map<string, string[]>();
    for (const spec of specFiles()) {
      for (const account of accountsUsedBy(spec)) {
        owners.set(account, [...(owners.get(account) ?? []), spec]);
      }
    }

    const shared = [...owners.entries()].filter(([, specs]) => specs.length > 1);
    expect(
      shared,
      shared.length === 0
        ? ""
        : "以下账号被多个 spec 共用；它们会被分到不同 worker 并行跑，"
          + "改密码/改显示名的一方会让另一方半路掉登录态（#2086）。"
          + "请照 `self-service-profile-fixture.ts` 的 F05/F06 范式加专属账号：\n"
          + shared.map(([account, specs]) => `  ${account} ← ${specs.join(", ")}`).join("\n"),
    ).toEqual([]);
  });

  it("profile-org-fidelity 用的是专属账号，不是 admin（回归锁）", () => {
    // 这条是 #2086 的定点回归锁：把 fidelity 换回 adminEmail/adminPassword 会立刻红。
    const accounts = accountsUsedBy("profile-org-fidelity.spec.ts");
    expect(accounts).toEqual(["fidelityPassword"]);

    const src = readFileSync(resolve(E2E_DIR, "profile-org-fidelity.spec.ts"), "utf8");
    expect(src).not.toContain("SELF_SERVICE_PROFILE_E2E.adminEmail");
  });
});
