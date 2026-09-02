/**
 * `PlatformSuperuserGuard` -- the canonical (and, per review finding on PR #2475, only
 * correct) place this decision is made. Exercises the guard directly against a fake
 * `ExecutionContext`, covering the cases the review asked for: an ordinary member, an org
 * admin (still not a platform superuser -- this identity is deliberately outside `OrgRole`),
 * an empty whitelist configuration, and the allowed operator case.
 *
 * `PrincipalGuard` (the global `APP_GUARD`) is what rejects a caller with no principal at
 * all (401, before this guard is even reached) -- see that guard's own test coverage;
 * this file only covers what happens once a real, authenticated principal reaches here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { PlatformSuperuserGuard } from "../../src/interface/guards/platform-superuser.guard";
import type { CredentialRepository, CredentialRow } from "../../src/application/auth/ports";
import type { Principal } from "../../src/domain/principal";
import type { OrgId } from "../../src/domain/org-id";

function fakeCredential(email: string): CredentialRow {
  return {
    userId: "u-1",
    email,
    passwordHash: "irrelevant",
    emailVerifiedAt: null,
    displayName: "Test User",
    avatarUrl: null,
  };
}

function fakeContext(principal: Principal | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ principal }),
    }),
  } as unknown as ExecutionContext;
}

const principal: Principal = { userId: "u-1", orgId: "org-1" as OrgId };

const ORIGINAL_ENV = process.env.PLATFORM_SUPERUSER_EMAILS;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.PLATFORM_SUPERUSER_EMAILS;
  else process.env.PLATFORM_SUPERUSER_EMAILS = ORIGINAL_ENV;
});

function credentialsFor(email: string): CredentialRepository {
  return {
    findByEmail: vi.fn(),
    findByUserId: vi.fn().mockResolvedValue(fakeCredential(email)),
    updatePasswordHash: vi.fn(),
    updateDisplayName: vi.fn(),
  } as unknown as CredentialRepository;
}

describe("PlatformSuperuserGuard", () => {
  it("ordinary member (not on the whitelist) -> 403 NOT_PLATFORM_SUPERUSER", async () => {
    process.env.PLATFORM_SUPERUSER_EMAILS = "ops@example.com";
    const guard = new PlatformSuperuserGuard(credentialsFor("member@example.com"));
    await expect(guard.canActivate(fakeContext(principal))).rejects.toThrow(ForbiddenException);
  });

  it("an org admin's email, still not on the platform-superuser whitelist -> 403, same as any other member", async () => {
    // This identity is deliberately orthogonal to OrgRole -- being an org admin grants
    // nothing here. The fake credential carries no org-role concept at all; whatever the
    // caller's org role is, only whitelist membership matters.
    process.env.PLATFORM_SUPERUSER_EMAILS = "ops@example.com";
    const guard = new PlatformSuperuserGuard(credentialsFor("org-admin@example.com"));
    await expect(guard.canActivate(fakeContext(principal))).rejects.toThrow(ForbiddenException);
  });

  it("no PLATFORM_SUPERUSER_EMAILS configured at all -> nobody passes, not 'allow everyone'", async () => {
    delete process.env.PLATFORM_SUPERUSER_EMAILS;
    const guard = new PlatformSuperuserGuard(credentialsFor("ops@example.com"));
    await expect(guard.canActivate(fakeContext(principal))).rejects.toThrow(ForbiddenException);
  });

  it("allowed operator (email on the whitelist, case-insensitive) -> passes", async () => {
    process.env.PLATFORM_SUPERUSER_EMAILS = "Ops@Example.com";
    const guard = new PlatformSuperuserGuard(credentialsFor("ops@example.com"));
    await expect(guard.canActivate(fakeContext(principal))).resolves.toBe(true);
  });

  it("no principal on the request at all -> throws rather than silently deny/allow (should be unreachable in practice: PrincipalGuard runs first)", async () => {
    const guard = new PlatformSuperuserGuard(credentialsFor("ops@example.com"));
    await expect(guard.canActivate(fakeContext(undefined))).rejects.toThrow();
  });
});
