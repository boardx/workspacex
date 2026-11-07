import { describe, it, expect, vi } from "vitest";
import { resendVerificationWithPassword } from "../../src/application/auth/email-verification";
import { HmacEmailVerificationTokenCodec } from "../../src/infrastructure/auth/email-verification-token-codec";
import type { EmailVerificationRepository } from "../../src/application/auth/email-verification-ports";
import { authenticateCredentials, type LoginDeps } from "../../src/application/auth/login";
function fixture(found = true, valid = true) {
 const now = new Date("2026-11-02T00:00:00Z");
 const credential = { userId: "u1", email: "user@example.test", passwordHash: "hash", emailVerifiedAt: null, displayName: "User", avatarUrl: null };
 const deps = { clock: { now: () => now }, credentials: { findByEmail: vi.fn(async () => found ? credential : null) }, hasher: { verify: vi.fn(async () => valid), verifyDummy: vi.fn(async () => false as const) }, attempts: { recentFor: vi.fn(async () => [] as { at: number; outcome: "bad-credential" }[]), record: vi.fn(async () => {}) } };
 return { deps: deps as unknown as Pick<LoginDeps, "clock" | "credentials" | "hasher" | "attempts">, raw: deps, now, credential };
}
describe("password proof for verification recovery", () => {
 it("authenticates an unverified user without issuing a session", async () => {
 const f = fixture(); expect(await authenticateCredentials(f.deps, { email: "USER@example.test", password: "correct" })).toEqual(f.credential);
 expect(f.raw.attempts.record).toHaveBeenCalledWith("user@example.test", "ok", f.now);
 });
 it.each([[false, true], [true, false]])("rejects absent user and wrong password identically (%s,%s)", async (found, valid) => {
 const f = fixture(found, valid); await expect(authenticateCredentials(f.deps, { email: "user@example.test", password: "wrong" })).rejects.toMatchObject({ reason: "INVALID_CREDENTIAL" });
 expect(f.raw.attempts.record).toHaveBeenCalledWith("user@example.test", "bad-credential", f.now);
 if (!found) expect(f.raw.hasher.verifyDummy).toHaveBeenCalledOnce();
 });
 it("checks lockout before verifying a correct password", async () => {
 const f = fixture(); f.raw.attempts.recentFor.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ at: f.now.getTime() - i - 1, outcome: "bad-credential" as const })));
 await expect(authenticateCredentials(f.deps, { email: "user@example.test", password: "correct" })).rejects.toMatchObject({ reason: "ACCOUNT_LOCKED" });
 expect(f.raw.hasher.verify).not.toHaveBeenCalled();
 });
});

describe("password-authorized resend", () => {
 it("queues a fresh challenge without an old browser proof", async () => {
  const f = fixture(); const requestResend = vi.fn(async () => true);
  const tokens = new HmacEmailVerificationTokenCodec("recovery-test-secret-at-least-32-bytes");
  const out = await resendVerificationWithPassword({ ...f.deps, repo: { requestResend } as unknown as EmailVerificationRepository, tokens }, { email: "USER@example.test", password: "correct" });
  expect(requestResend).toHaveBeenCalledWith(expect.objectContaining({ email: "user@example.test", authenticatedUserId: "u1", proofChallengeId: null }));
  expect(out.pendingIdentityProof).toBeTruthy();
 });
 it("does not queue anything on incorrect credentials", async () => {
  const f = fixture(true, false); const requestResend = vi.fn(async () => true);
  const tokens = new HmacEmailVerificationTokenCodec("recovery-test-secret-at-least-32-bytes");
  await expect(resendVerificationWithPassword({ ...f.deps, repo: { requestResend } as unknown as EmailVerificationRepository, tokens }, { email: "user@example.test", password: "wrong" })).rejects.toMatchObject({ reason: "INVALID_CREDENTIAL" });
  expect(requestResend).not.toHaveBeenCalled();
 });
});
