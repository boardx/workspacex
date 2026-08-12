import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { personalRealtimeTranscription as C } from "@repo/contracts";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-personal-transcription-persistence";
const PROJECT = "project-personal-transcription-persistence";
const USER = "user-personal-transcription-persistence";
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

describe("personal transcription persistence", () => {
  it("migration can be replayed without duplicate-constraint failure", async () => {
    for (const file of [
      "20260812000000_f164_personal_realtime_transcriptions.sql",
      "20260812113000_f167_personal_transcription_content.sql",
      "20260812170000_f167_resumable_personal_transcriptions.sql",
    ]) {
      const migration = await readFile(new URL(`../../migrations/${file}`, import.meta.url), "utf8");
      await expect(asOwner((client) => client.query(migration))).resolves.toBeDefined();
    }
  });

  it("survives create -> edit -> search -> detail with one persisted body", async () => {
    const create = await fetch(`${baseUrl}/recording/realtime-asr/sessions`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "欧洲市场讨论", tags: ["客户", "市场研究"] }),
    });
    expect(create.status).toBe(201);
    const created = C.operations.createPersonalTranscription.out.parse(await create.json());
    expect(created.status).toBe("idle");

    const edited = await fetch(`${baseUrl}/recording/realtime-asr/sessions/${created.sessionId}/content`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ content: "讨论了德国市场的合规要求" }),
    });
    expect(edited.status).toBe(200);
    expect(C.operations.updatePersonalTranscriptionContent.out.parse(await edited.json()).content)
      .toBe("讨论了德国市场的合规要求");

    const otherCreate = await fetch(`${baseUrl}/recording/realtime-asr/sessions`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "内部复盘", tags: ["内部"] }),
    });
    expect(otherCreate.status).toBe(201);
    const other = C.operations.createPersonalTranscription.out.parse(await otherCreate.json());

    const list = await fetch(`${baseUrl}/recording/realtime-asr/sessions`, { headers: auth });
    expect(list.status).toBe(200);
    const listed = C.operations.listPersonalTranscriptions.out.parse(await list.json());
    expect(listed.items.map((item) => item.sessionId)).toEqual(expect.arrayContaining([
      created.sessionId,
      other.sessionId,
    ]));

    const searched = await fetch(
      `${baseUrl}/recording/realtime-asr/sessions?query=${encodeURIComponent("合规要求")}`,
      { headers: auth },
    );
    expect(searched.status).toBe(200);
    expect(C.operations.listPersonalTranscriptions.out.parse(await searched.json()).items)
      .toEqual([expect.objectContaining({ sessionId: created.sessionId })]);

    const tagged = await fetch(
      `${baseUrl}/recording/realtime-asr/sessions?tag=${encodeURIComponent("市场研究")}`,
      { headers: auth },
    );
    expect(tagged.status).toBe(200);
    expect(C.operations.listPersonalTranscriptions.out.parse(await tagged.json()).items)
      .toEqual([expect.objectContaining({ sessionId: created.sessionId })]);

    const detail = await fetch(
      `${baseUrl}/recording/realtime-asr/sessions/${encodeURIComponent(created.sessionId)}`,
      { headers: auth },
    );
    expect(detail.status).toBe(200);
    const read = C.operations.readPersonalTranscription.out.parse(await detail.json());
    expect(read.name).toBe("欧洲市场讨论");
    expect(read.tags).toEqual(["客户", "市场研究"]);
    expect(read.content).toBe("讨论了德国市场的合规要求");

    const columns = await asApp(ORG, (client) =>
      client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'personal_transcriptions'`,
      ),
    );
    expect(columns.rows.map((row) => row.column_name)).toContain("content");
  });

  it("rejects malformed cursors with the declared validation reason", async () => {
    const response = await fetch(
      `${baseUrl}/recording/realtime-asr/sessions?cursor=${encodeURIComponent("not-a-cursor")}`,
      { headers: auth },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "bad_request",
      reasonCode: "VALIDATION_FAILED",
    });
  });

  it("storage prevents changing owner identity and invalid tag elements", async () => {
    const create = await fetch(`${baseUrl}/recording/realtime-asr/sessions`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "不可转移", tags: ["客户"] }),
    });
    expect(create.status).toBe(201);
    const created = C.operations.createPersonalTranscription.out.parse(await create.json());

    await expect(asApp(ORG, (client) => client.query(
      `UPDATE personal_transcriptions SET owner_user_id = 'another-user' WHERE id = $1`,
      [created.sessionId],
    ))).rejects.toThrow();

    await expect(asApp(ORG, (client) => client.query(
      `INSERT INTO personal_transcriptions (id, org_id, owner_user_id, name, tags)
       VALUES ('invalid-tags',$1,$2,'invalid',ARRAY['']::text[])`,
      [ORG, USER],
    ))).rejects.toThrow();
  });
});
