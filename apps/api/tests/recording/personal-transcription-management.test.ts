import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { personalRealtimeTranscription as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PERSONAL_TRANSCRIPTION_REPOSITORY, type PersonalTranscriptionRepository } from "../../src/application/recording/personal-transcription-ports";
import { ASR_USAGE_METER, type AsrUsageMeter } from "../../src/application/recording/personal-realtime-asr";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-personal-transcription-management";
const PROJECT = "project-personal-transcription-management";
const USER = "user-personal-transcription-management";
const OTHER = "user-personal-transcription-other";
let app: NestExpressApplication;
let baseUrl: string;
let repository: PersonalTranscriptionRepository;
let usage: AsrUsageMeter;

const auth = (userId = USER) => ({ "x-kernel-test-principal": `${userId}:${ORG}` });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  repository = app.get(PERSONAL_TRANSCRIPTION_REPOSITORY);
  usage = app.get(ASR_USAGE_METER);
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
  await addOrgMember(ORG, OTHER, "consultant", fixture.teams.energy!);
});

async function create(name: string, tags: string[], userId = USER) {
  const response = await fetch(`${baseUrl}/recording/realtime-asr/sessions`, {
    method: "POST",
    headers: { ...auth(userId), "content-type": "application/json" },
    body: JSON.stringify({ name, tags }),
  });
  expect(response.status).toBe(201);
  return C.operations.createPersonalTranscription.out.parse(await response.json());
}

describe("personal transcription management", () => {
  it("lists only distinct tags from the current user's transcriptions", async () => {
    await create("市场讨论", ["客户", "市场研究"]);
    await create("内部复盘", ["客户", "内部"]);
    await create("他人讨论", ["不可见"], OTHER);

    const response = await fetch(`${baseUrl}/recording/realtime-asr/tags`, { headers: auth() });
    expect(response.status).toBe(200);
    expect(C.operations.listPersonalTranscriptionTags.out.parse(await response.json()))
      .toEqual({ tags: ["内部", "客户", "市场研究"] });
  });

  it("updates owner metadata and rejects another user or an active capture", async () => {
    const transcription = await create("旧名称", ["旧标签"]);
    const changed = await fetch(`${baseUrl}/recording/realtime-asr/sessions/${transcription.sessionId}`, {
      method: "PATCH", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ name: "新名称", tags: ["客户", "复盘"] }),
    });
    expect(changed.status).toBe(200);
    expect(C.operations.updatePersonalTranscriptionMetadata.out.parse(await changed.json()))
      .toMatchObject({ name: "新名称", tags: ["客户", "复盘"] });

    const hidden = await fetch(`${baseUrl}/recording/realtime-asr/sessions/${transcription.sessionId}`, {
      method: "PATCH", headers: { ...auth(OTHER), "content-type": "application/json" },
      body: JSON.stringify({ name: "越权", tags: [] }),
    });
    expect(hidden.status).toBe(404);

    await repository.startCapture({ orgId: toOrgId(ORG), ownerUserId: USER,
      transcriptionId: transcription.sessionId, captureId: "capture-active", trackId: "track-active" });
    const active = await fetch(`${baseUrl}/recording/realtime-asr/sessions/${transcription.sessionId}`, {
      method: "PATCH", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ name: "录音时不可改", tags: [] }),
    });
    expect(active.status).toBe(409);
    expect(await active.json()).toMatchObject({ reasonCode: "CAPTURE_ALREADY_ACTIVE" });
    await repository.finishCapture({ orgId: toOrgId(ORG), ownerUserId: USER,
      transcriptionId: transcription.sessionId, captureId: "capture-active", durationMs: 1_000 });
  });

  it("deletes content and captures, preserves usage audit, and rejects active deletion", async () => {
    const transcription = await create("待删除", ["删除后消失"]);
    await repository.startCapture({ orgId: toOrgId(ORG), ownerUserId: USER,
      transcriptionId: transcription.sessionId, captureId: "capture-delete", trackId: "track-delete" });
    await repository.appendFinal({ orgId: toOrgId(ORG), ownerUserId: USER,
      transcriptionId: transcription.sessionId, captureId: "capture-delete", segmentId: "segment-delete",
      ordinal: 1, text: "应永久删除的正文", startMs: 0, endMs: 1_000 });

    const activeDelete = await fetch(`${baseUrl}/recording/realtime-asr/sessions/${transcription.sessionId}`, {
      method: "DELETE", headers: auth(),
    });
    expect(activeDelete.status).toBe(409);

    await repository.finishCapture({ orgId: toOrgId(ORG), ownerUserId: USER,
      transcriptionId: transcription.sessionId, captureId: "capture-delete", durationMs: 1_000 });
    await expect(usage.record({ providerTaskId: "f177-provider-task", orgId: toOrgId(ORG), ownerUserId: USER,
      captureId: "capture-delete", model: "qwen3-asr-flash-realtime", durationSeconds: 1 })).resolves.toBe(true);

    const response = await fetch(`${baseUrl}/recording/realtime-asr/sessions/${transcription.sessionId}`, {
      method: "DELETE", headers: auth(),
    });
    expect(response.status).toBe(200);
    expect(C.operations.deletePersonalTranscription.out.parse(await response.json())).toEqual({ deleted: true });

    const counts = await asApp(ORG, async (client) => ({
      transcriptions: Number((await client.query(`SELECT count(*) FROM personal_transcriptions WHERE id=$1`,
        [transcription.sessionId])).rows[0].count),
      captures: Number((await client.query(`SELECT count(*) FROM recording_sessions WHERE id='capture-delete'`)).rows[0].count),
      usage: Number((await client.query(`SELECT count(*) FROM realtime_asr_usage_events WHERE provider_task_id='f177-provider-task'`)).rows[0].count),
    }));
    expect(counts).toEqual({ transcriptions: 0, captures: 0, usage: 1 });

    const tags = await fetch(`${baseUrl}/recording/realtime-asr/tags`, { headers: auth() });
    expect(C.operations.listPersonalTranscriptionTags.out.parse(await tags.json())).toEqual({ tags: [] });
  });
});
