import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { aidtV2Api, assertAidtV2Target, loginAidtV2 } from "./support/aidt-v2-acceptance";
test("read-only Design reply and immutable versions after a failed generation assertion", async ({ page }, info) => {
  test.setTimeout(90_000); assertAidtV2Target();
  const state = JSON.parse(readFileSync(process.env.AIDT_DESIGN_STATE!, "utf8")) as { designId: string };
  const modelPosts: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && /copilotkit|\/pm-designs\/[^/]+\/(?:chat|variants)/u.test(new URL(request.url()).pathname)) modelPosts.push(new URL(request.url()).pathname); });
  await loginAidtV2(page);
  const projects = await aidtV2Api(page, "/pm-designs"), versions = await aidtV2Api(page, `/pm-designs/${state.designId}/versions`);
  expect(projects.status).toBe(200); expect(versions.status).toBe(200);
  const project = (projects.data as { items: { id: string }[] }).items.find(row => row.id === state.designId); expect(project).toBeTruthy();
  expect(modelPosts).toEqual([]);
  await info.attach("actual-design-reply-and-versions-readonly", { contentType: "application/json", body: Buffer.from(JSON.stringify({ project, versions: versions.data, modelPosts }, null, 2)) });
});
