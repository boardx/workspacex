/** #3249/#3260: real login, GitHub import, HTTP persistence and browser pin/restore.
 * Requires an isolated local dev-mode stack; no route interception or model execution.
 * For deployment verification supply STUDIO_LOGIN_EMAIL/PASSWORD for a real account.
 */
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { agentRuntime, wave2Runtime, skillFileEdit } from "@repo/contracts";
import { loginAsDevRole } from "./dev-mode-login";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

test.skip(process.env.STUDIO_LANE !== "1", "Explicit STUDIO lane only; this skip is not E2E evidence.");

test("real imported Skill survives multi-file save/reload and Agent pin restoration", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  if (process.env.STUDIO_LOCAL_DEV_MODE === "1") await loginAsDevRole(page, "admin");
  else {
    if (!process.env.STUDIO_LOGIN_EMAIL || !process.env.STUDIO_LOGIN_PASSWORD) throw new Error("real deployment credentials required; no dev-mode fallback");
    await page.goto("/login");
    await page.getByTestId("login-email").fill(process.env.STUDIO_LOGIN_EMAIL);
    await page.getByTestId("login-password").fill(process.env.STUDIO_LOGIN_PASSWORD);
    await page.getByTestId("login-submit").click(); await expect(page).toHaveURL(/\/projects$/);
  }
  const unique = randomUUID();
  const source = process.env.STUDIO_SKILL_SOURCE_URL ?? "https://github.com/anthropics/skills/tree/main/skills/skill-creator";
  await page.goto("/skill?screen=library");
  await page.getByTestId("skill-create-open").click();
  await page.getByTestId("skill-create-mode-import").click();
  const opener = page.getByTestId("skill-url-import-open");
  if (await opener.getAttribute("aria-expanded") !== "true") await opener.click();
  await page.getByTestId("skill-url-import-url").fill(source);
  await page.getByTestId("skill-url-import-name").fill(`studio-live-${unique}`);
  const importedResponse = page.waitForResponse(r => r.request().method() === "POST" && r.url().includes("/admin/skills/url-imports"));
  await page.getByTestId("skill-url-import-confirm").click();
  const importedHttp = await importedResponse;
  expect(importedHttp.status()).toBe(201);
  const imported = wave2Runtime.operations.importSkillFromUrl.out.parse(await importedHttp.json());
  expect(imported.filePaths.length).toBeGreaterThan(1);
  const skillId = imported.skillId;
  await page.goto(`/platform-admin/skill/${encodeURIComponent(skillId)}`);
  await expect(page.getByTestId("skill-multi-file-editor")).toBeVisible();
  await expect(page.getByRole("button", { name: "SKILL.md", exact: true })).toBeVisible();
  const rootBefore = await page.getByRole("textbox", { name: "文件内容", exact: true }).inputValue();
  await page.getByRole("textbox", { name: "文件内容", exact: true }).fill(`${rootBefore}\n\nEdited by ${unique}\n`);
  const path = `references/studio-${unique}.txt`;
  await page.getByLabel("新文件路径").fill(path); await page.getByRole("button", { name: "新建文件", exact: true }).click();
  const canary = `reference-only-${unique}`;
  await page.getByRole("textbox", { name: "文件内容", exact: true }).fill(canary);
  const deletedPath = imported.filePaths.find(name => name !== "SKILL.md");
  expect(deletedPath).toBeTruthy();
  await page.getByRole("button", { name: deletedPath!, exact: true }).click();
  await page.getByRole("checkbox", { name: `确认从下一版本删除 ${deletedPath}` }).check();
  await page.getByRole("button", { name: "删除所选文件", exact: true }).click();
  await page.getByRole("checkbox", { name: "确认统一保存全部修改并发布新版本" }).check();
  const savedResponse = page.waitForResponse(r => r.request().method() === "POST" && r.url().includes(`/admin/skills/${skillId}/file-edits`));
  await page.getByRole("button", { name: "保存全部文件并发布", exact: true }).click();
  const savedHttp = await savedResponse; expect(savedHttp.status()).toBe(201);
  const saved = skillFileEdit.operations.saveSkillFiles.out.parse(await savedHttp.json());
  expect(saved.files.some(f => f.path === deletedPath)).toBe(false);
  expect(saved.files.find(f => f.path === path)?.contentBase64).toBe(Buffer.from(canary).toString("base64"));
  await page.reload(); await expect(page.getByTestId("skill-file-version")).toContainText(saved.versionId);
  await page.getByRole("button", { name: path, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "文件内容", exact: true })).toHaveValue(canary);
  await page.getByRole("button", { name: "SKILL.md", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "文件内容", exact: true })).toHaveValue(`${rootBefore}\n\nEdited by ${unique}\n`);
  // Create a test-owned Agent via the real import/publish API, never a fabricated pin read.
  const token = await page.evaluate(key => localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY); expect(token).toBeTruthy();
  const api = process.env.STUDIO_API_BASE_URL; if (!api) throw new Error("STUDIO_API_BASE_URL is required");
  const headers = { Authorization: `Bearer ${token}` };
  const oldSnapshotResponse = await page.request.get(`${api}/admin/skills/${skillId}/file-snapshot?versionId=${encodeURIComponent(imported.versionId)}`, { headers });
  expect(oldSnapshotResponse.ok()).toBe(true);
  const oldSnapshot = skillFileEdit.operations.getSkillFileSnapshot.out.parse(await oldSnapshotResponse.json());
  expect(oldSnapshot.files.some(file => file.path === deletedPath)).toBe(true);
  expect(oldSnapshot.files.some(file => file.path === path)).toBe(false);
  expect(Buffer.from(oldSnapshot.files.find(file => file.path === "SKILL.md")!.contentBase64, "base64").toString("utf8")).toBe(rootBefore);
  const agentImport = await page.request.post(`${api}/admin/agents/url-imports`, { headers, data: {
    sourceUrl: process.env.STUDIO_AGENT_SOURCE_URL ?? "https://raw.githubusercontent.com/anthropics/skills/main/template/SKILL.md",
    name: `studio-agent-${unique}`, idempotencyKey: unique,
  } });
  expect(agentImport.status()).toBe(201);
  const agent = wave2Runtime.operations.importAgentFromUrl.out.parse(await agentImport.json());
  const published = await page.request.post(`${api}/agents/${agent.agentId}/self-publish`, { headers, data: { agentId: agent.agentId } });
  expect(published.ok()).toBe(true);
  const pinsUrl = `${api}/admin/agents/${agent.agentId}/skill-pins`;
  const baselineHttp = await page.request.get(pinsUrl, { headers }); expect(baselineHttp.ok()).toBe(true);
  const baseline = agentRuntime.operations.getAgentSkillPins.out.parse(await baselineHttp.json()); expect(baseline.pins).toEqual([]);
  await page.getByRole("link", { name: "固定版本到 Agent / 恢复旧绑定" }).click();
  await expect(page).toHaveURL(new RegExp(`/skill/${skillId}/bindings$`));
  await expect(page.getByTestId("pin-target-version")).toContainText(saved.versionId);
  await page.getByLabel("选择 Agent").selectOption(agent.agentId);
  await expect(page.getByTestId("current-agent-pins")).toContainText(baseline.publishedVersionId);
  await page.getByRole("checkbox", { name: /我已核对/ }).check();
  await page.getByRole("button", { name: "固定所示 Skill 版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已固定", { timeout: 30_000 });
  const boundHttp = await page.request.get(pinsUrl, { headers }); expect(boundHttp.ok()).toBe(true);
  const bound = agentRuntime.operations.getAgentSkillPins.out.parse(await boundHttp.json());
  expect(bound.pins).toEqual([{ skillId, versionId: saved.versionId }]);
  expect(bound.publishedVersionId).not.toBe(baseline.publishedVersionId);
  await page.getByRole("checkbox", { name: /我已核对/ }).check();
  await page.getByRole("button", { name: "恢复本页上次 Skill 固定项", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已恢复", { timeout: 30_000 });
  const restoredHttp = await page.request.get(pinsUrl, { headers }); expect(restoredHttp.ok()).toBe(true);
  const restored = agentRuntime.operations.getAgentSkillPins.out.parse(await restoredHttp.json()); expect(restored.pins).toEqual([]);
  expect(restored.publishedVersionId).not.toBe(bound.publishedVersionId);
  await page.reload(); await page.getByLabel("选择 Agent").selectOption(agent.agentId);
  await expect(page.getByTestId("current-agent-pins")).toContainText(restored.publishedVersionId);
  await expect(page.getByTestId("current-agent-pins")).toContainText("当前没有固定项");
  const receipt = { gitHead: process.env.STUDIO_GIT_HEAD ?? null, skillId, source, originalSkillVersion: imported.versionId, savedVersionId: saved.versionId, deletedPath,
    addedPath: path, oldSnapshotPreserved: true, agentId: agent.agentId, originalAgentVersion: baseline.publishedVersionId,
    boundAgentVersion: bound.publishedVersionId, restoredAgentVersion: restored.publishedVersionId, modelExecuted: false };
  const receiptPath = testInfo.outputPath("persistence-receipt.json");
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  await testInfo.attach("real-persistence-receipt", { path: receiptPath, contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath("restored-pins.png"), fullPage: true });
});
