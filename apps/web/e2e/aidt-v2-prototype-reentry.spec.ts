import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { aidtV2Api, assertAidtV2Target, loginAidtV2, openAidtV2Outcome, readAidtV2Stage } from "./support/aidt-v2-acceptance";
import { readAidtQuestionSnapshot } from "../features/aidt/lib/aidt-verification-loop";

test("Design V1 fresh login: exact saved binding, frozen question and actual version remain readable without model calls", async ({ page }, info) => {
  test.setTimeout(90_000); assertAidtV2Target();
  const file = process.env.AIDT_DESIGN_STATE!, bytes = readFileSync(file);
  const state = JSON.parse(bytes.toString()) as { projectId: string; designId: string; v1: { id: string; prototypeSha256: string }; v1Bound: { stage5: unknown; stage6: unknown; snapshotRaw: string } };
  const modelPosts: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && /copilotkit|\/pm-designs\/[^/]+\/(?:chat|variants)|\/agent-runs\/[^/]+\/(?:decision|resume|execute)/u.test(new URL(request.url()).pathname)) modelPosts.push(new URL(request.url()).pathname); });
  await loginAidtV2(page);
  await openAidtV2Outcome(page, state.projectId, 5);
  const saved5 = await readAidtV2Stage(page, state.projectId, 5); expect(saved5).toEqual(state.v1Bound.stage5);
  await expect(page.getByTestId("aidt-shared-status")).toContainText(`V${saved5!.revision}`);
  await openAidtV2Outcome(page, state.projectId, 6);
  const saved6 = await readAidtV2Stage(page, state.projectId, 6); expect(saved6).toEqual(state.v1Bound.stage6);
  expect(saved6!.content.draft.fields.questionSnapshot).toBe(state.v1Bound.snapshotRaw);
  expect(readAidtQuestionSnapshot(saved6!.content.draft)?.prototypeVersionId).toBe(state.v1.id);
  const actual = await aidtV2Api(page, `/pm-designs/${state.designId}/versions/${state.v1.id}`); expect(actual.status).toBe(200);
  expect(actual.data).toMatchObject({ version: { id: state.v1.id, seq: 1, source: "model" } });
  const version = (actual.data as { version: { prototype: unknown } }).version;
  expect(createHash("sha256").update(JSON.stringify(version.prototype)).digest("hex")).toBe(state.v1.prototypeSha256);
  expect(modelPosts).toEqual([]); expect(readFileSync(file)).toEqual(bytes);
  await info.attach("v1-fresh-login-exact-binding", { contentType: "application/json", body: Buffer.from(JSON.stringify({ projectId: state.projectId, versionId: state.v1.id, saved5, saved6, actualPrototypeSha256: state.v1.prototypeSha256, modelPosts, freshLoginExactReadback: true, stateBytesUnchanged: true }, null, 2)) });
});
