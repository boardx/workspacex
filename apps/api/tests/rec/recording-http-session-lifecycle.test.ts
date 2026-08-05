/**
 * issue #465 — the recording bundle's HTTP boundary.
 *
 * Before this file the recording bundle had 28 contract operations, 10 domain files and 11
 * application files, and **not one route**. From outside the process the whole capability was
 * zero: nothing in `kernel.module.ts` mounted it, so no browser, no client and no other
 * service could reach any of it. That is the gap this test is about, which is why every
 * assertion below goes through a real listening socket rather than calling a use case.
 *
 * What is deliberately real here:
 *
 *   · **Real HTTP.** `createApp()` + `listen(0)` + `fetch`, the same shape
 *     `tests/kernel/contract-response.test.ts` uses. A test that imported the controller and
 *     called its method would pass with the controller unregistered — i.e. it would pass in
 *     exactly the state this issue exists to fix.
 *   · **Real PostgreSQL.** The residue assertions (`SELECT count(*) FROM recording_sessions`)
 *     are the point of the consent case: "the response said 403" and "nothing was written"
 *     are two different claims, and only the second one is the invariant. A refusal that
 *     leaves a half-built session behind is a refusal in the response body only.
 *   · **Real object store + artifact registry.** Materialisation is asserted by reading the
 *     bytes back out of the store the `artifact_versions` row points at, and comparing them
 *     to the segments that were pushed in. "The endpoint returned 200 with an artifactId" is
 *     compatible with an empty file.
 *
 * Responses are checked with `out.safeParse` on the contract's own schema, which is
 * `.strict()` — zod's default STRIPS unknown keys, so a non-strict parse of an over-wide
 * response succeeds while telling you nothing.
 *
 * ## Why the lifecycle case uses the `thread` carrier
 *
 * `transcription-core.ts`'s `ANCHOR_RULES` gives `workshop`/`interview` timecode anchors,
 * and I-2 requires `endMs <= session.durationMs` — a live session's duration is elapsed wall
 * clock, so a timecode fixture would be asserting against the test's own scheduling latency.
 * `thread` anchors on `messageId` and its file plan is `transcript.jsonl` alone (no audio),
 * which is precisely the "实时录音在 chat 上" path this wave is about. The timecode carriers
 * share the same code path by construction (one `transcribe`, one `TranscribedSegment`
 * brand), so exercising one carrier here is not exercising one of three pipelines.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { recording as C } from "@repo/contracts";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
process.env.WORKSPACEX_OBJECT_ROOT = mkdtempSync(join(tmpdir(), "wsx-rec-465-"));
// D-1 (「多低算低」) is undecided and this bundle must not pick a number, so the threshold is
// a DEPLOYMENT parameter with no built-in default. Setting it here is the test acting as the
// deployment; `refuses to ingest when the low-confidence threshold is unconfigured` below
// asserts the unset case fails closed rather than silently flagging nothing.
process.env.RECORDING_LOW_CONFIDENCE_THRESHOLD = "0.6";

const ORG = "org-rec465";
const OTHER_ORG = "org-rec465-other";
const PROJECT = "proj-rec465";
const OTHER_PROJECT = "proj-rec465-other";
const USER = "u-rec465";
const OUTSIDER = "u-rec465-outsider";
const OTHER_USER = "u-rec465-other";
const P1 = "person-rec465-1";
const P2 = "person-rec465-2";

let app: NestExpressApplication;
let BASE: string;

const auth = (user: string, org: string) => ({ "x-kernel-test-principal": `${user}:${org}` });

const post = (path: string, user: string, org: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...auth(user, org), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Grant all three consent items to a participant on this source. */
async function grantConsent(orgId: string, sourceRefId: string, participantId: string): Promise<void> {
  await asApp(orgId, async (c) => {
    for (const item of C.RecordingConsentItem.options) {
      await c.query(
        `INSERT INTO recording_consent_cells (org_id, source_ref_id, participant_id, item, state)
         VALUES ($1,$2,$3,$4,'granted')
         ON CONFLICT (org_id, source_ref_id, participant_id, item) DO UPDATE SET state = 'granted'`,
        [orgId, sourceRefId, participantId, item],
      );
    }
  });
}

/** Leave one item `pending` — the exact shape `startRecording`'s gate must refuse. */
async function pendingConsent(
  orgId: string,
  sourceRefId: string,
  participantId: string,
  pendingItem: string,
): Promise<void> {
  await asApp(orgId, async (c) => {
    for (const item of C.RecordingConsentItem.options) {
      await c.query(
        `INSERT INTO recording_consent_cells (org_id, source_ref_id, participant_id, item, state)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (org_id, source_ref_id, participant_id, item) DO UPDATE SET state = EXCLUDED.state`,
        [orgId, sourceRefId, participantId, item, item === pendingItem ? "pending" : "granted"],
      );
    }
  });
}

async function setRetention(orgId: string, projectId: string, days: number): Promise<void> {
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO retention_policies (project_id, org_id, material_days, updated_by)
       VALUES ($1,$2,$3,'u-seed')
       ON CONFLICT (project_id) DO UPDATE SET material_days = EXCLUDED.material_days`,
      [projectId, orgId, days],
    ),
  );
}

/** The refusal's machine-readable reason. Asserting the STATUS alone would pass for the
 *  wrong refusal — 403 is both "no consent" and "no project role", and they are not the
 *  same finding. */
async function reasonCodeOf(res: Response): Promise<string | undefined> {
  const body = (await res.json()) as { reasonCode?: string };
  return body.reasonCode;
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
  await resetOrgs(ORG, OTHER_ORG);
});

beforeEach(async () => {
  process.env.RECORDING_LOW_CONFIDENCE_THRESHOLD = "0.6";
  await resetOrgs(ORG, OTHER_ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, USER, "facilitator", null);
  await addOrgMember(ORG, OUTSIDER, "consultant", fx.teams.energy!);
  // OUTSIDER is deliberately an org member with NO project membership: the interesting
  // refusal is "in the tenant, not on this project", not "unknown user".
  const other = await seedOrg({ orgId: OTHER_ORG, projectId: OTHER_PROJECT });
  await addOrgMember(OTHER_ORG, OTHER_USER, "consultant", other.teams.energy!);
  await addProjectMember(OTHER_ORG, OTHER_PROJECT, OTHER_USER, "facilitator", null);
  await setRetention(ORG, PROJECT, 180);
  await setRetention(OTHER_ORG, OTHER_PROJECT, 180);
});

describe("POST /recording/sessions .. /segments .. /end .. /materialize", () => {
  it("start -> ingest N -> end -> materialize, and the transcript holds what was pushed", async () => {
    const sourceRefId = "thread-rec465-a";
    await grantConsent(ORG, sourceRefId, P1);
    await grantConsent(ORG, sourceRefId, P2);

    const startRes = await post("/recording/sessions", USER, ORG, {
      sourceType: "thread",
      sourceRefId,
      projectId: PROJECT,
      trackPlan: [{ participantId: P1 }, { participantId: P2 }],
      idempotencyKey: "start-a",
    });
    expect(startRes.status).toBe(201);
    const startParsed = C.operations.startRecording.out.safeParse(await startRes.json());
    expect(startParsed.success).toBe(true);
    if (!startParsed.success) return;
    const { sessionId, tracks, retention } = startParsed.data;
    expect(tracks).toHaveLength(2);
    expect(retention.resolvedDays).toBe(180);
    expect(retention.resolvedFrom).toBe("project");

    const texts = ["第一段发言", "第二段发言", "第三段发言"];
    const segmentIds: string[] = [];
    for (const [i, text] of texts.entries()) {
      const res = await post(`/recording/sessions/${sessionId}/segments`, USER, ORG, {
        sessionId,
        trackId: tracks[0]!.trackId,
        anchor: { startMs: null, endMs: null, messageId: `msg-${i}` },
        rawText: text,
        asrConfidence: 0.95,
        diarization: { channelId: "ch-1", overlap: false },
        idempotencyKey: `seg-a-${i}`,
      });
      expect(res.status).toBe(201);
      const parsed = C.operations.ingestSegment.out.safeParse(await res.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.status).toBe("final");
      expect(parsed.data.lowConfidence).toBe(false);
      expect(parsed.data.text).toBe(text);
      segmentIds.push(parsed.data.segmentId);
    }

    // The rows are really there, under this tenant, before anything is materialised.
    expect(await countRows(ORG, "recording_segments")).toBe(3);

    const endRes = await post(`/recording/sessions/${sessionId}/end`, USER, ORG, {
      sessionId,
      idempotencyKey: "end-a",
    });
    expect(endRes.status).toBe(200);
    const endParsed = C.operations.endRecording.out.safeParse(await endRes.json());
    expect(endParsed.success).toBe(true);
    if (!endParsed.success) return;
    expect(endParsed.data.sessionId).toBe(sessionId);
    expect(endParsed.data.materializeJobId.length).toBeGreaterThan(0);

    const matRes = await post(`/recording/sessions/${sessionId}/materialize`, USER, ORG, {
      sessionId,
      idempotencyKey: "mat-a",
    });
    expect(matRes.status).toBe(200);
    const matParsed = C.operations.materializeRecordingArtifacts.out.safeParse(await matRes.json());
    expect(matParsed.success).toBe(true);
    if (!matParsed.success) return;
    const transcript = matParsed.data.artifacts.find((a) => a.kind === "transcript");
    expect(transcript).toBeDefined();
    // A chat thread carries no audio, so its transcript IS the original (`file-first.ts`).
    expect(transcript!.derivedFrom).toBeNull();

    // The registry row exists in the ORDINARY artifact tables -- I-28 forbids a second
    // recording-only index, so `artifact_versions` is where this has to be visible.
    const key = await asApp(ORG, async (c) => {
      const r = await c.query<{ object_storage_key: string }>(
        "SELECT object_storage_key FROM artifact_versions WHERE id = $1",
        [transcript!.versionId],
      );
      return r.rows[0]?.object_storage_key ?? null;
    });
    expect(key).not.toBeNull();

    // ...and the bytes behind it are the segments that were pushed, not an empty file.
    const { FsObjectStore } = await import("../../src/infrastructure/storage/fs-object-store");
    const { objectStoreRoot } = await import("../../src/infrastructure/storage/object-store-root");
    const bytes = await new FsObjectStore(objectStoreRoot()).get(key!);
    expect(bytes).not.toBeNull();
    const lines = Buffer.from(bytes!).toString("utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    const written = lines.map((l) => JSON.parse(l) as { id: string; text: string });
    expect(written.map((s) => s.text)).toEqual(texts);
    expect(written.map((s) => s.id)).toEqual(segmentIds);
  });

  it("refuses to start when any consent cell is still pending, and writes NOTHING", async () => {
    const sourceRefId = "thread-rec465-b";
    await grantConsent(ORG, sourceRefId, P1);
    await pendingConsent(ORG, sourceRefId, P2, "ai_analysis");

    const res = await post("/recording/sessions", USER, ORG, {
      sourceType: "thread",
      sourceRefId,
      projectId: PROJECT,
      trackPlan: [{ participantId: P1 }, { participantId: P2 }],
      idempotencyKey: "start-b",
    });

    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("CONSENT_NOT_COMPLETED");
    // Zero residue. A session row or a track row here means the gate ran after the write.
    expect(await countRows(ORG, "recording_sessions")).toBe(0);
    expect(await countRows(ORG, "recording_tracks")).toBe(0);
  });

  it("refuses to start when only the three pre-#533 items are granted (3/4 is not consent)", async () => {
    // #533 —— X-7/XC-18 的裁决落地后**唯一的行为差异**，所以它值一条自己的用例。
    //
    // ⚠ 这三项是**写死的字面量，不是 `C.RecordingConsentItem.options.slice(0,3)`**：
    //   本用例要固定的是「2026-08-05 之前那套三项」这个历史事实。若改成从枚举派生，
    //   哪天有人把 `attribution` 从枚举里删回去，这个 fixture 会跟着变成「全部授权」，
    //   于是用例期望的 403 变成期望「全授权也拒绝」——它会红，但**红在错的原因上**，
    //   而下一个人看到红只会把期望改成 200。写死才能让它红在判定上。
    const LEGACY_THREE = ["record", "transcript", "ai_analysis"] as const;
    const sourceRefId = "thread-rec533-partial";
    await grantConsent(ORG, sourceRefId, P1);
    await asApp(ORG, async (c) => {
      for (const item of LEGACY_THREE) {
        await c.query(
          `INSERT INTO recording_consent_cells (org_id, source_ref_id, participant_id, item, state)
           VALUES ($1,$2,$3,$4,'granted')
           ON CONFLICT (org_id, source_ref_id, participant_id, item) DO UPDATE SET state = 'granted'`,
          [ORG, sourceRefId, P2, item],
        );
      }
    });
    // P2 的 `attribution` 一行都没有——「没问过」不等于「同意被署名引述」。

    const res = await post("/recording/sessions", USER, ORG, {
      sourceType: "thread",
      sourceRefId,
      projectId: PROJECT,
      trackPlan: [{ participantId: P1 }, { participantId: P2 }],
      idempotencyKey: "start-533-partial",
    });

    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("CONSENT_NOT_COMPLETED");
    expect(await countRows(ORG, "recording_sessions")).toBe(0);
    expect(await countRows(ORG, "recording_tracks")).toBe(0);

    // 正对照：同一个人补上第四项后必须放行。少了这一条，上面的 403 与
    // 「这条路径根本起不来」不可分辨——那是空转断言的经典形状。
    await grantConsent(ORG, sourceRefId, P2);
    const ok = await post("/recording/sessions", USER, ORG, {
      sourceType: "thread",
      sourceRefId,
      projectId: PROJECT,
      trackPlan: [{ participantId: P1 }, { participantId: P2 }],
      idempotencyKey: "start-533-complete",
    });
    expect(ok.status).toBe(201);
  });

  it("refuses to start when a participant has no consent row at all (fail closed)", async () => {
    const sourceRefId = "thread-rec465-c";
    await grantConsent(ORG, sourceRefId, P1);
    // P2 has no rows whatsoever. "Never asked" must not read as "granted".
    const res = await post("/recording/sessions", USER, ORG, {
      sourceType: "thread",
      sourceRefId,
      projectId: PROJECT,
      trackPlan: [{ participantId: P1 }, { participantId: P2 }],
      idempotencyKey: "start-c",
    });
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("CONSENT_NOT_COMPLETED");
    expect(await countRows(ORG, "recording_sessions")).toBe(0);
  });

  it("refuses to start with no retention policy configured, and writes nothing", async () => {
    const sourceRefId = "thread-rec465-d";
    await grantConsent(ORG, sourceRefId, P1);
    // As the OWNER: F46 grants the app role no DELETE on `retention_policies` (a project's
    // retention is set and cleared through its own route, not removed wholesale), and this
    // is fixture teardown rather than something the test is asserting.
    await asOwner((c) => c.query("DELETE FROM retention_policies WHERE project_id = $1", [PROJECT]));

    const res = await post("/recording/sessions", USER, ORG, {
      sourceType: "thread",
      sourceRefId,
      projectId: PROJECT,
      trackPlan: [{ participantId: P1 }],
      idempotencyKey: "start-d",
    });
    expect(res.status).toBe(422);
    expect(await reasonCodeOf(res)).toBe("RETENTION_POLICY_MISSING");
    expect(await countRows(ORG, "recording_sessions")).toBe(0);
  });

  it("is not an open door: unauthenticated 401, org member without project role 403", async () => {
    const sourceRefId = "thread-rec465-e";
    await grantConsent(ORG, sourceRefId, P1);
    const body = {
      sourceType: "thread",
      sourceRefId,
      projectId: PROJECT,
      trackPlan: [{ participantId: P1 }],
      idempotencyKey: "start-e",
    };

    const anon = await fetch(`${BASE}/recording/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(anon.status).toBe(401);

    const noRole = await post("/recording/sessions", OUTSIDER, ORG, {
      ...body,
      idempotencyKey: "start-e2",
    });
    expect(noRole.status).toBe(403);
    expect(await reasonCodeOf(noRole)).toBe("NO_PROJECT_ROLE");
    expect(await countRows(ORG, "recording_sessions")).toBe(0);
  });

  it("another tenant cannot push segments into this tenant's session", async () => {
    const sourceRefId = "thread-rec465-f";
    await grantConsent(ORG, sourceRefId, P1);
    const started = await post("/recording/sessions", USER, ORG, {
      sourceType: "thread",
      sourceRefId,
      projectId: PROJECT,
      trackPlan: [{ participantId: P1 }],
      idempotencyKey: "start-f",
    });
    const parsed = C.operations.startRecording.out.safeParse(await started.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const stolen = await post(
      `/recording/sessions/${parsed.data.sessionId}/segments`,
      OTHER_USER,
      OTHER_ORG,
      {
        sessionId: parsed.data.sessionId,
        trackId: parsed.data.tracks[0]!.trackId,
        anchor: { startMs: null, endMs: null, messageId: "msg-x" },
        rawText: "越权写入",
        asrConfidence: 0.95,
        diarization: { channelId: null, overlap: false },
        idempotencyKey: "seg-f-0",
      },
    );
    // 404, not 403: a distinguishable 403 would make the endpoint an oracle for session ids
    // belonging to other tenants.
    expect(stolen.status).toBe(404);
    expect(await countRows(ORG, "recording_segments")).toBe(0);
  });

  it("refuses to ingest when the low-confidence threshold is unconfigured (no silent default)", async () => {
    const sourceRefId = "thread-rec465-g";
    await grantConsent(ORG, sourceRefId, P1);
    const started = await post("/recording/sessions", USER, ORG, {
      sourceType: "thread",
      sourceRefId,
      projectId: PROJECT,
      trackPlan: [{ participantId: P1 }],
      idempotencyKey: "start-g",
    });
    const parsed = C.operations.startRecording.out.safeParse(await started.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    delete process.env.RECORDING_LOW_CONFIDENCE_THRESHOLD;
    const res = await post(`/recording/sessions/${parsed.data.sessionId}/segments`, USER, ORG, {
      sessionId: parsed.data.sessionId,
      trackId: parsed.data.tracks[0]!.trackId,
      anchor: { startMs: null, endMs: null, messageId: "msg-y" },
      rawText: "阈值未配置",
      asrConfidence: 0.1,
      diarization: { channelId: null, overlap: false },
      idempotencyKey: "seg-g-0",
    });
    // 503, not a quiet `lowConfidence: false`. Flagging nothing IS picking a threshold.
    expect(res.status).toBe(503);
    expect(await countRows(ORG, "recording_segments")).toBe(0);
  });

  it("replays an identical idempotency key instead of starting a second session", async () => {
    const sourceRefId = "thread-rec465-h";
    await grantConsent(ORG, sourceRefId, P1);
    const body = {
      sourceType: "thread",
      sourceRefId,
      projectId: PROJECT,
      trackPlan: [{ participantId: P1 }],
      idempotencyKey: "start-h",
    };
    const first = C.operations.startRecording.out.safeParse(
      await (await post("/recording/sessions", USER, ORG, body)).json(),
    );
    const replayRes = await post("/recording/sessions", USER, ORG, body);
    expect(replayRes.status).toBe(200);
    const replay = C.operations.startRecording.out.safeParse(await replayRes.json());
    expect(first.success && replay.success).toBe(true);
    if (!first.success || !replay.success) return;
    expect(replay.data.sessionId).toBe(first.data.sessionId);
    expect(await countRows(ORG, "recording_sessions")).toBe(1);
  });

  it("does not materialize a session that has not ended", async () => {
    const sourceRefId = "thread-rec465-i";
    await grantConsent(ORG, sourceRefId, P1);
    const parsed = C.operations.startRecording.out.safeParse(
      await (
        await post("/recording/sessions", USER, ORG, {
          sourceType: "thread",
          sourceRefId,
          projectId: PROJECT,
          trackPlan: [{ participantId: P1 }],
          idempotencyKey: "start-i",
        })
      ).json(),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const res = await post(`/recording/sessions/${parsed.data.sessionId}/materialize`, USER, ORG, {
      sessionId: parsed.data.sessionId,
      idempotencyKey: "mat-i",
    });
    expect(res.status).toBe(409);
    expect(await reasonCodeOf(res)).toBe("SESSION_NOT_ENDED");
    expect(await countRows(ORG, "artifacts")).toBe(0);
  });

  it("does not accept segments after the session ended", async () => {
    const sourceRefId = "thread-rec465-j";
    await grantConsent(ORG, sourceRefId, P1);
    const parsed = C.operations.startRecording.out.safeParse(
      await (
        await post("/recording/sessions", USER, ORG, {
          sourceType: "thread",
          sourceRefId,
          projectId: PROJECT,
          trackPlan: [{ participantId: P1 }],
          idempotencyKey: "start-j",
        })
      ).json(),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await post(`/recording/sessions/${parsed.data.sessionId}/end`, USER, ORG, {
      sessionId: parsed.data.sessionId,
      idempotencyKey: "end-j",
    });

    const res = await post(`/recording/sessions/${parsed.data.sessionId}/segments`, USER, ORG, {
      sessionId: parsed.data.sessionId,
      trackId: parsed.data.tracks[0]!.trackId,
      anchor: { startMs: null, endMs: null, messageId: "msg-late" },
      rawText: "结束之后",
      asrConfidence: 0.95,
      diarization: { channelId: null, overlap: false },
      idempotencyKey: "seg-j-late",
    });
    expect(res.status).toBe(409);
    expect(await reasonCodeOf(res)).toBe("SESSION_ENDED");
    expect(await countRows(ORG, "recording_segments")).toBe(0);
  });
});
