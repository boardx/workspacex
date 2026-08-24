import { describe, expect, it, vi } from "vitest";
import { auth as C } from "@repo/contracts";
import { BootstrapUnavailableError } from "../../src/application/auth/errors";
import { bootstrapFirstUser } from "../../src/application/auth/bootstrap-first-user";
import type { RegistrationRepository } from "../../src/application/auth/ports";
import { newOrgId } from "../../src/domain/auth/registration";

const HASH = "$2b$12$x5CA9Z/lWHcowxlNAkJj3.i7AoEfDtg74od.kgXvYoTERqGC6JRnW";
const ORG_ID = newOrgId();
const hasher = () => ({
  hash: vi.fn().mockResolvedValue(HASH),
  verify: vi.fn(),
  verifyDummy: vi.fn(),
});

function repoWith(
  result: Awaited<ReturnType<RegistrationRepository["bootstrapFirstUser"]>>,
  available = true,
): RegistrationRepository {
  return {
    isFirstUserBootstrapAvailable: vi.fn().mockResolvedValue(available),
    bootstrapFirstUser: vi.fn().mockResolvedValue(result),
    createAccountAndOrg: vi.fn(),
    // #411 把 confirmEmailVerification 从 RegistrationRepository 移到了专用的
    // EmailVerificationRepository（见 email-verification-ports.ts）——注册仓储不再承担
    // 验证态的读写。这里跟着收窄，不是删覆盖：该行为的测试在
    // email-verification-public.test.ts。
    joinExistingUserToNewOrg: vi.fn(),
  };
}

describe("BootstrapFirstUser completion contract", () => {
  it("adds an independent public contract without changing open registration", () => {
    expect(C.operations.bootstrapFirstUser.method).toBe("POST");
    expect(C.operations.bootstrapFirstUser.path).toBe("/auth/bootstrap");
    expect(C.operations.bootstrapFirstUser.err).toEqual([
      "BOOTSTRAP_UNAVAILABLE",
      "EMAIL_TAKEN",
    ]);
    /**
     * open-self-serve-registration delta (issue #1929): `redeemInviteAndCreateOrg` (and its
     * `code`-shaped `in`) is gone. What replaced it, `registerNewAccount`, has NO `code`
     * field AT ALL -- that is the point of the delta, not something to reject. So this is no
     * longer a rejection assertion; it is a shape assertion: the same body that used to be
     * rejected for MISSING a code now succeeds as a well-formed `registerNewAccount.in`,
     * because that operation never had a `code` to miss.
     */
    expect(C.operations.registerNewAccount.path).toBe("/auth/register-open");
    expect(C.operations.registerNewAccount.in.safeParse({
      email: "first@example.com",
      password: "correct-horse-battery-staple",
      displayName: "First admin",
      orgName: "First Org",
    }).success).toBe(true);
    // ...and a body that STILL carries a `code` field is rejected -- `.strict()` means no
    // ghost field survives from the removed operation's shape.
    expect(C.operations.registerNewAccount.in.safeParse({
      code: "12345678901234",
      email: "first@example.com",
      password: "correct-horse-battery-staple",
      displayName: "First admin",
      orgName: "First Org",
    }).success).toBe(false);
  });

  it("normalizes the email, stores a verified timestamp, and returns no credential material", async () => {
    const repo = repoWith({ ok: true, userId: "user_winner", orgId: ORG_ID });
    const now = new Date("2026-08-04T06:00:00.000Z");
    const out = await bootstrapFirstUser(
      { repo, hasher: hasher(), now: () => now },
      {
        email: "  FIRST@Example.COM ",
        password: "correct-horse-battery-staple",
        displayName: "First admin",
        orgName: "First Org",
      },
    );

    expect(repo.bootstrapFirstUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "first@example.com",
      emailVerifiedAt: now,
      passwordHash: HASH,
    }));
    expect(out).toEqual({ userId: "user_winner", orgId: ORG_ID, emailVerified: true });
    expect(C.operations.bootstrapFirstUser.out.safeParse(out).success).toBe(true);
    expect(JSON.stringify(out)).not.toContain(HASH);
  });

  it("fails closed after any credential already exists", async () => {
    const repo = repoWith({ ok: false, reason: "bootstrap-unavailable" });
    await expect(bootstrapFirstUser(
      { repo, hasher: hasher() },
      {
        email: "later@example.com",
        password: "correct-horse-battery-staple",
        displayName: "Later user",
        orgName: "Later Org",
      },
    )).rejects.toBeInstanceOf(BootstrapUnavailableError);
  });

  it("rejects a permanently consumed bootstrap before spending password-hash CPU", async () => {
    const repo = repoWith({ ok: false, reason: "bootstrap-unavailable" }, false);
    const passwordHasher = hasher();

    await expect(bootstrapFirstUser(
      { repo, hasher: passwordHasher },
      {
        email: "later@example.com",
        password: "correct-horse-battery-staple",
        displayName: "Later user",
        orgName: "Later Org",
      },
    )).rejects.toBeInstanceOf(BootstrapUnavailableError);

    expect(passwordHasher.hash).not.toHaveBeenCalled();
    expect(repo.bootstrapFirstUser).not.toHaveBeenCalled();
  });
});
