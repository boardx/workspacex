/**
 * issue #652 — before this file, `recording_consent_cells` and `retention_policies` had
 * real PostgreSQL repositories and real use cases, but **zero HTTP entry**: every existing
 * test (including `recording-http-session-lifecycle.test.ts`, right next to this file) seeds
 * both tables with raw SQL via `asApp`, exactly the way only a CI seed script could. A real
 * user clicking "开始录音" had no button, form or API call that could ever populate either
 * table — `startRecording` could only ever be satisfied by test/ops tooling.
 *
 * This file is the counter-proof: every write below goes through real HTTP (`PUT
 * /retention-policy`, `POST /recording/consent/decisions`), and `startRecording` is then
 * exercised with NOTHING seeded by SQL except org/project/membership rows — the same
 * fixture shape a real signup + project-create flow would leave behind.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { files as FilesC, recording as C } from "@repo/contracts";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
process.env.WORKSPACEX_OBJECT_ROOT = mkdtempSync(join(tmpdir(), "wsx-rec-652-"));

const ORG = "org-rec652";
const PROJECT = "proj-rec652";
const USER = "u-rec652";
const OUTSIDER = "u-rec652-outsider";
const PARTICIPANT = "person-rec652-1";

let app: NestExpressApplication;
let BASE: string;

const auth = (user: string, org: string) => ({ "x-kernel-test-principal": `${user}:${org}` });

async function req(method: string, path: string, user: string, org: string, body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { ...auth(user, org), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function countRows(orgId: string, table: string): Promise<number> {
  return asApp(orgId, async (c) => {
    const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
    return Number(r.rows[0]?.n ?? "0");
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, USER, "facilitator", null);
  await addOrgMember(ORG, OUTSIDER, "consultant", fx.teams.energy!);
  // Deliberately no `addProjectMember` for OUTSIDER — an org member with no role on THIS
  // project, so a refusal here is "not on this project", not "unknown account".
});

describe("PUT /retention-policy — issue #652's first previously-unreachable writer", () => {
  it("a real HTTP call populates retention_policies; nothing existed before it", async () => {
    expect(await countRows(ORG, "retention_policies")).toBe(0);

    const res = await req("PUT", "/retention-policy", USER, ORG, {
      projectId: PROJECT,
      params: { materialDays: 240 },
    });
    expect(res.status).toBe(200);
    const parsed = FilesC.operations.setRetentionPolicy.out.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.materialDays).toBe(240);

    // Not "the response looked right" — the row is actually there, under this org's RLS.
    expect(await countRows(ORG, "retention_policies")).toBe(1);
    const row = await asApp(ORG, (c) =>
      c.query<{ material_days: number }>(
        "SELECT material_days FROM retention_policies WHERE org_id = $1 AND project_id = $2",
        [ORG, PROJECT],
      ),
    );
    expect(row.rows[0]?.material_days).toBe(240);
  });

  it("refuses a non-project-member with PROJECT_ROLE_INSUFFICIENT and writes nothing", async () => {
    const res = await req("PUT", "/retention-policy", OUTSIDER, ORG, {
      projectId: PROJECT,
      params: { materialDays: 90 },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { reasonCode?: string };
    expect(body.reasonCode).toBe("PROJECT_ROLE_INSUFFICIENT");
    expect(await countRows(ORG, "retention_policies")).toBe(0);
  });

  it("GET /retention-policy reads back what PUT wrote, over real HTTP", async () => {
    await req("PUT", "/retention-policy", USER, ORG, {
      projectId: PROJECT,
      params: { materialDays: 365 },
    });
    const res = await req("GET", `/retention-policy?projectId=${PROJECT}`, USER, ORG);
    expect(res.status).toBe(200);
    const parsed = FilesC.operations.getRetentionPolicy.out.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.materialDays).toBe(365);
  });
});

describe("POST /recording/consent/decisions — issue #652's second previously-unreachable writer", () => {
  it("a real HTTP call populates recording_consent_cells; nothing existed before it", async () => {
    const sourceRefId = "thread-rec652-a";
    expect(await countRows(ORG, "recording_consent_cells")).toBe(0);

    const res = await req("POST", "/recording/consent/decisions", USER, ORG, {
      projectId: PROJECT,
      sourceRefId,
      participantId: PARTICIPANT,
      item: "record",
      state: "granted",
    });
    expect(res.status).toBe(201);
    const parsed = C.operations.setConsentDecision.out.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.participantId).toBe(PARTICIPANT);
      expect(parsed.data.item).toBe("record");
      expect(parsed.data.state).toBe("granted");
    }

    expect(await countRows(ORG, "recording_consent_cells")).toBe(1);
    const row = await asApp(ORG, (c) =>
      c.query<{ state: string }>(
        `SELECT state FROM recording_consent_cells
          WHERE org_id = $1 AND source_ref_id = $2 AND participant_id = $3 AND item = 'record'`,
        [ORG, sourceRefId, PARTICIPANT],
      ),
    );
    expect(row.rows[0]?.state).toBe("granted");
  });

  it("is an upsert on (org, sourceRef, participant, item) — a repeat call overwrites, not duplicates", async () => {
    const sourceRefId = "thread-rec652-b";
    await req("POST", "/recording/consent/decisions", USER, ORG, {
      projectId: PROJECT, sourceRefId, participantId: PARTICIPANT, item: "attribution", state: "pending",
    });
    const second = await req("POST", "/recording/consent/decisions", USER, ORG, {
      projectId: PROJECT, sourceRefId, participantId: PARTICIPANT, item: "attribution", state: "denied",
    });
    // The route does not distinguish insert-vs-update in its status code (it is a pure
    // upsert, same as `setRetentionPolicy`'s PUT) — the invariant under test is the ROW
    // COUNT staying at one, not the HTTP status of the second call.
    expect(second.status).toBe(201);
    expect(await countRows(ORG, "recording_consent_cells")).toBe(1);
    const row = await asApp(ORG, (c) =>
      c.query<{ state: string }>(
        `SELECT state FROM recording_consent_cells
          WHERE org_id = $1 AND source_ref_id = $2 AND participant_id = $3 AND item = 'attribution'`,
        [ORG, sourceRefId, PARTICIPANT],
      ),
    );
    expect(row.rows[0]?.state).toBe("denied");
  });

  it("refuses a non-project-member with NO_PROJECT_ROLE and writes nothing", async () => {
    const res = await req("POST", "/recording/consent/decisions", OUTSIDER, ORG, {
      projectId: PROJECT,
      sourceRefId: "thread-rec652-c",
      participantId: PARTICIPANT,
      item: "transcript",
      state: "granted",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { reasonCode?: string };
    expect(body.reasonCode).toBe("NO_PROJECT_ROLE");
    expect(await countRows(ORG, "recording_consent_cells")).toBe(0);
  });

  it("rejects an item outside the signed four-member enum (contract validation, not a 500)", async () => {
    const res = await req("POST", "/recording/consent/decisions", USER, ORG, {
      projectId: PROJECT,
      sourceRefId: "thread-rec652-d",
      participantId: PARTICIPANT,
      item: "not_a_real_item",
      state: "granted",
    });
    expect(res.status).toBe(400);
    expect(await countRows(ORG, "recording_consent_cells")).toBe(0);
  });
});

describe("end-to-end: a real user can reach 'start recording' with ONLY HTTP writes", () => {
  it("PUT retention-policy + POST all four consent decisions (HTTP) -> POST /recording/sessions succeeds", async () => {
    const sourceRefId = "thread-rec652-e2e";

    // Neither gate has been touched by SQL. If this 201s, both #652 gates are satisfiable
    // from outside the process — which is the whole of the issue's acceptance bar.
    const retentionRes = await req("PUT", "/retention-policy", USER, ORG, {
      projectId: PROJECT, params: { materialDays: 180 },
    });
    expect(retentionRes.status).toBe(200);

    for (const item of C.RecordingConsentItem.options) {
      const consentRes = await req("POST", "/recording/consent/decisions", USER, ORG, {
        projectId: PROJECT, sourceRefId, participantId: PARTICIPANT, item, state: "granted",
      });
      expect(consentRes.status).toBe(201);
    }

    const startRes = await req("POST", "/recording/sessions", USER, ORG, {
      sourceType: "thread",
      sourceRefId,
      projectId: PROJECT,
      trackPlan: [{ participantId: PARTICIPANT }],
      idempotencyKey: "idem-rec652-e2e-1",
    });
    expect(startRes.status).toBe(201);
    const parsed = C.operations.startRecording.out.safeParse(await startRes.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.retention.resolvedDays).toBe(180);
      expect(parsed.data.retention.resolvedFrom).toBe("project");
    }
  });

  it("without the consent writes, the SAME setup still refuses CONSENT_NOT_COMPLETED (the gate is real, not bypassed)", async () => {
    await req("PUT", "/retention-policy", USER, ORG, { projectId: PROJECT, params: { materialDays: 180 } });
    const startRes = await req("POST", "/recording/sessions", USER, ORG, {
      sourceType: "thread",
      sourceRefId: "thread-rec652-still-blocked",
      projectId: PROJECT,
      trackPlan: [{ participantId: PARTICIPANT }],
      idempotencyKey: "idem-rec652-e2e-2",
    });
    expect(startRes.status).toBe(403);
    const body = (await startRes.json()) as { reasonCode?: string };
    expect(body.reasonCode).toBe("CONSENT_NOT_COMPLETED");
  });
});
