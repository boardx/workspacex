import { readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { skills, wave2Runtime } from "@repo/contracts";
import { SESSION_STORAGE_KEY } from "../components/session/session-provider";
import { aidtV2Api, assertAidtV2Target, loginAidtV2 } from "./support/aidt-v2-acceptance";
import { isAidtRemediation } from "./support/aidt-v2-remediation-criteria";

/** Existing administrator import lifecycle only; no default-agent, role, wallet or model changes. */
test("remediation free setup: import the exact shipped teaching packs and record real pins", async ({ page }, info) => {
  test.setTimeout(120_000); assertAidtV2Target(); expect(isAidtRemediation()).toBe(true);
  const methodsVersion = process.env.AIDT_V2_METHODS_VERSION ?? "1.3.1";
  expect(["1.3.1", "1.3.2"]).toContain(methodsVersion);
  const summaryOnly = process.env.AIDT_V2_SUMMARY_ONLY_SETUP === "1";
  const summaryVersion = process.env.AIDT_V2_SUMMARY_VERSION ?? "1.0.1";
  expect(["1.0.1", "1.0.2"]).toContain(summaryVersion);
  expect(process.env.AIDT_V2_FREE_SETUP).toBe(summaryOnly ? "approved-summary-1.0.2-retain-methods-1.3.2" : `approved-methods-${methodsVersion}-summary-1.0.1`);
  const resultFile = process.env.AIDT_V2_SETUP_RESULT!; expect(isAbsolute(resultFile)).toBe(true);
  const generations: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && /copilotkit|\/pm-designs\/[^/]+\/(?:chat|variants)|\/agent-runs\/[^/]+\/(?:decision|resume|execute)/u.test(new URL(request.url()).pathname)) generations.push(new URL(request.url()).pathname); });
  await loginAidtV2(page);
  const session = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null") as { currentOrgId: string; userId: string }, SESSION_STORAGE_KEY);
  expect(session.currentOrgId).toBeTruthy();
  const imported: ReturnType<typeof wave2Runtime.operations.importSkillStarterPack.out.parse>[] = [];
  const retained: { previousSetup: string; previousSetupSha256: string; importId: string }[] = [];
  const previousSetup = process.env.AIDT_V2_PREVIOUS_SETUP_RESULT;
  if (methodsVersion === "1.3.2") {
    expect(previousSetup && isAbsolute(previousSetup)).toBe(true);
    const previousBytes = readFileSync(previousSetup!);
    const previous = JSON.parse(previousBytes.toString()) as { orgId: string; imported: unknown[] };
    expect(previous.orgId).toBe(session.currentOrgId);
    const retainedId = summaryOnly ? "aidt-methods" : "aidt-project-summary", retainedVersion = summaryOnly ? "1.3.2" : "1.0.1";
    const summary = previous.imported.map(row => wave2Runtime.operations.importSkillStarterPack.out.parse(row)).find(row => row.packId === retainedId && row.packVersion === retainedVersion);
    expect(summary).toBeTruthy();
    const shipped = wave2Runtime.SkillStarterPack.parse(JSON.parse(readFileSync(resolve("../../skills/starter-packs", retainedId, `${retainedVersion}.json`), "utf8")));
    expect(summary!.packDigest).toBe(shipped.packDigest); imported.push(summary!);
    retained.push({ previousSetup: previousSetup!, previousSetupSha256: createHash("sha256").update(previousBytes).digest("hex"), importId: summary!.importId });
  }
  const requested = summaryOnly ? [["aidt-project-summary", summaryVersion]] : [["aidt-methods", methodsVersion], ...(methodsVersion === "1.3.1" ? [["aidt-project-summary", "1.0.1"]] : [])];
  for (const [packId, packVersion] of requested) {
    const shipped = wave2Runtime.SkillStarterPack.parse(JSON.parse(readFileSync(resolve("../../skills/starter-packs", packId!, `${packVersion}.json`), "utf8")));
    const input = wave2Runtime.operations.importSkillStarterPack.in.parse({ packId, packVersion, idempotencyKey: randomUUID(), expectedOrgId: session.currentOrgId });
    await info.attach(`exact-import-request-${packId}`, { contentType: "application/json", body: Buffer.from(JSON.stringify(input, null, 2)) });
    const response = await aidtV2Api(page, wave2Runtime.operations.importSkillStarterPack.path, "POST", input);
    expect(response.status).toBe(201);
    const result = wave2Runtime.operations.importSkillStarterPack.out.parse(response.data);
    expect(result).toMatchObject({ packId, packVersion, packDigest: shipped.packDigest, status: "succeeded" });
    expect(result.versionIds).toHaveLength(shipped.skills.length); imported.push(result);
    await info.attach(`exact-pack-${packId}`, { contentType: "application/json", body: Buffer.from(JSON.stringify(result, null, 2)) });
  }
  const catalogueResponse = await aidtV2Api(page, `${skills.operations.listSkills.path}?orgId=${encodeURIComponent(session.currentOrgId)}&entry=library`);
  expect(catalogueResponse.status).toBe(200);
  const catalogue = skills.operations.listSkills.out.parse(catalogueResponse.data);
  const pins = Object.fromEntries(catalogue.items.filter(item => item.platformStableName?.startsWith("aidt-") || item.platformStableName === "dt-summarize-project")
    .map(item => { expect(item.currentVersionId).toBeTruthy(); return [item.platformStableName!, item.currentVersionId!]; }));
  expect(Object.keys(pins)).toHaveLength(7);
  expect(generations).toEqual([]);
  for (const versionId of Object.values(pins)) expect(imported.flatMap(row => row.versionIds)).toContain(versionId);
  const evidence = { schemaVersion: 1, methodsVersion, summaryVersion, retained, realImportPostCount: requested.length, orgId: session.currentOrgId, actorId: session.userId, imported, pins, generations, defaultsRolesAndWalletsChanged: false,
    realModelRequests: 0, independentOwnerByteVerification: "required-before-native-send" };
  writeFileSync(resultFile, JSON.stringify(evidence, null, 2), { flag: "wx", mode: 0o600 });
  await info.attach("free-setup-real-import-pins", { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence, null, 2)) });
});
