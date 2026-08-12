import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-personal-transcription-owner";
const PROJECT = "project-personal-transcription-owner";
const OWNER = "user-personal-transcription-owner";
const OTHER = "user-personal-transcription-other";
const ADMIN = "user-personal-transcription-admin";
let app: NestExpressApplication;
let baseUrl: string;

const headers = (userId: string) => ({ "x-kernel-test-principal": `${userId}:${ORG}` });

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
  await addOrgMember(ORG, OWNER, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, OTHER, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
});

describe("personal transcription owner boundary", () => {
  it("returns not found to another member and to an organization administrator", async () => {
    const create = await fetch(`${baseUrl}/recording/realtime-asr/sessions`, {
      method: "POST",
      headers: { ...headers(OWNER), "content-type": "application/json" },
      body: JSON.stringify({ name: "只属于我", tags: [] }),
    });
    expect(create.status).toBe(201);
    const { sessionId } = (await create.json()) as { sessionId: string };

    for (const actor of [OTHER, ADMIN]) {
      const detail = await fetch(`${baseUrl}/recording/realtime-asr/sessions/${sessionId}`, {
        headers: headers(actor),
      });
      expect(detail.status).toBe(404);
      // Both a missing id and another owner's id use the same closed contract code, so the
      // response remains non-enumerable while clients still receive the declared reason.
      expect((await detail.json()) as object).toMatchObject({
        error: "not_found",
        reasonCode: "TRANSCRIPTION_NOT_FOUND",
      });

      const edit = await fetch(`${baseUrl}/recording/realtime-asr/sessions/${sessionId}/content`, {
        method: "PATCH",
        headers: { ...headers(actor), "content-type": "application/json" },
        body: JSON.stringify({ content: "不能修改别人的正文" }),
      });
      expect(edit.status).toBe(404);
      expect(await edit.json()).toMatchObject({ reasonCode: "TRANSCRIPTION_NOT_FOUND" });

      const list = await fetch(`${baseUrl}/recording/realtime-asr/sessions`, {
        headers: headers(actor),
      });
      expect(list.status).toBe(200);
      expect((await list.json()) as object).toMatchObject({ items: [] });
    }
  });
});
