import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { files } from "@repo/contracts";
import { operations } from "@repo/contracts/aidt-stages";
import { AidtResearchMaterial, aidtResearchContentPath, parseAidtResearchMaterial } from "../../features/aidt/lib/aidt-research-materials";
import { apiPath } from "./real-model-api";
import { aidtV2Api, aidtV2Bytes, copySaveInput, readAidtV2Stage, saveAidtV2Stage } from "./aidt-v2-acceptance";
import { observeAidtNativePrint, readAidtNativePrints } from "./aidt-v2-print-observation";

const fixtures = () => resolve(process.env.AIDT_V2_FIXTURE_DIR ?? "e2e/fixtures/aidt-v2");
async function upload(page: Page, projectId: string, label: string, filename: string) {
  const control = page.getByTestId("aidt-research-material-control").and(page.locator(`[aria-label="${label}"]`));
  await control.getByLabel(`${label}选择文件`, { exact: true }).setInputFiles(join(fixtures(), filename));
  const response = page.waitForResponse(value => value.request().method() === "POST"
    && new URL(value.url()).pathname === apiPath(files.operations.uploadArtifact.path.replace(":projectId", projectId)));
  await control.getByRole("button", { name: "保存原始材料", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(control.getByRole("status")).toContainText("原件已保存并回读，已加入草稿");
}
export async function addCompletionResearch(page: Page, projectId: string) {
  const baseline = (await readAidtV2Stage(page, projectId, 2))!;
  const persisted = Object.values(baseline.content.draft.fields).map(parseAidtResearchMaterial).filter(value => value !== null);
  const existing = ["SYN-A.txt", "SYN-A.png"].map(name => persisted.find(reference => reference.name === name
    && reference.projectId === projectId && reference.sha256 === createHash("sha256").update(readFileSync(join(fixtures(), name))).digest("hex")));
  if (existing.every(Boolean)) {
    const control = page.getByTestId("aidt-research-material-control").and(page.locator('[aria-label="研究原始材料"]'));
    await control.getByRole("button", { name: "选择本组已保存原始材料", exact: true }).click();
    for (const name of ["SYN-A.txt", "SYN-A.png"]) await expect(control.getByRole("button", { name: `关联原始材料：${name}`, exact: true })).toBeVisible();
    await test.info().attach("s2-reused-persisted-originals-after-unsent-qa", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      projectId, originalStageRevision: baseline.revision, references: existing, filesReposted: false, fieldsRewritten: false,
    }, null, 2)) });
  } else {
  if (process.env.AIDT_V2_RESUME_UNSENT_S2 === "approved-s2-upload-status-201") {
    let control = page.getByTestId("aidt-research-material-control").and(page.locator('[aria-label="研究原始材料"]'));
    await control.getByRole("button", { name: "选择本组已保存原始材料", exact: true }).click();
    const choice = control.getByRole("button", { name: "关联原始材料：SYN-A.txt", exact: true });
    const noSaved = control.getByText("尚无已保存的阶段原始材料引用。新上传先关联草稿，再保存本步成果。", { exact: true });
    await expect.poll(async () => await choice.count() > 0 || await noSaved.isVisible()).toBe(true);
    let apiRecovery = false;
    if (!await choice.count()) {
      await expect(noSaved).toBeVisible();
      const proof = JSON.parse(readFileSync(process.env.AIDT_V2_UNSENT_S2_PROOF!, "utf8")) as { projectId: string; rawRuns: {
        ingestion_run_id: string; artifact_id: string; artifact_version_id: string; sha256: string; size_bytes: string; created_by: string; created_at: string;
      }[] };
      expect(proof.projectId).toBe(projectId); expect(proof.rawRuns).toHaveLength(1); const receipt = proof.rawRuns[0]!;
      const original = readFileSync(join(fixtures(), "SYN-A.txt"));
      const response = await aidtV2Bytes(page, aidtResearchContentPath({ projectId, runId: receipt.ingestion_run_id }));
      expect(response.status).toBe(200); expect(Buffer.from(response.base64, "base64")).toEqual(original);
      const hash = createHash("sha256").update(original).digest("hex"); expect(hash).toBe(receipt.sha256); expect(original.length).toBe(Number(receipt.size_bytes));
      const { "content-type": contentType, ...sourceHeaders } = response.headers;
      const [mime, ...parameters] = contentType!.split(";"); expect(mime!.trim().toLowerCase()).toBe("text/plain");
      for (const parameter of parameters) expect(parameter.trim()).toMatch(/^charset=(?:[A-Za-z0-9._-]+|"[A-Za-z0-9._-]+")$/i);
      expect(parameters.length).toBeLessThanOrEqual(1);
      expect(sourceHeaders).toEqual({ "x-content-sha256": hash, "x-artifact-id": receipt.artifact_id,
        "x-artifact-version-id": receipt.artifact_version_id, "x-upload-submitted-by": receipt.created_by, "x-upload-submitted-at": receipt.created_at });
      const reference = AidtResearchMaterial.parse({ projectId, runId: receipt.ingestion_run_id, artifactId: receipt.artifact_id, versionId: receipt.artifact_version_id,
        name: "SYN-A.txt", mime: response.headers["content-type"]!.split(";")[0], sha256: hash, bytes: original.length, submittedBy: receipt.created_by, submittedAt: receipt.created_at });
      const prior = (await readAidtV2Stage(page, projectId, 2))!;
      const input = copySaveInput(prior, { [`researchFile:${randomUUID()}`]: JSON.stringify(reference) });
      const write = await aidtV2Api(page, `/projects/${projectId}/aidt/stages/2`, "PUT", input); expect(write.status).toBe(200);
      const persisted = operations.save.out.parse(write.data).stage; expect(persisted.revision).toBe(prior.revision + 1);
      expect(await readAidtV2Stage(page, projectId, 2)).toEqual(persisted); apiRecovery = true;
      await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByTestId("aidt-shared-reload")).toBeEnabled();
      control = page.getByTestId("aidt-research-material-control").and(page.locator('[aria-label="研究原始材料"]'));
      await control.getByRole("button", { name: "选择本组已保存原始材料", exact: true }).click();
      await test.info().attach("s2-reviewed-unsent-upload-recovery", { contentType: "application/json", body: Buffer.from(JSON.stringify({
        authorization: "approved-s2-upload-status-201", priorAttempt: "s2-attempt-01", projectId, reference, recoveryViaNormalStageApi: true,
        actualBytesAndAllSixHeadersVerified: true, textReposted: false, fullUiUploadRecoveryProven: false,
      }, null, 2)) });
    }
    await control.getByRole("button", { name: "关联原始材料：SYN-A.txt", exact: true }).click();
    await expect(control.getByRole("status")).toContainText("原件已保存并回读，已加入草稿");
    if (!apiRecovery) await test.info().attach("s2-existing-original-ui-recovery", { contentType: "application/json", body: Buffer.from(JSON.stringify({ projectId, usedExistingStageReference: true, textReposted: false })) });
  } else await upload(page, projectId, "研究原始材料", "SYN-A.txt");
  await upload(page, projectId, "研究原始材料", "SYN-A.png");
  }
  const originals = await page.getByTestId("aidt-shared-save").isEnabled() ? await saveAidtV2Stage(page, projectId, 2) : (await readAidtV2Stage(page, projectId, 2))!;
  if (!originals.content.draft.discoveryCards?.length) await page.getByTestId("aidt-discovery-add").click();
  else expect(originals.content.draft.discoveryCards).toHaveLength(1);
  await page.getByLabel("发现卡1受访者代号", { exact: true }).fill("模拟角色-A");
  await page.getByLabel("发现卡1一句发现", { exact: true }).fill("学生概括：模拟角色先找牌子，不能代表真实人群。");
  const evidence = page.getByTestId("aidt-discovery-card").first().getByTestId("aidt-discovery-evidence-0");
  if (!await page.getByLabel("发现卡1受访者原话", { exact: true }).isVisible()) await evidence.locator("summary").first().click();
  await page.getByLabel("发现卡1受访者原话", { exact: true }).fill("[模拟原话] 我先找牌子，再看看自己排在哪儿。");
  await page.getByLabel("发现卡1具体情况", { exact: true }).fill("学生解释：也许需要更清楚的分区提示，仍未验证。");
  await page.getByTestId("aidt-discovery-ai-0").fill("AI推测隔离字段的合成夹具：可能存在信息不匹配；不是模型输出或研究事实。");
  for (const [label, name] of [["发现卡1原始文件", "SYN-A.txt"], ["发现卡1原始照片", "SYN-A.png"]]) {
    const control = page.getByTestId("aidt-research-material-control").and(page.locator(`[aria-label="${label}"]`));
    if (!await control.isVisible()) await evidence.locator("summary").first().click();
    await expect(control).toBeVisible();
    await control.getByRole("button", { name: "选择本组已保存原始材料", exact: true }).click();
    await control.getByRole("button", { name: `关联原始材料：${name}`, exact: true }).click();
    await expect(control.getByRole("status")).toContainText("原件已保存并回读，已加入草稿");
  }
  if (!await page.getByLabel("发现卡1原始材料与定位", { exact: true }).isVisible()) await evidence.locator("summary").first().click();
  await page.getByLabel("发现卡1原始材料与定位", { exact: true }).fill("SYN-A.txt 第01段；合成课堂材料，不是真实访谈。");
  const saved = await page.getByTestId("aidt-shared-save").isEnabled() ? await saveAidtV2Stage(page, projectId, 2) : (await readAidtV2Stage(page, projectId, 2))!;
  const card = saved.content.draft.discoveryCards![0]!;
  expect(card.quote).toBe("[模拟原话] 我先找牌子，再看看自己排在哪儿。");
  expect(parseAidtResearchMaterial(saved.content.draft.fields[`discoveryFile:${card.id}`])?.sha256).toBe(createHash("sha256").update(readFileSync(join(fixtures(), "SYN-A.txt"))).digest("hex"));
  expect(parseAidtResearchMaterial(saved.content.draft.fields[`discoveryPhoto:${card.id}`])?.sha256).toBe(createHash("sha256").update(readFileSync(join(fixtures(), "SYN-A.png"))).digest("hex"));
  for (const reference of Object.values(originals.content.draft.fields).map(parseAidtResearchMaterial).filter(value => value !== null)) {
    const bytes = await aidtV2Bytes(page, aidtResearchContentPath(reference));
    const expected = readFileSync(join(fixtures(), reference.name));
    expect(bytes.status).toBe(200); expect(Buffer.from(bytes.base64, "base64")).toEqual(expected);
    expect(bytes.headers["x-content-sha256"]).toBe(createHash("sha256").update(expected).digest("hex"));
  }
  return saved;
}
export async function addCompletionIdeaImages(page: Page, projectId: string) {
  const filenames = ["I1-分区牌.png", "I2-同伴指路.png", "I3-号码牌.png"];
  for (let i = 0; i < 3; i++) await upload(page, projectId, `候选${i + 1}原始图片`, filenames[i]!);
  const saved = await saveAidtV2Stage(page, projectId, 4);
  for (const [i, idea] of saved.content.draft.ideas.entries()) {
    const ref = parseAidtResearchMaterial(saved.content.draft.fields[`ideaFile:${idea.id}`]);
    expect(ref?.name).toBe(filenames[i]);
    const bytes = await aidtV2Bytes(page, aidtResearchContentPath(ref!));
    expect(bytes.status).toBe(200); expect(Buffer.from(bytes.base64, "base64")).toEqual(readFileSync(join(fixtures(), filenames[i]!)));
  }
  return saved;
}

/** Real product beforeprint documents, then Chromium PDF bytes. Never replace window.print(). */
export async function completionIdeaPdfs(page: Page, context: BrowserContext, projectId: string, info: TestInfo) {
  const before = await readAidtV2Stage(page, projectId, 4); expect(before).not.toBeNull();
  await page.getByRole("checkbox", { name: "本组已比较：这些是不同点子，说明讲清做什么及如何帮助用户。", exact: true }).check();
  await page.getByTestId("aidt-idea-sheets-open").click();
  await expect(page.getByTestId("aidt-idea-sheet")).toHaveCount(3);
  await observeAidtNativePrint(page, true);
  const results = [];
  for (let index = 0; index < 3; index++) {
    await page.getByRole("button", { name: `打印候选 ${index + 1} 描述单 PDF`, exact: true }).click();
    await expect.poll(async () => (await readAidtNativePrints(page)).length).toBe(index + 1);
    const doc = (await readAidtNativePrints(page))[index]!;
    expect(doc.ideaIds).toEqual([before!.content.draft.ideas[index]!.id]); expect(doc.imagesLoaded).toBe(true); expect(doc.printableHtml).toBeTruthy();
    const copy = await context.newPage();
    try {
      await copy.setContent(doc.printableHtml!, { waitUntil: "load" });
      await copy.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(image => image.decode())); });
      const output = info.outputPath(`idea-${index + 1}.pdf`);
      const bytes = await copy.pdf({ path: output, format: "A4", printBackground: true });
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-"); expect(bytes.length).toBeGreaterThan(1_000);
      const text = execFileSync("pdftotext", [output, "-"], { encoding: "utf8" });
      const idea = before!.content.draft.ideas[index]!;
      expect(text.replace(/\s/g, "")).toContain(idea.title.replace(/\s/g, ""));
      expect(text.replace(/\s/g, "")).toContain(idea.description.replace(/\s/g, ""));
      for (const other of before!.content.draft.ideas.filter(item => item.id !== idea.id)) expect(text).not.toContain(other.title);
      await info.attach(`candidate-${index + 1}-actual-pdf`, { path: output, contentType: "application/pdf" });
      results.push({ ideaId: idea.id, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), beforeprint: true, imagesLoaded: doc.imagesLoaded,
        generatedBy: "Chromium Page.pdf from copy of actual product beforeprint DOM", nativeSaveDialogAutomated: false });
    } finally { await copy.close(); }
  }
  expect(await readAidtV2Stage(page, projectId, 4)).toEqual(before);
  return results;
}
