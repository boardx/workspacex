import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { personalRealtimeTranscription as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-personal-transcription-captures";
const PROJECT = "project-personal-transcription-captures";
const USER = "user-personal-transcription-captures";
let app: NestExpressApplication;
let baseUrl: string;

const auth = { "x-kernel-test-principal": `${USER}:${ORG}` };

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fixture.teams.energy!);
});

describe("personal transcription multi-capture aggregation", () => {
  it("returns final segments from every capture in stable capture/ordinal order", async () => {
    const create = await fetch(`${baseUrl}/recording/realtime-asr/sessions`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "两段录音", tags: ["内部"] }),
    });
    const { sessionId } = (await create.json()) as { sessionId: string };

    await asApp(ORG, async (client) => {
      for (const [captureId, startedAt, texts] of [
        ["capture-1", "2026-08-11T01:00:00.000Z", ["第一轮第一句", "第一轮第二句"]],
        ["capture-2", "2026-08-11T02:00:00.000Z", ["第二轮第一句"]],
      ] as const) {
        await client.query(
          `INSERT INTO recording_sessions
             (id, org_id, project_id, source_type, source_ref_id, started_at, ended_at,
              duration_ms, materialize_job_id, retention_days, retention_from,
              retention_resolved_at, expires_at, created_by)
           VALUES ($1,$2,NULL,'personal',$3,$4,$4,2000,$5,180,'org',$4,
                   ($4::timestamptz + interval '180 days'),$6)`,
          [captureId, ORG, sessionId, startedAt, `job-${captureId}`, USER],
        );
        await client.query(
          `INSERT INTO recording_tracks
             (id, org_id, session_id, participant_id, mic_state, gap_ranges)
           VALUES ($1,$2,$3,NULL,'granted','[]'::jsonb)`,
          [`track-${captureId}`, ORG, captureId],
        );
        for (const [index, text] of texts.entries()) {
          await client.query(
            `INSERT INTO recording_segments
               (id, org_id, session_id, track_id, ordinal, source_type,
                anchor_start_ms, anchor_end_ms, anchor_message_id, speaker_channel_id,
                status, low_confidence, text, pii_findings)
             VALUES ($1,$2,$3,$4,$5,'personal',$6,$7,NULL,NULL,'final',false,$8,'[]'::jsonb)`,
            [
              `segment-${captureId}-${index + 1}`,
              ORG,
              captureId,
              `track-${captureId}`,
              index + 1,
              index * 1000,
              (index + 1) * 1000,
              text,
            ],
          );
        }
        await client.query(
          `INSERT INTO recording_segments
             (id, org_id, session_id, track_id, ordinal, source_type,
              anchor_start_ms, anchor_end_ms, anchor_message_id, speaker_channel_id,
              status, low_confidence, text, pii_findings)
           VALUES ($1,$2,$3,$4,99,'personal',3000,3500,NULL,NULL,'partial',false,
                   '不得出现在详情里','[]'::jsonb)`,
          [`partial-${captureId}`, ORG, captureId, `track-${captureId}`],
        );
      }
    });

    const response = await fetch(`${baseUrl}/recording/realtime-asr/sessions/${sessionId}`, {
      headers: auth,
    });
    expect(response.status).toBe(200);
    const detail = C.operations.readPersonalTranscription.out.parse(await response.json());
    expect(detail.captures.map((capture) => capture.captureId)).toEqual(["capture-1", "capture-2"]);
    expect(detail.captures.flatMap((capture) => capture.segments.map((segment) => segment.text))).toEqual([
      "第一轮第一句",
      "第一轮第二句",
      "第二轮第一句",
    ]);
  });
});
