/**
 * This file owns an empty database. The global test database is intentionally populated by
 * many suites, so it cannot prove the global-zero-credentials bootstrap invariant.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import pg from "pg";
import { auth as C } from "@repo/contracts";
import { migrate } from "../../src/infrastructure/db/migrator";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { DATABASE_PORT } from "../../src/application/ports/database.port";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { ensureRedis } from "../support/auth";
import { dropDatabaseAfterDraining } from "../support/drop-database";

process.env.KERNEL_QUIET = "1";

const ORIGINAL_DATABASE = process.env.PGDATABASE;
const DATABASE = `wsx_bootstrap_${process.pid}_${Date.now()}`;
const PASSWORD = "correct-horse-battery-staple";
let app: NestExpressApplication;
let databasePort: PgDatabase;
let base: string;

function ownerConfig(database: string) {
  return { ...migrationConfig(), database };
}

async function adminClient(database = "postgres") {
  const client = new pg.Client(ownerConfig(database));
  await client.connect();
  return client;
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function candidate(n: number) {
  return {
    email: `first-${n}@bootstrap.test`,
    password: PASSWORD,
    displayName: `First ${n}`,
    orgName: `First Org ${n}`,
  };
}

beforeAll(async () => {
  ensureRedis();
  const admin = await adminClient();
  try {
    await admin.query(`CREATE DATABASE ${DATABASE}`);
  } finally {
    await admin.end();
  }
  process.env.PGDATABASE = DATABASE;
  await migrate(ownerConfig(DATABASE));
  const { createApp } = await import("../../src/main");
  app = await createApp();
  databasePort = app.get(DATABASE_PORT) as PgDatabase;
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await databasePort?.close();
  const admin = await adminClient();
  try {
    // #487：曾经是 `DROP DATABASE … WITH (FORCE)`。FORCE 会给残留连接发 FATAL 57P01，
    // 那条 FATAL 会以运行期错误冒进 vitest —— 4352 个测试全过、零断言失败，job 却红，
    // 且错误里没有任何「是谁没关连接」的信息。改为先排空、残留则指名道姓。
    await dropDatabaseAfterDraining(admin, DATABASE);
  } finally {
    await admin.end();
    if (ORIGINAL_DATABASE === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = ORIGINAL_DATABASE;
  }
}, 30_000);

describe("global first-user bootstrap", () => {
  it("five real concurrent requests commit exactly one verified admin and no loser residue", async () => {
    const attempts = await Promise.all(Array.from({ length: 5 }, (_, i) => post("/auth/bootstrap", candidate(i))));
    const winners = attempts.filter((r) => r.status === 201);
    const losers = attempts.filter((r) => r.status === 409);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(4);
    expect(losers.every((r) => r.body.reasonCode === "BOOTSTRAP_UNAVAILABLE")).toBe(true);
    expect(C.operations.bootstrapFirstUser.out.safeParse(winners[0]!.body).success).toBe(true);

    const owner = await adminClient(DATABASE);
    try {
      const credentials = await owner.query(
        "SELECT user_id, email, email_verified_at FROM credentials",
      );
      const organizations = await owner.query(
        "SELECT id, kind, owner_user_id FROM organizations ORDER BY kind",
      );
      const memberships = await owner.query(
        "SELECT user_id, org_id, org_role FROM org_memberships",
      );
      // #411 用 email_verification_challenges 取代了 email_verification_tokens
      // （20260804030000_i411_email_verification_outbox.sql 建新表并 DROP 旧表）。
      // 断言的**意图不变**：bootstrap 的首位管理员当场即已验证，不该签发任何挑战。
      // 顺带一并断言不该有排队的验证邮件——首位管理员收到验证信本身就是缺陷。
      const verification = await owner.query("SELECT count(*)::int AS n FROM email_verification_challenges");
      const queuedMail = await owner.query("SELECT count(*)::int AS n FROM mail_outbox");
      const bootstrapState = await owner.query(
        "SELECT consumed_at FROM auth_bootstrap_state WHERE singleton = true",
      );

      expect(credentials.rows).toHaveLength(1);
      expect(credentials.rows[0].email_verified_at).not.toBeNull();
      expect(organizations.rows).toHaveLength(2);
      expect(organizations.rows.map((r) => r.kind).sort()).toEqual(["organization", "personal-local"]);
      const realOrg = organizations.rows.find((r) => r.kind === "organization")!;
      expect(memberships.rows).toContainEqual(expect.objectContaining({
        user_id: credentials.rows[0].user_id,
        org_id: realOrg.id,
        org_role: "admin",
      }));
      expect(verification.rows[0].n).toBe(0);
      expect(queuedMail.rows[0].n).toBe(0);
      expect(bootstrapState.rows).toHaveLength(1);
      expect(bootstrapState.rows[0].consumed_at).not.toBeNull();
    } finally {
      await owner.end();
    }

    const winnerIndex = attempts.indexOf(winners[0]!);
    const login = await post("/auth/login", {
      email: candidate(winnerIndex).email,
      password: PASSWORD,
    });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(C.operations.login.out.safeParse(login.body).success).toBe(true);

    const later = await post("/auth/bootstrap", candidate(99));
    expect(later.status).toBe(409);
    expect(later.body.reasonCode).toBe("BOOTSTRAP_UNAVAILABLE");

    // One-shot means consumed forever, not merely "while a credential row exists".
    const cleanupOwner = await adminClient(DATABASE);
    try {
      await cleanupOwner.query("DELETE FROM credentials");
    } finally {
      await cleanupOwner.end();
    }
    const afterCredentialCleanup = await post("/auth/bootstrap", candidate(100));
    expect(afterCredentialCleanup.status).toBe(409);
    expect(afterCredentialCleanup.body.reasonCode).toBe("BOOTSTRAP_UNAVAILABLE");
  }, 120_000);
});
