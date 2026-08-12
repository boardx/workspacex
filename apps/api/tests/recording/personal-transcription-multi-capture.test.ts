import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { personalRealtimeTranscription as C } from "@repo/contracts";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgPersonalTranscriptionRepository } from "../../src/infrastructure/recording/pg-personal-transcription-repository";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

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

describe("personal transcription single body", () => {
  it("returns one body and never exposes capture or segment arrays", async () => {
    const create = await fetch(`${baseUrl}/recording/realtime-asr/sessions`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "两段录音", tags: ["内部"] }),
    });
    const { sessionId } = (await create.json()) as { sessionId: string };

    await asOwner((client) => client.query(
      `UPDATE personal_transcriptions SET content=$1 WHERE id=$2`,
      ["第一轮第一句 第一轮第二句 第二轮第一句", sessionId],
    ));

    const response = await fetch(`${baseUrl}/recording/realtime-asr/sessions/${sessionId}`, {
      headers: auth,
    });
    expect(response.status).toBe(200);
    const detail = C.operations.readPersonalTranscription.out.parse(await response.json());
    expect(detail.content).toBe("第一轮第一句 第一轮第二句 第二轮第一句");
    expect(detail).not.toHaveProperty("captures");
  });

  it("atomically appends every confirmed final to the one persisted body", async () => {
    const create = await fetch(`${baseUrl}/recording/realtime-asr/sessions`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "连续正文", tags: [] }),
    });
    const { sessionId } = (await create.json()) as { sessionId: string };
    const db = new PgDatabase(appConfig());
    const repository = new PgPersonalTranscriptionRepository(db);
    try {
      await repository.startCapture({ orgId: ORG as never, ownerUserId: USER,
        transcriptionId: sessionId, captureId: "capture-body", trackId: "track-body" });
      for (const [index, text] of ["第一句", "第二句"].entries()) {
        await repository.appendFinal({ orgId: ORG as never, ownerUserId: USER,
          transcriptionId: sessionId, captureId: "capture-body", segmentId: `final-${index}`,
          ordinal: index + 1, text, startMs: index * 1_000, endMs: (index + 1) * 1_000 });
      }
      const detail = await repository.readOwned({ orgId: ORG as never, ownerUserId: USER,
        transcriptionId: sessionId });
      expect(detail?.content).toBe("第一句 第二句");
      const storedSegments = await asApp(ORG, (client) => client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recording_segments WHERE session_id='capture-body'`,
      ));
      expect(storedSegments.rows[0]?.count).toBe("0");

      await repository.finishCapture({ orgId: ORG as never, ownerUserId: USER,
        transcriptionId: sessionId, captureId: "capture-body", durationMs: 2_000 });
      expect((await repository.readOwned({ orgId: ORG as never, ownerUserId: USER,
        transcriptionId: sessionId }))?.status).toBe("idle");

      await repository.startCapture({ orgId: ORG as never, ownerUserId: USER,
        transcriptionId: sessionId, captureId: "capture-body-2", trackId: "track-body-2" });
      await repository.appendFinal({ orgId: ORG as never, ownerUserId: USER,
        transcriptionId: sessionId, captureId: "capture-body-2", segmentId: "final-3",
        ordinal: 1, text: "第三句", startMs: 0, endMs: 1_000 });
      await repository.finishCapture({ orgId: ORG as never, ownerUserId: USER,
        transcriptionId: sessionId, captureId: "capture-body-2", durationMs: 1_000 });
      const continued = await repository.readOwned({ orgId: ORG as never, ownerUserId: USER,
        transcriptionId: sessionId });
      expect(continued).toMatchObject({ status: "idle", content: "第一句 第二句 第三句" });
    } finally {
      await db.close();
    }
  });
});
