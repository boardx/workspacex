import { afterEach, describe, expect, it, vi } from "vitest";
import { identity } from "@repo/contracts";
import {
  DEV_MODE_ACCOUNTS,
  DevModeAccountSchema,
  assertDevModeAllowed,
  getDevModeAccount,
  isDevModeEnabled,
} from "../src/index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DEV_MODE_ACCOUNTS", () => {
  it("有且仅有一个账号对应每一个 OrgRole——4 个,不多不少", () => {
    const roles = DEV_MODE_ACCOUNTS.map((a) => a.role).sort();
    expect(roles).toEqual([...identity.OrgRole.options].sort());
  });

  it("每个账号都通过 schema 校验（邮箱格式、密码长度、role 属于契约枚举）", () => {
    for (const account of DEV_MODE_ACCOUNTS) {
      expect(() => DevModeAccountSchema.parse(account)).not.toThrow();
    }
  });

  it("邮箱互不相同——不能有两个角色共用一个账号", () => {
    const emails = DEV_MODE_ACCOUNTS.map((a) => a.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("getDevModeAccount 按 role 精确取回对应账号", () => {
    for (const account of DEV_MODE_ACCOUNTS) {
      expect(getDevModeAccount(account.role)).toEqual(account);
    }
  });

  it("getDevModeAccount 对未知 role 抛错,不做静默兜底", () => {
    // @ts-expect-error 刻意传入契约外的值,断言运行时也拒绝
    expect(() => getDevModeAccount("superadmin")).toThrow(/no dev-mode preset account/);
  });
});

describe("生产环境硬门", () => {
  it("NODE_ENV=production 时 assertDevModeAllowed 抛错", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertDevModeAllowed()).toThrow(/production/);
  });

  it("非 production 时 assertDevModeAllowed 不抛错", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => assertDevModeAllowed()).not.toThrow();
  });

  it("isDevModeEnabled 要求显式开关 + 非 production 同时成立", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WORKSPACEX_DEV_MODE", "");
    expect(isDevModeEnabled()).toBe(false);

    vi.stubEnv("WORKSPACEX_DEV_MODE", "1");
    expect(isDevModeEnabled()).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(isDevModeEnabled()).toBe(false);
  });
});
