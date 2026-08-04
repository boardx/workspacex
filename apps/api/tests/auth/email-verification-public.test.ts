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

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function register(local: string) {
  const code = codes[codeIndex++]!;
  await issueInviteCode(code);
  const response = await post("/auth/register", {
    code, email: `${local}@${EMAIL_DOMAIN}`, password: PASSWORD, displayName: local, orgName: "I411 Co",
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  users.push(response.body.userId as string);
  const row = await asOwner(async (client) => (await client.query<{
    id: string; token_digest: string; expires_at: Date; outbox_id: string;
  }>(
    `SELECT c.id, c.token_digest, c.expires_at, o.id AS outbox_id
       FROM email_verification_challenges c JOIN mail_outbox o ON o.challenge_id = c.id
      WHERE c.user_id = $1`, [response.body.userId],
  )).rows[0]!);
  return {
    userId: response.body.userId as string,
    orgId: response.body.orgId as string,
    verificationDelivery: response.body.verificationDelivery as string,
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
      post("/auth/email-verifications/resend", { email: registration.email.toUpperCase() }),
      post("/auth/email-verifications/resend", { email: registration.email }),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    const count = await asOwner(async (client) => Number((await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM email_verification_challenges WHERE user_id = $1`,
      [registration.userId],
    )).rows[0]!.n));
    expect(count).toBe(2);
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
  it("uses the account endpoint, bearer auth and a stable outbox Message-ID", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { delivered: [], permanent_bounces: [], queued: ["person@example.test"] },
    }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    const transport = new CloudflareEmailTransport({
      accountId: "account-1",
      apiToken: "scoped-email-sending-edit-token",
      mailFrom: "verify@example.test",
      appPublicUrl: "https://app.example.test",
      previewEnabled: false,
      workerEnabled: true,
    }, request);
    await expect(transport.deliver({
      outboxId: "outbox-1", to: "person@example.test",
      verificationUrl: "https://app.example.test/auth/verify-email?token=sensitive",
    })).resolves.toEqual({ providerMessageId: "<outbox-1@workspacex.invalid>" });
    const [url, init] = request.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/account-1/email/sending/send");
    expect(init.headers).toMatchObject({ authorization: "Bearer scoped-email-sending-edit-token" });
    const body = JSON.parse(init.body as string) as { to: string; text: string; headers: Record<string, string> };
    expect(body.to).toBe("person@example.test");
    expect(body.text).toContain("/auth/verify-email?token=sensitive");
    expect(body.headers["Message-ID"]).toBe("<outbox-1@workspacex.invalid>");
  });

  it("classifies retryable provider errors without recording response bodies", async () => {
    const transport = new CloudflareEmailTransport({
      accountId: "account-1", apiToken: "scoped-token", mailFrom: "verify@example.test",
      appPublicUrl: "https://app.example.test", previewEnabled: false, workerEnabled: true,
    }, vi.fn().mockResolvedValue(new Response("provider-secret-detail", { status: 503 })));
    const error = await transport.deliver({
      outboxId: "outbox-2", to: "person@example.test", verificationUrl: "https://example.test/verify",
    }).catch((caught) => caught as MailTransportError);
    expect(error).toBeInstanceOf(MailTransportError);
    if (!(error instanceof MailTransportError)) throw new Error("expected MailTransportError");
    expect(error).toMatchObject({ category: "provider_http_503", retryable: true });
    expect(error.message).not.toContain("provider-secret-detail");
  });

  it("fails closed on missing production credentials and production Preview", () => {
    expect(() => cloudflareEmailConfig({ NODE_ENV: "production" })).toThrow(/incomplete/);
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
      CLOUDFLARE_EMAIL_PREVIEW: "true",
    })).toThrow(/Preview/);
  });
});
