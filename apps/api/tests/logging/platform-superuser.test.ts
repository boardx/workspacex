/**
 * `isPlatformSuperuserEmail` / `platformSuperuserWhitelistFromEnv` -- pure functions, no DB.
 * See `domain/system/platform-superuser.ts` for why this identity exists and why it is not
 * `OrgRole`.
 */
import { describe, expect, it } from "vitest";
import {
  isPlatformSuperuserEmail,
  platformSuperuserWhitelistFromEnv,
} from "../../src/domain/system/platform-superuser";

describe("platformSuperuserWhitelistFromEnv", () => {
  it("undefined / empty env var -> empty whitelist, not 'allow everyone'", () => {
    expect(platformSuperuserWhitelistFromEnv(undefined)).toEqual([]);
    expect(platformSuperuserWhitelistFromEnv("")).toEqual([]);
    expect(platformSuperuserWhitelistFromEnv("   ")).toEqual([]);
  });

  it("splits on comma and trims whitespace", () => {
    expect(platformSuperuserWhitelistFromEnv("a@x.com, b@x.com ,, c@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });
});

describe("isPlatformSuperuserEmail", () => {
  const whitelist = ["Ops@Example.com"];

  it("case-insensitive match", () => {
    expect(isPlatformSuperuserEmail("ops@example.com", whitelist)).toBe(true);
    expect(isPlatformSuperuserEmail("OPS@EXAMPLE.COM", whitelist)).toBe(true);
  });

  it("not in whitelist -> false", () => {
    expect(isPlatformSuperuserEmail("someone-else@example.com", whitelist)).toBe(false);
  });

  it("empty email (e.g. credential lookup miss) -> false, never matches an empty whitelist entry", () => {
    expect(isPlatformSuperuserEmail("", ["", "ops@example.com"])).toBe(false);
  });

  it("empty whitelist -> nobody is a platform superuser", () => {
    expect(isPlatformSuperuserEmail("ops@example.com", [])).toBe(false);
  });
});
