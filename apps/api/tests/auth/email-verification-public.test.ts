import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { auth as C } from "@repo/contracts";
import { deliverOneVerificationMail } from "../../src/application/auth/email-verification";
import { HmacEmailVerificationTokenCodec } from "../../src/infrastructure/auth/email-verification-token-codec";
import { PgEmailVerificationRepository } from "../../src/infrastructure/auth/pg-email-verification-repository";
import {
  CloudflareEmailTransport,
  cloudflareEmailConfig,
  MailTransportError,
} from "../../src/infrastructure/auth/cloudflare-email-transport";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
import { issueInviteCode, makeCode, readCredentialByEmail, resetAuthFixtures, resetOrgsOwnedBy } from "../support/auth-db";

process.env.KERNEL_QUIET = "1";
process.env.EMAIL_VERIFICATION_SECRET = "i411-test-email-verification-secret-at-least-32-bytes";

const EMAIL_DOMAIN = "i411verify.test";
const PASSWORD = "correct-horse-battery-staple";
const codes = Array.from({ length: 8 }, (_, i) => makeCode(`I411VERIFY${i}`));
const tokens = new HmacEmailVerificationTokenCodec(process.env.EMAIL_VERIFICATION_SECRET);
let app: NestExpressApplication;
let db: PgDatabase;
let base: string;
let codeIndex = 0;
const users: string[] = [];

async function postRaw(path: string, body: unknown, cookie?: string) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

async function post(path: string, body: unknown, cookie?: string) {
  const { response, body: responseBody } = await postRaw(path, body, cookie);
  return { status: response.status, body: responseBody };
}

async function register(local: string) {
  const code = codes[codeIndex++]!;
  await issueInviteCode(code);
  const { response, body } = await postRaw("/auth/register", {
    code, email: `${local}@${EMAIL_DOMAIN}`, password: PASSWORD, displayName: local, orgName: "I411 Co",
  });
  expect(response.status, JSON.stringify(body)).toBe(201);
  users.push(body.userId as string);
  const row = await asOwner(async (client) => (await client.query<{
    id: string; token_digest: string; expires_at: Date; outbox_id: string;
  }>(
    `SELECT c.id, c.token_digest, c.expires_at, o.id AS outbox_id
       FROM email_verification_challenges c JOIN mail_outbox o ON o.challenge_id = c.id
      WHERE c.user_id = $1`, [body.userId],
  )).rows[0]!);
  return {
    userId: body.userId as string,
    orgId: body.orgId as string,
    verificationDelivery: body.verificationDelivery as string,
    setCookie: response.headers.get("set-cookie") ?? "",
    pendingCookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
    email: `${local}@${EMAIL_DOMAIN}`,
    row,
    raw: tokens.tokenForChallenge(row.id),
  };
}

async function prioritizeOutbox(outboxId: string) {
  await asOwner((client) => client.query(
    `UPDATE mail_outbox SET next_attempt_at = '2000-01-01T00:00:00Z' WHERE id = $1`,
    [outboxId],
  ));
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(async () => {
  await resetOrgsOwnedBy(users);
  users.length = 0;
  codeIndex = 0;
  await resetAuthFixtures({ codes, emailLike: `%@${EMAIL_DOMAIN}` });
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe("signed public email-verification contract", () => {
  it("registers a digest-only 24h challenge and reports queued, never sent", async () => {
    const before = Date.now();
    const registration = await register("digest");
    expect(registration.verificationDelivery).toBe("queued");
    expect(registration.setCookie).toContain("HttpOnly");
    expect(registration.setCookie).toContain("SameSite=Lax");
    expect(registration.setCookie).not.toContain(registration.raw);
    expect(registration.row.token_digest).toBe(tokens.digest(registration.raw));
    expect(registration.row.token_digest).not.toBe(registration.raw);
    expect(registration.row.expires_at.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 2_000);
    const persisted = await asOwner(async (client) => JSON.stringify((await client.query(
      `SELECT c.*, o.* FROM email_verification_challenges c JOIN mail_outbox o ON o.challenge_id = c.id WHERE c.id = $1`,
      [registration.row.id],
    )).rows));
    expect(persisted).not.toContain(registration.raw);
  });

  it("atomically consumes once while replay returns the same generic completed body", async () => {
    const registration = await register("concurrent");
    const [first, second] = await Promise.all([
      post("/auth/email-verifications/confirm", { token: registration.raw }),
      post("/auth/email-verifications/confirm", { token: registration.raw }),
    ]);
    expect(first).toEqual({ status: 201, body: { status: "completed" } });
    expect(second).toEqual(first);
    const credential = await readCredentialByEmail(registration.email);
    expect(credential?.email_verified_at).not.toBeNull();
    const consumed = await asOwner(async (client) => (await client.query<{ consumed_at: Date }>(
      `SELECT consumed_at FROM email_verification_challenges WHERE id = $1`, [registration.row.id],
    )).rows[0]!.consumed_at);
    expect(consumed).not.toBeNull();
    await asOwner((client) => client.query(
      `UPDATE email_verification_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [registration.row.id],
    ));
    expect(await post("/auth/email-verifications/confirm", { token: registration.raw }))
      .toEqual({ status: 201, body: { status: "completed" } });
  });

  it("collapses forged and expired challenges into VERIFICATION_LINK_INVALID", async () => {
    const registration = await register("expired");
    await asOwner((client) => client.query(
      `UPDATE email_verification_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [registration.row.id],
    ));
    const expired = await post("/auth/email-verifications/confirm", { token: registration.raw });
    const forged = await post("/auth/email-verifications/confirm", { token: "f".repeat(64) });
    for (const response of [expired, forged]) {
      expect(response.status).toBe(400);
      expect(response.body.reasonCode).toBe("VERIFICATION_LINK_INVALID");
      expect(C.operations.confirmEmailVerification.out.safeParse(response.body).success).toBe(false);
    }
  });

  it("resend is non-enumerating and independently cooldown-limited", async () => {
    const registration = await register("resend");
    const unknown = await post("/auth/email-verifications/resend", { email: `unknown@${EMAIL_DOMAIN}` });
    const cooling = await post("/auth/email-verifications/resend", { email: registration.email });
    expect(unknown.status).toBe(cooling.status);
    expect(unknown.body).toEqual(cooling.body);
    expect(unknown).toEqual({ status: 201, body: { verificationDelivery: "queued" } });
    await asOwner((client) => client.query(
      `UPDATE email_verification_challenges SET created_at = now() - interval '61 seconds' WHERE id = $1`,
      [registration.row.id],
    ));
    const concurrent = await Promise.all([
      post("/auth/email-verifications/resend", { email: registration.email.toUpperCase() }, registration.pendingCookie),
      post("/auth/email-verifications/resend", { email: registration.email }, registration.pendingCookie),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    const count = await asOwner(async (client) => Number((await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM email_verification_challenges WHERE user_id = $1`,
      [registration.userId],
    )).rows[0]!.n));
    expect(count).toBe(2);
  });

  it("requires pending identity proof and supersedes old links without reporting false completion", async () => {
    const registration = await register("supersede");
    expect(registration.pendingCookie).toMatch(/^wsx.pendingVerification=/);
    await asOwner((client) => client.query(
      `UPDATE email_verification_challenges SET created_at = now() - interval '61 seconds' WHERE id = $1`,
      [registration.row.id],
    ));

    await post("/auth/email-verifications/resend", { email: registration.email }, registration.pendingCookie);
    const oldLink = await post("/auth/email-verifications/confirm", { token: registration.raw });
    expect(oldLink.status).toBe(400);
    expect(oldLink.body.reasonCode).toBe("VERIFICATION_LINK_INVALID");
    expect((await readCredentialByEmail(registration.email))?.email_verified_at).toBeNull();
    const state = await asOwner(async (client) => (await client.query<{
      superseded_at: Date | null; outbox_status: string; live_count: string;
    }>(
      `SELECT old.superseded_at, o.status AS outbox_status,
              (SELECT count(*)::text FROM email_verification_challenges live
                WHERE live.user_id = old.user_id AND live.consumed_at IS NULL
                  AND live.superseded_at IS NULL) AS live_count
         FROM email_verification_challenges old JOIN mail_outbox o ON o.challenge_id = old.id
        WHERE old.id = $1`,
      [registration.row.id],
    )).rows[0]!);
    expect(state.superseded_at).not.toBeNull();
    expect(state.outbox_status).toBe("cancelled");
    expect(state.live_count).toBe("1");
  });

  it("does not rotate another pending identity when the proof and email do not match", async () => {
    const owner = await register("proof-owner");
    const target = await register("proof-target");
    await asOwner((client) => client.query(
      `UPDATE email_verification_challenges SET created_at = now() - interval '61 seconds' WHERE id = ANY($1)`,
      [[owner.row.id, target.row.id]],
    ));
    await post("/auth/email-verifications/resend", { email: target.email }, owner.pendingCookie);
    expect(await post(
      "/auth/email-verifications/resend",
      { email: target.email },
      "wsx.pendingVerification=%",
    )).toEqual({ status: 201, body: { verificationDelivery: "queued" } });
    const targetCount = await asOwner(async (client) => Number((await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM email_verification_challenges WHERE user_id = $1`, [target.userId],
    )).rows[0]!.n));
    expect(targetCount).toBe(1);
  });

  it("allows five actual resends per 24h, not four because registration was counted", async () => {
    const registration = await register("daily-limit");
    let cookie = registration.pendingCookie;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await asOwner((client) => client.query(
        `UPDATE email_verification_challenges SET created_at = now() - interval '61 seconds'
          WHERE user_id = $1 AND consumed_at IS NULL AND superseded_at IS NULL`,
        [registration.userId],
      ));
      const { response } = await postRaw(
        "/auth/email-verifications/resend", { email: registration.email }, cookie,
      );
      const rotated = response.headers.get("set-cookie")?.split(";", 1)[0];
      if (rotated) cookie = rotated;
      const resendCount = await asOwner(async (client) => Number((await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM email_verification_challenges
          WHERE user_id = $1 AND issuance_kind = 'resend'`, [registration.userId],
      )).rows[0]!.n));
      expect(resendCount).toBe(Math.min(attempt, 5));
    }
  });

  it("serializes confirm against a resend blocked after proof validation", async () => {
    const registration = await register("confirm-resend-race");
    await asOwner((client) => client.query(
      `UPDATE email_verification_challenges SET created_at = now() - interval '61 seconds' WHERE id = $1`,
      [registration.row.id],
    ));
    let unlock!: () => void;
    let locked!: () => void;
    const unlockGate = new Promise<void>((resolve) => { unlock = resolve; });
    const lockReady = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = db.withoutTenant(async (session) => {
      await session.query(`SELECT id FROM mail_outbox WHERE id = $1 FOR UPDATE`, [registration.row.outbox_id]);
      locked();
      await unlockGate;
    });
    await lockReady;
    const resend = post(
      "/auth/email-verifications/resend", { email: registration.email }, registration.pendingCookie,
    );
    let released = false;
    const release = () => {
      if (!released) unlock();
      released = true;
    };
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await asOwner(async (client) => Number((await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%challenge_superseded%'`,
        )).rows[0]!.n));
        if (waiting > 0) break;
        if (attempt === 99) throw new Error("resend did not reach the deterministic outbox lock");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const confirm = post("/auth/email-verifications/confirm", { token: registration.raw });
      release();
      const [resendResult, confirmResult] = await Promise.all([resend, confirm]);
      expect(resendResult).toEqual({ status: 201, body: { verificationDelivery: "queued" } });
      expect(confirmResult.status).toBe(400);
      expect(confirmResult.body.reasonCode).toBe("VERIFICATION_LINK_INVALID");
      expect((await readCredentialByEmail(registration.email))?.email_verified_at).toBeNull();
    } finally {
      release();
      await blocker;
    }
  });
});

describe("transactional outbox delivery", () => {
  it("claims once, sends a stable identity, and records delivery through an injected transport", async () => {
    const registration = await register("delivery");
    await prioritizeOutbox(registration.row.outbox_id);
    const repo = new PgEmailVerificationRepository(db);
    const deliver = vi.fn().mockResolvedValue({ providerMessageId: "provider-1" });
    // Only this deliberately backdated row is due. Other parallel test files may
    // legitimately have pending mail, but that must not weaken this single-row claim proof.
    const now = new Date("2000-01-01T00:00:01Z");
    const results = await Promise.all([
      deliverOneVerificationMail({
        now, appPublicUrl: "https://app.example.test", repo, tokens, transport: { deliver },
      }),
      deliverOneVerificationMail({
        now, appPublicUrl: "https://app.example.test", repo, tokens, transport: { deliver },
      }),
    ]);
    expect(results.sort()).toEqual(["delivered", "idle"]);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      outboxId: registration.row.outbox_id,
      verificationUrl: `https://app.example.test/auth/verify-email?token=${registration.raw}`,
    }));
    expect(await deliverOneVerificationMail({
      now, appPublicUrl: "https://app.example.test", repo, tokens, transport: { deliver },
    })).toBe("idle");
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("recovers a stale delivering claim after a worker crash", async () => {
    const registration = await register("stale");
    const now = new Date(Date.now() + 1_000);
    await asOwner((client) => client.query(
      `UPDATE mail_outbox SET status = 'delivering', claimed_at = $2::timestamptz - interval '6 minutes',
          next_attempt_at = '2000-01-01T00:00:00Z'
        WHERE id = $1`,
      [registration.row.outbox_id, now],
    ));
    const repo = new PgEmailVerificationRepository(db);
    const deliver = vi.fn().mockResolvedValue({ providerMessageId: "provider-stale" });
    expect(await deliverOneVerificationMail({
      now, appPublicUrl: "https://app.example.test", repo, tokens, transport: { deliver },
    })).toBe("delivered");
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("cancels an expired challenge instead of delivering a dead link", async () => {
    const registration = await register("expired-outbox");
    await asOwner(async (client) => {
      await client.query(
        `UPDATE email_verification_challenges SET expires_at = '1999-12-31T23:59:59Z' WHERE id = $1`,
        [registration.row.id],
      );
      await client.query(
        `UPDATE mail_outbox SET next_attempt_at = '2000-01-01T00:00:00Z' WHERE id = $1`,
        [registration.row.outbox_id],
      );
    });
    const repo = new PgEmailVerificationRepository(db);
    const deliver = vi.fn();
    expect(await deliverOneVerificationMail({
      now: new Date("2000-01-01T00:00:01Z"),
      appPublicUrl: "https://app.example.test", repo, tokens, transport: { deliver },
    })).toBe("idle");
    expect(deliver).not.toHaveBeenCalled();
    const status = await asOwner(async (client) => (await client.query<{ status: string }>(
      `SELECT status FROM mail_outbox WHERE id = $1`, [registration.row.outbox_id],
    )).rows[0]!.status);
    expect(status).toBe("cancelled");
  });

  it("records a redacted retryable category and schedules the same outbox identity", async () => {
    const registration = await register("retry");
    await prioritizeOutbox(registration.row.outbox_id);
    const repo = new PgEmailVerificationRepository(db);
    const failure = Object.assign(new Error("secret provider response"), { category: "provider_http_503", retryable: true });
    const now = new Date(Date.now() + 1_000);
    expect(await deliverOneVerificationMail({
      now, appPublicUrl: "https://app.example.test", repo, tokens,
      transport: { deliver: vi.fn().mockRejectedValue(failure) },
    })).toBe("retryable");
    const row = await asOwner(async (client) => (await client.query<{
      id: string; status: string; attempt_count: number; failure_category: string; next_attempt_at: Date;
    }>(`SELECT * FROM mail_outbox WHERE id = $1`, [registration.row.outbox_id])).rows[0]!);
    expect(row).toMatchObject({
      id: registration.row.outbox_id, status: "retryable", attempt_count: 1,
      failure_category: "provider_http_503",
    });
    expect(JSON.stringify(row)).not.toContain("secret provider response");
    expect(row.next_attempt_at.getTime()).toBe(now.getTime() + 60_000);
  });
});

describe("Cloudflare Email Service REST adapter", () => {
  it("prefers the least-privilege email token over the migration fallback", () => {
    const config = cloudflareEmailConfig({
      NODE_ENV: "development",
      CLOUDFLARE_ACCOUNT_ID: "a",
      CLOUDFLARE_EMAIL_API_TOKEN: "email-sending-edit-token",
      CLOUDFLARE_API_TOKEN: "legacy-broad-token",
      MAIL_FROM: "no-reply@mail.boardx.us",
      APP_PUBLIC_URL: "https://app.example.test",
    });
    expect(config.apiToken).toBe("email-sending-edit-token");
  });

  it.each(["development", "staging"])(
    "allows the legacy Cloudflare token only as a %s migration fallback",
    (nodeEnv) => {
      const config = cloudflareEmailConfig({
        NODE_ENV: nodeEnv,
        CLOUDFLARE_ACCOUNT_ID: "a",
        CLOUDFLARE_API_TOKEN: "legacy-broad-token",
        MAIL_FROM: "no-reply@mail.boardx.us",
        APP_PUBLIC_URL: "https://app.example.test",
      });
      expect(config.apiToken).toBe("legacy-broad-token");
    },
  );

  it("uses the account endpoint, an allowed trace header, and records Cloudflare's Message-ID", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: {
        delivered: [], permanent_bounces: [], queued: ["person@example.test"],
        message_id: "<cloudflare-generated@example.com>",
      },
    }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    const transport = new CloudflareEmailTransport({
      accountId: "account-1",
      apiToken: "scoped-email-sending-edit-token",
      mailFrom: "verify@example.test",
      appPublicUrl: "https://app.example.test",
      previewDisabledAttested: true,
      workerEnabled: true,
      requestTimeoutMs: 10_000,
    }, request);
    await expect(transport.deliver({
      outboxId: "outbox-1", to: "person@example.test",
      verificationUrl: "https://app.example.test/auth/verify-email?token=sensitive",
    })).resolves.toEqual({ providerMessageId: "<cloudflare-generated@example.com>" });
    const [url, init] = request.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/account-1/email/sending/send");
    expect(init.headers).toMatchObject({ authorization: "Bearer scoped-email-sending-edit-token" });
    const body = JSON.parse(init.body as string) as { to: string; text: string; headers: Record<string, string> };
    expect(body.to).toBe("person@example.test");
    expect(body.text).toContain("/auth/verify-email?token=sensitive");
    expect(body.headers["Message-ID"]).toBeUndefined();
    expect(body.headers["X-WorkspaceX-Outbox-ID"]).toBe("outbox-1");
  });

  it("classifies retryable provider errors without recording response bodies", async () => {
    const transport = new CloudflareEmailTransport({
      accountId: "account-1", apiToken: "scoped-token", mailFrom: "verify@example.test",
      appPublicUrl: "https://app.example.test", previewDisabledAttested: true, workerEnabled: true,
      requestTimeoutMs: 10_000,
    }, vi.fn().mockResolvedValue(new Response("provider-secret-detail", { status: 503 })));
    const error = await transport.deliver({
      outboxId: "outbox-2", to: "person@example.test", verificationUrl: "https://example.test/verify",
    }).catch((caught) => caught as MailTransportError);
    expect(error).toBeInstanceOf(MailTransportError);
    if (!(error instanceof MailTransportError)) throw new Error("expected MailTransportError");
    expect(error).toMatchObject({ category: "provider_http_503", retryable: true });
    expect(error.message).not.toContain("provider-secret-detail");
  });

  it("times out even after response headers arrive when the provider body never finishes", async () => {
    const request = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {} }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    const transport = new CloudflareEmailTransport({
      accountId: "account-1", apiToken: "scoped-token", mailFrom: "verify@example.test",
      appPublicUrl: "https://app.example.test", previewDisabledAttested: true, workerEnabled: true,
      requestTimeoutMs: 5,
    }, request);
    const error = await transport.deliver({
      outboxId: "outbox-timeout", to: "person@example.test", verificationUrl: "https://example.test/verify",
    }).catch((caught) => caught as MailTransportError);
    expect(error).toMatchObject({ category: "timeout", retryable: true });
  });

  it("fails closed on missing production credentials and production Preview", () => {
    expect(() => cloudflareEmailConfig({ NODE_ENV: "production" })).toThrow(/incomplete/);
    expect(() => cloudflareEmailConfig({
      NODE_ENV: "production",
      CLOUDFLARE_ACCOUNT_ID: "a",
      CLOUDFLARE_API_TOKEN: "legacy-broad-token",
      MAIL_FROM: "no-reply@mail.boardx.us",
      APP_PUBLIC_URL: "https://app.example.test",
      CLOUDFLARE_EMAIL_PREVIEW_DISABLED: "true",
    })).toThrow(/incomplete/);
    expect(() => cloudflareEmailConfig({
      NODE_ENV: "production",
      CLOUDFLARE_ACCOUNT_ID: "a",
      CLOUDFLARE_EMAIL_API_TOKEN: "t",
      MAIL_FROM: "verify@example.test",
    })).toThrow(/incomplete/);
    expect(() => cloudflareEmailConfig({
      NODE_ENV: "production",
      CLOUDFLARE_ACCOUNT_ID: "a",
      CLOUDFLARE_EMAIL_API_TOKEN: "t",
      MAIL_FROM: "verify@example.test",
      APP_PUBLIC_URL: "https://app.example.test",
    })).toThrow(/Preview.*attestation/);
    expect(() => cloudflareEmailConfig({
      NODE_ENV: "production",
      CLOUDFLARE_ACCOUNT_ID: "a",
      CLOUDFLARE_EMAIL_API_TOKEN: "t",
      MAIL_FROM: "verify@example.test",
      APP_PUBLIC_URL: "https://app.example.test",
      CLOUDFLARE_EMAIL_PREVIEW_DISABLED: "true",
    })).not.toThrow();
    expect(() => cloudflareEmailConfig({
      NODE_ENV: "production",
      CLOUDFLARE_ACCOUNT_ID: "a",
      CLOUDFLARE_EMAIL_API_TOKEN: "t",
      MAIL_FROM: "verify@example.test",
      APP_PUBLIC_URL: "https://app.example.test",
      CLOUDFLARE_EMAIL_PREVIEW_DISABLED: "true",
      CLOUDFLARE_EMAIL_PREVIEW: "true",
    })).toThrow(/Preview.*attestation/);
  });
});
