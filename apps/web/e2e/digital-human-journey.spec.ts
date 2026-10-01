/**
 * Real browser → real API → real PostgreSQL journey. Only the upstream model is
 * the existing fullstack loopback server. This proves orchestration/persistence,
 * never role-response quality. No request interception or fabricated run output.
 * Run in an isolated post-seeded project: official imports mutate shared catalogs.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { agentRole, wave2Runtime } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { submitWorkbenchRun } from "./support/workbench-run-evidence";
import { expectSendNotBlockedOnRun } from "./support/chat-path-coverage";

test.use({ trace: "on", screenshot: "on" });
test.setTimeout(600_000);
const API = "/__fullstack_api";
const ROLES = [
  { ref: "D002", name: "研究与知识分析师", avatar: "dh-02-research-knowledge-analyst" },
  { ref: "D003", name: "产品经理", avatar: "dh-03-product-manager" },
  { ref: "D005", name: "销售代表", avatar: "dh-05-sales-representative" },
  { ref: "D011", name: "设计思维专家", avatar: "dh-11-design-thinking-expert" },
] as const;

type StoredMessage = { id: string; text: string; authorKind: string; agentRunId: string | null };
async function readApi(page: Page, path: string): Promise<unknown> {
  // The token stays inside the page; it is never attached to the evidence report.
  return page.evaluate(async (url) => {
    const token = localStorage.getItem("wsx.sessionToken");
    if (!token) throw new Error("Authenticated browser session required");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Authoritative read failed: HTTP ${response.status}`);
    return response.json();
  }, `${API}${path}`);
}
async function screenshot(page: Page, info: TestInfo, step: string): Promise<void> {
  const path = info.outputPath(`${step}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(step, { path, contentType: "image/png" });
}
async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
}
async function directory(page: Page) {
  return agentRole.operations.listAgentDirectory.out.parse(
    await readApi(page, agentRole.operations.listAgentDirectory.path),
  ).items;
}
async function storedMessages(page: Page, threadId: string): Promise<StoredMessage[]> {
  const result = await readApi(page, `/chat/threads/${threadId}/messages?limit=100`) as { messages: StoredMessage[] };
  return result.messages;
}

test("official roles: administrator enables dependencies; member runs four independent persisted chats", async ({ page, browser }, info) => {
  await info.attach("verification-boundary", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    upstream: "existing fullstack loopback", browserApiAndDatabase: "real", realModelQuality: "BLOCKED: no model credentials",
    salesWorkflowAndCrm: "excluded by user authorization", roles: ROLES.map(r => r.ref),
  }, null, 2)) });
  await test.step("administrator logs in through the real form", async () => {
    await login(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
    await screenshot(page, info, "01-admin-login");
  });
  const offer = agentRole.operations.getOfficialRolePackOffer.out.parse(
    await readApi(page, agentRole.operations.getOfficialRolePackOffer.path),
  );
  expect(offer.canEnable).toBe(true);
  for (const role of ROLES) expect(offer.pending.some(r => r.roleRef === role.ref), `${role.ref} must start pending`).toBe(true);
  expect(offer.requiredSkillPacks.length).toBeGreaterThan(0);
  const imports: { path: string; packId: string; packVersion: string; status: number }[] = [];
  const observeImports = (response: import("@playwright/test").Response) => {
    const path = new URL(response.url()).pathname.replace(/^\/__fullstack_api/, "");
    if (response.request().method() !== "POST" || !new Set<string>([
      wave2Runtime.operations.importSkillStarterPack.path, wave2Runtime.operations.importAgentStarterPack.path,
    ]).has(path)) return;
    const body = response.request().postDataJSON() as { packId: string; packVersion: string };
    imports.push({ path, packId: body.packId, packVersion: body.packVersion, status: response.status() });
  };
  page.on("response", observeImports);
  await test.step("administrator enables official roles and dependency packs through the UI", async () => {
    await page.goto("/platform-admin/agent");
    await expect(page.getByTestId("admin-agent-catalog")).toBeVisible();
    await page.getByRole("button", { name: "官方数字人", exact: true }).click();
    const modal = page.getByTestId("official-digital-human-modal");
    await expect(modal).toBeVisible();
    await screenshot(page, info, "02-pending-official-roles");
    await modal.getByRole("button", { name: "启用官方数字人", exact: true }).click();
    await expect(modal.getByText("官方数字人已启用。", { exact: true })).toBeVisible({ timeout: 180_000 });
    await screenshot(page, info, "03-enabled-official-roles");
    await page.getByTestId("official-digital-human-modal-close").click();
    await expect(modal).not.toBeVisible();
  });
  page.off("response", observeImports);
  for (const pack of offer.requiredSkillPacks) {
    expect(imports.some(i => i.path === wave2Runtime.operations.importSkillStarterPack.path &&
      i.packId === pack.packId && i.packVersion === pack.packVersion && i.status >= 200 && i.status < 300),
    `Dependency import must really succeed: ${pack.packId}@${pack.packVersion}`).toBe(true);
  }
  const roleImport = imports.findIndex(i => i.path === wave2Runtime.operations.importAgentStarterPack.path);
  expect(roleImport).toBe(offer.requiredSkillPacks.length);
  expect(imports[roleImport]?.status).toBeGreaterThanOrEqual(200);
  expect(imports[roleImport]?.status).toBeLessThan(300);
  const refreshedOffer = agentRole.operations.getOfficialRolePackOffer.out.parse(
    await readApi(page, agentRole.operations.getOfficialRolePackOffer.path),
  );
  expect(refreshedOffer.pending).toHaveLength(0);
  const adminDirectory = await directory(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  for (const role of ROLES) {
    const card = adminDirectory.find(c => c.avatar?.key === role.avatar);
    expect(card?.catalogSource).toBe("official");
    await expect(page.getByTestId("admin-agent-catalog")).toContainText(role.name);
  }
  await screenshot(page, info, "04-admin-directory-after-reload");
  await info.attach("actual-import-receipts", { body: Buffer.from(JSON.stringify(imports, null, 2)), contentType: "application/json" });

  const memberContext = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport });
  // trace:on records this context automatically, including its API requests.
  const member = await memberContext.newPage();
  try {
    await test.step("member logs in and sees the real published directory", async () => {
      await login(member, FULLSTACK_E2E.memberEmail, FULLSTACK_E2E.memberPassword);
      await member.goto("/agent");
      await expect(member.getByTestId("agent-directory")).toBeVisible();
      await screenshot(member, info, "05-member-directory");
    });
    const cards = await directory(member);
    const verified: { roleRef: string; threadId: string; runId: string; resultMessageId: string }[] = [];
    for (const [index, role] of ROLES.entries()) {
      await test.step(`${role.ref}: select, send, persist and restore an independent chat`, async () => {
        const card = cards.find(c => c.avatar?.key === role.avatar && c.catalogSource === "official");
        expect(card, `${role.ref} must be published and member-visible`).toBeDefined();
        const directoryCard = member.getByTestId(`agent-card-${card!.agentId}`);
        await expect(directoryCard).toBeVisible();
        await directoryCard.getByTestId("agent-card-view-detail").click();
        await expect(member.getByTestId("agent-detail-name")).toContainText(role.name);
        await screenshot(member, info, `${index + 6}a-${role.ref}-detail`);
        await member.getByTestId("agent-detail-start-chat").click();
        await expect(member.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
        await expect(member.getByTestId("chat-task-workbench-capability-picker-name")).toContainText(role.name);
        // Exercise the actual New conversation button. The preceding role's
        // successful run leaves no empty draft; authoritative reads prove this
        // UI action creates a distinct empty thread rather than reusing history.
        await member.getByTestId("chat-thread-create").click();
        await member.waitForURL(url => /^\/chat\/[^/]+$/.test(url.pathname));
        const threadId = decodeURIComponent(new URL(member.url()).pathname.split("/").at(-1)!);
        expect(verified.some(r => r.threadId === threadId)).toBe(false);
        expect(await storedMessages(member, threadId)).toHaveLength(0);
        await expect(member.getByTestId("chat-task-workbench-capability-picker-name")).toContainText(role.name);
        await screenshot(member, info, `${index + 6}a-${role.ref}-selected`);
        const prompt = `ROLE-JOURNEY-${role.ref}-${info.workerIndex}: 请说明你能提供哪些帮助。`;
        await member.getByTestId("copilotkit-v2-input").fill(prompt);
        const completed = await submitWorkbenchRun(member);
        const run = wave2Runtime.AgentRunView.parse(await readApi(member, `/agent-runs/${completed.runId}`));
        expect(run).toMatchObject({ status: "succeeded", agentId: card!.agentId,
          agentVersionId: card!.versionId, modelProvider: "dashscope", modelId: "qwen-plus", threadId });
        const messages = await storedMessages(member, threadId);
        const answer = messages.find(m => m.id === completed.resultMessageId && m.authorKind === "agent" && m.agentRunId === run.runId);
        expect(messages.some(m => m.authorKind === "human" && m.text === prompt)).toBe(true);
        expect(answer?.text.trim().length).toBeGreaterThan(0);
        await expect(member.getByTestId("copilotkit-v2-messages")).toContainText(answer!.text);
        await expectSendNotBlockedOnRun(member);
        await screenshot(member, info, `${index + 6}b-${role.ref}-persisted-reply`);
        await member.reload({ waitUntil: "domcontentloaded" });
        await expect(member.getByTestId("copilotkit-v2-messages")).toContainText(answer!.text);
        const restored = await storedMessages(member, threadId);
        expect(restored.filter(m => m.id === answer!.id)).toHaveLength(1);
        expect(restored.find(m => m.id === answer!.id)?.text).toBe(answer!.text);
        await screenshot(member, info, `${index + 6}c-${role.ref}-restored-reply`);
        verified.push({ roleRef: role.ref, threadId, ...completed });
        await member.goto("/agent");
        await expect(member.getByTestId("agent-directory")).toBeVisible();
      });
    }
    await info.attach("persisted-role-runs", { body: Buffer.from(JSON.stringify(verified, null, 2)), contentType: "application/json" });
  } finally {
    await memberContext.close();
  }
});
