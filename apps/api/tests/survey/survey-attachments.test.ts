import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { deflateSync } from "node:zlib";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import {
  SURVEY_ATTACHMENT_SERVICE,
  type SurveyAttachmentService,
  validateSurveyUpload,
} from "../../src/application/survey/survey-attachment-service";
import { claimSurveyAttachments } from "../../src/infrastructure/survey/pg-survey-attachment-repository";
import {
  DATABASE_PORT,
  type DatabasePort,
} from "../../src/application/ports/database.port";
import {
  PHYSICAL_PURGE_PORT,
  type PhysicalPurgePort,
} from "../../src/application/files/physical-delete-ports";
import {
  OBJECT_STORE,
  type ObjectStore,
} from "../../src/application/artifact/ports";
import { toOrgId } from "../../src/domain/org-id";
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const ORG = "org-survey-upload";
const OWNER = "upload-owner";
let app: NestExpressApplication;
let base: string;
let token: string;
let surveyId: string;
let peer = 0;
const publicHeaders = () => ({ "x-real-ip": `192.0.2.${peer}` });
beforeEach(() => {
  peer++;
});
const headers = {
  "x-kernel-test-principal": `${OWNER}:${ORG}`,
  "content-type": "application/json",
};
function png({
  color = 6,
  depth = 8,
  interlace = 0,
  width = 1,
  height = 1,
  palette = true,
  filter = 0,
} = {}) {
  const chunk = (type: string, bytes: Buffer) => {
    const h = Buffer.alloc(4);
    h.writeUInt32BE(bytes.length);
    let crc = 0xffffffff;
    for (const v of Buffer.concat([Buffer.from(type), bytes])) {
      crc ^= v;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([h, Buffer.from(type), bytes, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = color;
  ihdr[12] = interlace;
  const channels =
    ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color] ?? 1;
  const passes = interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  const raw: Buffer[] = [];
  for (const [x, y, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x!) / dx!)),
      h = Math.max(0, Math.ceil((height - y!) / dy!));
    if (!w) continue;
    for (let row = 0; row < h; row++) {
      const bytes = Buffer.alloc(1 + Math.ceil((w * channels * depth) / 8));
      bytes[0] = filter;
      raw.push(bytes);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    ...(color === 3 && palette ? [chunk("PLTE", Buffer.from([0, 0, 0]))] : []),
    chunk("IDAT", deflateSync(Buffer.concat(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "survey-upload-project" });
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  // Seed the publication through tenant SQL to keep attachment transport proof independent of question-editor defaults.
  surveyId = "survey-upload-fixture";
  token =
    Buffer.from(JSON.stringify([ORG, surveyId])).toString("base64url") +
    ".secret-publication";
  const question = {
    id: "f",
    order: 1,
    chapterId: "c",
    title: "材料",
    type: "file",
    required: false,
    options: [],
    config: { maxFiles: 2, maxFileBytes: 8388608, allowedExtensions: ["png"] },
  };
  const record = {
    ownerId: OWNER,
    receipts: {},
    model: {
      id: surveyId,
      title: "附件",
      version: 1,
      answerRevision: 0,
      updatedAt: new Date().toISOString(),
      report: null,
      reportBasisVersion: null,
      reportBasisAnswerRevision: null,
      reportGeneratedAt: null,
      template: { id: "t", title: "附件报告", sections: [] },
      questions: [question],
      responses: [],
      publication: {
        token,
        version: 1,
        status: "collecting",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        questions: [question, { ...question, id: "sig", type: "signature" }],
      },
    },
  };
  await app
    .get<DatabasePort>(DATABASE_PORT)
    .withTenant(toOrgId(ORG), (s) =>
      s.query(
        "INSERT INTO survey_workspaces(org_id,id,owner_id,document) VALUES($1,$2,$3,$4)",
        [ORG, surveyId, OWNER, record],
      ),
    );
}, 180000);
afterAll(async () => {
  if (app) {
    const rows = await app
      .get<DatabasePort>(DATABASE_PORT)
      .withTenant(toOrgId(ORG), (s) =>
        s.query<{ object_key: string }>(
          "SELECT object_key FROM survey_attachments WHERE org_id=$1",
          [ORG],
        ),
      );
    await app
      .get<PhysicalPurgePort>(PHYSICAL_PURGE_PORT)
      .purgeAll(rows.rows.map((r) => r.object_key));
    await app.close();
    await resetOrgs(ORG);
  }
});
async function session(submissionId = "submission-123") {
  const r = await fetch(`${base}/public/surveys/${token}/upload-sessions`, {
    method: "POST",
    headers: { ...publicHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ submissionId }),
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { uploadSessionToken: string })
    .uploadSessionToken;
}
async function upload(
  secret: string,
  q = "f",
  bytes: Uint8Array = png(),
  mime = "image/png",
) {
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mime }),
    "signature.png",
  );
  return fetch(
    `${base}/public/surveys/${token}/upload-sessions/${secret}/questions/${q}/attachments`,
    { method: "POST", headers: publicHeaders(), body: fd },
  );
}
it("rejects forged PNG and binary claiming text", () => {
  expect(() =>
    validateSurveyUpload(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ),
  ).toThrow();
  expect(() =>
    validateSurveyUpload(new Uint8Array([255, 255]), "text/plain"),
  ).toThrow();
});
it("accepts grayscale, indexed, 16-bit and Adam7 PNGs while rejecting invalid color/depth, palette and filter data", () => {
  for (const depth of [1, 2, 4, 8, 16])
    expect(() =>
      validateSurveyUpload(png({ color: 0, depth }), "image/png"),
    ).not.toThrow();
  for (const depth of [1, 2, 4, 8])
    expect(() =>
      validateSurveyUpload(png({ color: 3, depth }), "image/png"),
    ).not.toThrow();
  for (const color of [2, 4, 6])
    expect(() =>
      validateSurveyUpload(png({ color, depth: 16 }), "image/png"),
    ).not.toThrow();
  expect(() =>
    validateSurveyUpload(
      png({ color: 3, depth: 2, interlace: 1, width: 9, height: 9 }),
      "image/png",
    ),
  ).not.toThrow();
  for (const bytes of [
    png({ color: 3, palette: false }),
    png({ color: 3, depth: 16 }),
    png({ filter: 5 }),
  ])
    expect(() => validateSurveyUpload(bytes, "image/png")).toThrow();
  const corrupt = png({ color: 0 });
  corrupt[corrupt.length - 1] ^= 1;
  expect(() => validateSurveyUpload(corrupt, "image/png")).toThrow();
});
it("accepts real grayscale and palette file uploads through HTTP", async () => {
  const secret = await session("png-variants");
  expect((await upload(secret, "f", png({ color: 0, depth: 16 }))).status).toBe(
    201,
  );
  expect((await upload(secret, "f", png({ color: 3, depth: 4 }))).status).toBe(
    201,
  );
});
it("real multipart bytes, cross-session refusal, atomic claim, owner-only download and no delete after claim", async () => {
  const a = await session(),
    b = await session("submission-456");
  const r = await upload(a);
  expect(r.status).toBe(201);
  const file = (await r.json()) as { attachmentId: string };
  const db = app.get<DatabasePort>(DATABASE_PORT);
  const input = {
    orgId: toOrgId(ORG),
    surveyId,
    publicationVersion: 1,
    submissionId: "submission-123",
    uploadSessionToken: a,
    responseId: "response-real",
    references: [{ questionId: "f", attachmentIds: [file.attachmentId] }],
  };
  await expect(
    db.withTenant(toOrgId(ORG), (s) =>
      claimSurveyAttachments(s, { ...input, uploadSessionToken: b }),
    ),
  ).rejects.toThrow();
  await expect(
    db.withTenant(toOrgId(ORG), async (s) => {
      await claimSurveyAttachments(s, input);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  await db.withTenant(toOrgId(ORG), (s) => claimSurveyAttachments(s, input));
  const url = `${base}/surveys/${surveyId}/responses/response-real/attachments/${file.attachmentId}/content`;
  expect((await fetch(url)).status).toBe(401);
  expect(
    (
      await fetch(url, {
        headers: { "x-kernel-test-principal": `other:${ORG}` },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await fetch(url, {
        headers: { "x-kernel-test-principal": `${OWNER}:org-upload-foreign` },
      })
    ).status,
  ).toBe(404);
  const foreignRows = await db.withTenant(toOrgId("org-upload-foreign"), (s) =>
    s.query("SELECT id FROM survey_attachments"),
  );
  expect(foreignRows.rows).toEqual([]);
  const content = await fetch(url, { headers });
  expect(content.status).toBe(200);
  expect(Buffer.from(await content.arrayBuffer())).toEqual(png());
  const del = await fetch(
    `${base}/public/surveys/${token}/upload-sessions/${a}/questions/f/attachments/${file.attachmentId}`,
    { method: "DELETE", headers: publicHeaders() },
  );
  expect(del.status).toBe(404);
});
it("deletion permits replacement and real expiry cleanup removes objects", async () => {
  const a = await session("delete-test");
  const r = await upload(a, "sig");
  expect(r.status).toBe(201);
  const file = (await r.json()) as { attachmentId: string };
  expect((await upload(a, "sig")).status).toBe(413);
  const url = `${base}/public/surveys/${token}/upload-sessions/${a}/questions/sig/attachments/${file.attachmentId}`;
  expect(
    (await fetch(url, { method: "DELETE", headers: publicHeaders() })).status,
  ).toBe(200);
  expect((await upload(a, "sig")).status).toBe(201);
  const service = app.get<SurveyAttachmentService>(SURVEY_ATTACHMENT_SERVICE);
  expect(await service.cleanup(toOrgId(ORG))).toBeGreaterThan(0);
  expect(
    await app
      .get<ObjectStore>(OBJECT_STORE)
      .get(`survey-attachments/${file.attachmentId}`),
  ).toBeNull();
});
it("HTTP submit claims once and identical retry preserves receipt; foreign question/session and reused attachments fail", async () => {
  const a = await session("http-submit");
  const r = await upload(a);
  expect(r.status).toBe(201);
  const { attachmentId } = (await r.json()) as { attachmentId: string };
  const body = {
    submissionId: "http-submit",
    uploadSessionToken: a,
    answers: [{ questionId: "f", value: [attachmentId] }],
  };
  const submit = (b: unknown) =>
    fetch(`${base}/public/surveys/${token}/responses`, {
      method: "POST",
      headers: { ...publicHeaders(), "content-type": "application/json" },
      body: JSON.stringify(b),
    });
  expect(
    (
      await submit({
        ...body,
        answers: [{ questionId: "sig", value: [attachmentId] }],
      })
    ).status,
  ).toBe(400);
  expect(
    (await submit({ ...body, uploadSessionToken: await session("foreign-id") }))
      .status,
  ).toBe(400);
  const first = await submit(body);
  expect(first.status).toBe(201);
  const receipt = (await first.json()) as { responseId: string };
  const retry = await submit(body);
  expect(retry.status).toBe(201);
  expect(await retry.json()).toEqual({ ...receipt, replayed: true });
  expect((await submit({ ...body, submissionId: "different-id" })).status).toBe(
    400,
  );
  const content = await fetch(
    `${base}/surveys/${surveyId}/responses/${receipt.responseId}/attachments/${attachmentId}/content`,
    { headers },
  );
  expect(content.status).toBe(200);
});
it("expired upload session cannot claim or upload and cleanup preserves claimed objects", async () => {
  const a = await session("expired-session");
  const r = await upload(a);
  expect(r.status).toBe(201);
  const { attachmentId } = (await r.json()) as { attachmentId: string };
  const db = app.get<DatabasePort>(DATABASE_PORT);
  await db.withTenant(toOrgId(ORG), async (s) => {
    await s.query(
      `UPDATE survey_upload_sessions SET expires_at=now()-interval '1 minute' WHERE org_id=$1 AND submission_id='expired-session'`,
      [ORG],
    );
    await s.query(
      `UPDATE survey_attachments SET expires_at=now()-interval '1 minute' WHERE org_id=$1 AND id=$2`,
      [ORG, attachmentId],
    );
  });
  expect((await upload(a)).status).toBe(404);
  await expect(
    db.withTenant(toOrgId(ORG), (s) =>
      claimSurveyAttachments(s, {
        orgId: toOrgId(ORG),
        surveyId,
        publicationVersion: 1,
        submissionId: "expired-session",
        uploadSessionToken: a,
        responseId: "never",
        references: [{ questionId: "f", attachmentIds: [attachmentId] }],
      }),
    ),
  ).rejects.toThrow();
  expect(
    await app
      .get<SurveyAttachmentService>(SURVEY_ATTACHMENT_SERVICE)
      .cleanup(toOrgId(ORG)),
  ).toBeGreaterThan(0);
  expect(
    await app
      .get<ObjectStore>(OBJECT_STORE)
      .get(`survey-attachments/${attachmentId}`),
  ).toBeNull();
});
it("invalid capability refused before multipart parsing and closed publication refuses upload", async () => {
  expect((await upload("wrong")).status).toBe(404);
  const a = await session("closed-test");
  await app
    .get<DatabasePort>(DATABASE_PORT)
    .withTenant(toOrgId(ORG), (s) =>
      s.query(
        `UPDATE survey_workspaces SET document=jsonb_set(document,'{model,publication,status}','"closed"') WHERE org_id=$1 AND id=$2`,
        [ORG, surveyId],
      ),
    );
  expect((await upload(a)).status).toBe(410);
});

it("deleting a survey queues claimed objects for physical cleanup without touching a live survey", async () => {
  const db = app.get<DatabasePort>(DATABASE_PORT),
    store = app.get<ObjectStore>(OBJECT_STORE);
  const preservedId = "11111111-1111-4111-8111-111111111111",
    preservedKey = `survey-attachments/${preservedId}`,
    liveSurvey = "live-upload-survey";
  await store.putOnce(preservedKey, png(), "image/png");
  const ids = await db.withTenant(toOrgId(ORG), async (tx) => {
    await tx.query(
      `INSERT INTO survey_workspaces(org_id,id,owner_id,document) SELECT org_id,$3,owner_id,jsonb_set(document,'{model,id}',to_jsonb($3::text)) FROM survey_workspaces WHERE org_id=$1 AND id=$2`,
      [ORG, surveyId, liveSurvey],
    );
    await tx.query(
      `INSERT INTO survey_upload_sessions(org_id,survey_id,token_hash,submission_id,publication_version,expires_at,response_id) VALUES($1,$2,'preserved-session','preserved-submit',1,now()+interval '1 day','preserved-response')`,
      [ORG, liveSurvey],
    );
    await tx.query(
      `INSERT INTO survey_attachments(org_id,id,survey_id,session_hash,question_id,object_key,name,mime,size_bytes,sha256,status,expires_at,response_id) VALUES($1,$2,$3,'preserved-session','f',$4,'preserved.png','image/png',$5,'test-hash','claimed',now()-interval '1 day','preserved-response')`,
      [ORG, preservedId, liveSurvey, preservedKey, png().length],
    );
    return (
      await tx.query<{ id: string; object_key: string }>(
        `SELECT id,object_key FROM survey_attachments WHERE org_id=$1 AND survey_id=$2 AND status='claimed'`,
        [ORG, surveyId],
      )
    ).rows;
  });
  expect(ids.length).toBeGreaterThan(0);
  expect(
    (
      await fetch(`${base}/surveys/${surveyId}?expectedVersion=1`, {
        method: "DELETE",
        headers: { "x-kernel-test-principal": `other:${ORG}` },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await fetch(`${base}/surveys/${surveyId}?expectedVersion=99`, {
        method: "DELETE",
        headers,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await fetch(`${base}/surveys/${surveyId}?expectedVersion=1`, {
        method: "DELETE",
        headers,
      })
    ).status,
  ).toBe(200);
  const remaining = await db.withTenant(toOrgId(ORG), (tx) =>
    tx.query<{ status: string }>(
      `SELECT status FROM survey_attachments WHERE org_id=$1 AND survey_id=$2`,
      [ORG, surveyId],
    ),
  );
  expect(remaining.rows.length).toBeGreaterThan(0);
  expect(remaining.rows.every((row) => row.status === "deleted")).toBe(true);
  await app
    .get<SurveyAttachmentService>(SURVEY_ATTACHMENT_SERVICE)
    .cleanup(toOrgId(ORG));
  for (const row of ids) expect(await store.get(row.object_key)).toBeNull();
  const sessions = await db.withTenant(toOrgId(ORG), (tx) =>
    tx.query(
      "SELECT token_hash FROM survey_upload_sessions WHERE org_id=$1 AND survey_id=$2",
      [ORG, surveyId],
    ),
  );
  expect(sessions.rows).toHaveLength(0);
  expect(Buffer.from((await store.get(preservedKey))!)).toEqual(png());
  expect(
    (
      await fetch(
        `${base}/surveys/${liveSurvey}/responses/preserved-response/attachments/${preservedId}/content`,
        { headers },
      )
    ).status,
  ).toBe(200);
});
