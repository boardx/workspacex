import { describe, expect, it } from "vitest";
import { SurveyService, SurveyError, type SurveyRepository, type SurveyRecord } from "../../src/application/survey/survey-service";
import { toOrgId } from "../../src/domain/org-id";
import { SurveyPublishInputSchema, type SurveyDraftInput, type SurveySubmissionInput } from "@repo/contracts/survey-runtime";
const org = toOrgId("org-schedule");
const nowIso = "2026-10-03T00:00:00.000Z";
const start = "2026-10-04T00:00:00.000Z";
const end = "2026-10-05T00:00:00.000Z";
const draft: SurveyDraftInput = { title: "时间窗口", questions: [{ id: "q1", order: 1, chapterId: "general", title: "您的建议是什么？", type: "short", required: false, options: [] }], template: { id: "optional", title: "可选报告", sections: [] } };
const answer: SurveySubmissionInput = { submissionId: "schedule-answer-1", answers: [{ questionId: "q1", value: "建议" }], durationSeconds: 2, role: "未填写", companySize: "未填写" };
function setup() {
 const rows = new Map<string, SurveyRecord>(); let now = new Date(nowIso);
 const repo: SurveyRepository = {
  async list(o, owner) { return [...rows.entries()].filter(([key, row]) => key.startsWith(o + ":") && row.ownerId === owner).map(([, row]) => structuredClone(row.model)); },
  async create(o, row) { rows.set(o + ":" + row.model.id, structuredClone(row)); },
  async transact(o, id, work) { const key = o + ":" + id; const row = rows.get(key); if (!row) throw new SurveyError("not_found"); const copy = structuredClone(row); const result = work(copy); rows.set(key, copy); return structuredClone(result); },
  async delete(o, id) { rows.delete(o + ":" + id); },
 };
 return { service: new SurveyService(repo, () => now), rows, at: (iso: string) => { now = new Date(iso); } };
}
describe("survey collection schedule", () => {
 it("retains optional startsAt in the command schema and rejects reversed or empty windows", () => {
  expect(SurveyPublishInputSchema.parse({ expectedVersion: 1, startsAt: start, expiresAt: end })).toMatchObject({ startsAt: start, expiresAt: end });
  expect(SurveyPublishInputSchema.safeParse({ expectedVersion: 1, startsAt: start, expiresAt: start }).success).toBe(false);
  expect(SurveyPublishInputSchema.safeParse({ expectedVersion: 1, startsAt: end, expiresAt: start }).success).toBe(false);
 });
 it("persists selected start and end on publication and immutable batch", async () => {
  const { service } = setup(); const created = await service.create(org, "owner", draft);
  const published = await service.publish(org, "owner", created.id, created.version, end, start);
  expect(published.publication).toMatchObject({ startsAt: start, expiresAt: end });
  expect(published.collectionBatches?.[0]).toMatchObject({ startsAt: start, expiresAt: end });
 });
 it.each(["publicGet", "open", "submit"] as const)("rejects %s before selected start without accepting a response", async method => {
  const { service } = setup(); const created = await service.create(org, "owner", draft); const published = await service.publish(org, "owner", created.id, created.version, end, start); const token = published.publication!.token;
  const result = method === "publicGet" ? service.publicGet(token) : method === "open" ? service.openPublic(token) : service.submit(token, answer);
  await expect(result).rejects.toThrow("not_started"); expect((await service.get(org, "owner", created.id)).responses).toHaveLength(0);
 });
 it("allows the exact start instant and rejects the exact expiry instant", async () => {
  const { service, at } = setup(); const created = await service.create(org, "owner", draft); const published = await service.publish(org, "owner", created.id, created.version, end, start); const token = published.publication!.token;
  at(start); expect((await service.publicGet(token)).id).toBe(created.id); await expect(service.openPublic(token)).resolves.toBeDefined(); await expect(service.submit(token, answer)).resolves.toMatchObject({ replayed: false });
  at(end); await expect(service.publicGet(token)).rejects.toThrow("expired"); await expect(service.openPublic(token)).rejects.toThrow("expired"); await expect(service.submit(token, { ...answer, submissionId: "schedule-answer-2" })).rejects.toThrow("expired");
 });
 it("rejects invalid windows in the service even when bypassing command parsing", async () => {
  const { service } = setup(); const created = await service.create(org, "owner", draft);
  await expect(service.publish(org, "owner", created.id, created.version, start, end)).rejects.toThrow("invalid_collection_window");
  expect((await service.get(org, "owner", created.id)).publication).toBeNull();
 });
 it("applies the same selected window to a prepared ready survey", async () => {
  const { service } = setup(); const created = await service.create(org, "owner", draft);
  const ready = await service.prepare(org, "owner", created.id, created.version);
  const collected = await service.startCollection(org, "owner", ready.id, ready.version, end, start);
  expect(collected.publication).toMatchObject({ startsAt: start, expiresAt: end });
  await expect(service.openPublic(collected.publication!.token)).rejects.toThrow("not_started");
 });
 it("defaults immediate start and 30 days when no window is selected", async () => {
  const { service } = setup(); const created = await service.create(org, "owner", draft); const published = await service.publish(org, "owner", created.id, created.version);
  expect(published.publication?.startsAt).toBe(nowIso); expect(published.publication?.expiresAt).toBe("2026-11-02T00:00:00.000Z"); await expect(service.publicGet(published.publication!.token)).resolves.toMatchObject({ id: created.id });
 });
 it("defaults expiry to 30 days from selected future start", async () => {
  const { service } = setup(); const created = await service.create(org, "owner", draft); const published = await service.publish(org, "owner", created.id, created.version, undefined, start);
  expect(published.publication?.expiresAt).toBe("2026-11-03T00:00:00.000Z");
 });
 it("starts legacy publications immediately when startsAt is absent", async () => {
  const { service, rows } = setup(); const created = await service.create(org, "owner", draft); const published = await service.publish(org, "owner", created.id, created.version); const record = rows.get(org + ":" + created.id)!;
  delete record.model.publication!.startsAt; for (const batch of record.model.collectionBatches ?? []) delete batch.startsAt;
  await expect(service.publicGet(published.publication!.token)).resolves.toMatchObject({ id: created.id });
 });
 it("freezes each batch window and keeps old batch closed after republish", async () => {
  const { service } = setup(); const created = await service.create(org, "owner", draft); let model = await service.publish(org, "owner", created.id, created.version, end, start); const first = structuredClone(model.collectionBatches![0]!);
  model = await service.close(org, "owner", created.id, model.version); model = await service.republish(org, "owner", created.id, model.version, "2026-10-07T00:00:00.000Z", "2026-10-06T00:00:00.000Z");
  expect(model.collectionBatches?.[0]).toMatchObject({ token: first.token, startsAt: start, expiresAt: end, status: "closed" }); expect(model.collectionBatches?.[1]).toMatchObject({ startsAt: "2026-10-06T00:00:00.000Z", expiresAt: "2026-10-07T00:00:00.000Z" }); await expect(service.publicGet(first.token)).rejects.toThrow("closed");
 });
});
