import { beforeAll, afterAll, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDigitalInterviewRepository } from "../../src/infrastructure/interview/pg-digital-interview-repository";
import { appendInterviewMarkdownDocument } from "../../src/infrastructure/interview/interview-markdown-store";
import { toOrgId } from "../../src/domain/org-id";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg, addOrgMember } from "../support/db";
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const ORG = toOrgId("org-md-report-review-4483");
const OTHER = toOrgId("org-md-report-review-4483-other");
const USER = "md-report-review-owner";
const ID = "md-review-interview";
const REV = "md-review-revision";
const MARKDOWN = "# 报告\r\n\r\n模拟回答，待真人验证。🧪\r\n";
let db: PgDatabase;
let app: NestExpressApplication;
let base: string;
let document: { documentId: string; version: number; contentHash: string };
const auth = (user = USER, org = ORG) => ({ "x-kernel-test-principal": `${user}:${org}`, "content-type": "application/json" });
const path = () => `${base}/interviews/digital/${ID}/markdown/report/review`;
const body = (status: "approved" | "changes_requested", requestId: string, expectedVersion: number) => ({ revisionId: REV,
  documentId: document.documentId, documentVersion: document.version, contentHash: document.contentHash,
  status, note: "需要更多真人反例", expectedVersion, requestId });

beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig());
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: "proj-md-review" });
  await seedOrg({ orgId: OTHER, projectId: "proj-md-review-other" });
  await addOrgMember(ORG, USER, "consultant", null);
  await addOrgMember(ORG, "md-review-outsider", "consultant", null);
  await addOrgMember(OTHER, USER, "consultant", null);
  await new PgDigitalInterviewRepository(db).createDraft({ orgId: ORG, actorId: USER, interviewId: ID,
    scope: { kind: "none", projectId: null, researchProjectId: null }, name: "版本复核", topic: "研究", tags: [] });
  await db.withTenant(ORG, async (s) => {
    await s.query("INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,$2,$3,1,$4)", [ORG, REV, ID, USER]);
    document = await appendInterviewMarkdownDocument(s, { orgId: ORG, interviewId: ID, revisionId: REV, step: "report", title: "报告", markdown: MARKDOWN,
      evidenceMode: "simulated", references: [], expectedVersion: 0, status: "confirmed" });
  });
  const { createApp } = await import("../../src/main"); app = await createApp(); await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address(); base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 120000);
afterAll(async () => { await app?.close(); await resetOrgs(ORG, OTHER); await db?.close(); });

it("persists version-bound human request-changes metadata without mutating the report body", async () => {
  const input = body("changes_requested", "review-request-one", 1);
  const response = await fetch(path(), { method: "POST", headers: auth(), body: JSON.stringify(input) });
  expect(response.status).toBe(201);
  const submitted = await response.json();
  expect(submitted).toMatchObject({ version: 2, review: { revisionId: REV, documentId: document.documentId, documentVersion: 1,
    contentHash: document.contentHash, status: "changes_requested", note: "需要更多真人反例", reviewedBy: USER } });
  expect(submitted.review.reviewId).toBeTruthy(); expect(submitted.review.reviewedAt).toBeTruthy();
  const replay = await fetch(path(), { method: "POST", headers: auth(), body: JSON.stringify(input) });
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(submitted);
  const reuse = await fetch(path(), { method: "POST", headers: auth(), body: JSON.stringify({ ...input, note: "覆盖已有意见" }) });
  expect(reuse.status).toBe(409);
  const read = await (await fetch(`${base}/interviews/digital/${ID}/markdown`, { headers: auth() })).json();
  expect(read.review).toEqual(submitted.review);
  const facts = await db.withTenant(ORG, async (s) => ({
    report: (await s.query("SELECT markdown,content_hash,status FROM digital_interview_artifact_versions WHERE org_id=$1 AND artifact_id=$2", [ORG, document.documentId])).rows[0],
    version: (await s.query<{ version: string }>("SELECT version FROM interview_sessions WHERE org_id=$1 AND id=$2", [ORG, ID])).rows[0]?.version,
    legacyReports: (await s.query<{ count: string }>("SELECT count(*)::text AS count FROM digital_interview_reports WHERE org_id=$1 AND interview_id=$2", [ORG, ID])).rows[0]?.count,
  }));
  expect(facts).toEqual({ report: { markdown: MARKDOWN, content_hash: document.contentHash, status: "confirmed" }, version: "2", legacyReports: "0" });
});

it("blocks simulated approval, forged review binding, stale aggregate writes and unauthorized actors", async () => {
  const approve = body("approved", "review-approval-simulated", 2);
  const blocked = await fetch(path(), { method: "POST", headers: auth(), body: JSON.stringify(approve) });
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toMatchObject({ reasonCode: "REPORT_REVIEW_BLOCKED" });
  const denied = await fetch(path(), { method: "POST", headers: auth("md-review-outsider"), body: JSON.stringify(approve) });
  expect(denied.status).toBe(404);
  expect(await denied.json()).toMatchObject({ error: "not_found" });
  expect((await fetch(path(), { method: "POST", headers: auth(USER, OTHER), body: JSON.stringify(approve) })).status).toBe(404);
  expect((await fetch(path(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(approve) })).status).toBe(401);
  const stale = body("changes_requested", "review-stale", 1);
  expect((await fetch(path(), { method: "POST", headers: auth(), body: JSON.stringify(stale) })).status).toBe(409);
  expect((await fetch(path(), { method: "POST", headers: auth(), body: JSON.stringify({ ...stale, expectedVersion: 2, contentHash: "b".repeat(64) }) })).status).toBe(409);
  const rows = await db.withTenant(ORG, (s) => s.query("SELECT status FROM interview_markdown_report_reviews WHERE org_id=$1 AND interview_id=$2", [ORG, ID]));
  expect(rows.rows).toEqual([{ status: "changes_requested" }]);
});

it("does not carry approval or a past review forward when a new canonical report version is saved", async () => {
  await db.withTenant(ORG, (s) => appendInterviewMarkdownDocument(s, { orgId: ORG, interviewId: ID, revisionId: REV, step: "report", title: "更新报告",
    markdown: "# 报告\n\n新的正文，尚未复核。", evidenceMode: "simulated", references: [], expectedVersion: 1, status: "draft" }));
  const read = await (await fetch(`${base}/interviews/digital/${ID}/markdown`, { headers: auth() })).json();
  expect(read.review).toBeNull();
  expect((await fetch(path(), { method: "POST", headers: auth(), body: JSON.stringify(body("changes_requested", "review-old-doc", 2)) })).status).toBe(409);
});
