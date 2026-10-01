/**
 * Real browser → real API → real PostgreSQL journey. Only the upstream model is
 * the existing fullstack loopback server. This proves orchestration/persistence,
 * never role-response quality. No request interception or fabricated run output.
 * Run in an isolated post-seeded project: official imports mutate shared catalogs.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { agentRole, skills, wave2Runtime } from "@repo/contracts";
import { operations as skillFiles } from "@repo/contracts/skill-file-edit";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { selectWorkbenchAgent, submitWorkbenchRun } from "./support/workbench-run-evidence";
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

// Acceptance expectation is the reviewed role matrix, not the implementation's
// workflow union or organization catalog. Sales CRM execution remains excluded.
const DIRECT_SKILLS: Record<string, readonly string[]> = {
  D002: ["S003", "S063", "S171", "S169", "S172", "S170", "S016", "S020", "S168", "S167"],
  D003: ["S061", "S009", "S064", "S065", "S067", "S068", "S069", "S070", "S071", "S072", "S073", "S074", "S008", "S075"],
  D005: ["S021", "S022", "S023", "S024", "S025", "S026", "S005", "S028", "S029", "S030", "S031", "S032", "S034", "S036"],
  D011: ["S062", "S009", "S064", "S065", "S066", "S071", "S063", "S075", "S018"],
};
type RoleSkillPin = { skillId: string; versionId: string };
type PendingRoleSkill = { stableId: string; stableName: string; contentDigest: string; reason: "awaiting_verification" | "missing_version"; skillId?: string; versionId?: string };
type RoleSkillScope = { pins: RoleSkillPin[]; pending: PendingRoleSkill[] };
async function roleSkillScope(page: Page, agentId: string): Promise<RoleSkillScope> {
  const op = agentRole.operations.getAgentDirectoryProfile;
  const profile = op.out.parse(await readApi(page, op.path.replace(":agentId", encodeURIComponent(agentId))));
  // The new authoritative profile field is required by this regression. The cast
  // only permits test discovery before the coordinated contract change lands;
  // missing fields fail instead of falling back to global skills or draft mounts.
  const { pinnedSkills: pins, pendingSkillBindings: pending } = profile as unknown as { pinnedSkills: RoleSkillPin[]; pendingSkillBindings: PendingRoleSkill[] };
  expect(Array.isArray(pins), "published profile must expose exact skill/version pins").toBe(true);
  expect(Array.isArray(pending), "profile must disclose unverified or missing skill coordinates").toBe(true);
  expect(new Set(pending.map(binding => binding.stableId)).size).toBe(pending.length);
  expect(new Set(pins.map(pin => pin.skillId)).size).toBe(pins.length);
  expect(pins.map(pin => pin.versionId).sort()).toEqual([...profile.pinnedSkillVersionIds].sort());
  return { pins, pending };
}
async function stableSkillRefs(admin: Page, pins: readonly RoleSkillPin[]): Promise<string[]> {
  const refs: string[] = [];
  // Read the actual imported pinned bytes, as administrator. The member cannot
  // use this administrative endpoint and never receives its editing privilege.
  for (const pin of pins) {
    const path = skillFiles.getSkillFileSnapshot.path.replace(":skillId", encodeURIComponent(pin.skillId));
    const snapshot = skillFiles.getSkillFileSnapshot.out.parse(await readApi(admin, `${path}?versionId=${encodeURIComponent(pin.versionId)}`));
    expect(snapshot.skillId).toBe(pin.skillId);
    expect(snapshot.versionId).toBe(pin.versionId);
    const file = snapshot.files.find(file => file.path === "SKILL.md");
    expect(file).toBeDefined();
    const content = Buffer.from(file!.contentBase64, "base64").toString("utf8");
    const stableId = /^\s*stableId:\s*["']?(S\d{3})["']?\s*$/m.exec(content)?.[1];
    expect(stableId, "imported pinned SKILL.md must identify a reviewed work-stack skill").toBeDefined();
    refs.push(stableId!);
  }
  return refs.sort();
}
async function visibleSkillIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid^="chat-skill-mount-option-"]').evaluateAll(options =>
    options.map(option => option.getAttribute("data-testid")!.replace("chat-skill-mount-option-", "")).sort());
}


async function expectRoleSkillOptions(page: Page, scope: RoleSkillScope): Promise<void> {
  await expect.poll(() => visibleSkillIds(page)).toEqual(scope.pins.map(pin => pin.skillId).sort());
  const pendingOptions = page.locator('[data-testid^="chat-skill-pending-"]');
  await expect.poll(() => pendingOptions.evaluateAll(options => options.map(option => option.getAttribute("data-skill-stable-id")).sort()))
    .toEqual(scope.pending.map(binding => binding.stableId).sort());
  for (const pending of scope.pending) {
    const option = page.getByTestId(`chat-skill-pending-${pending.stableName}`);
    await expect(option).toBeDisabled();
    await expect(option).toHaveAttribute("data-skill-stable-id", pending.stableId);
    await expect(option).toHaveAttribute("data-skill-stable-name", pending.stableName);
    await expect(option).toContainText(pending.reason === "awaiting_verification" ? "待验证" : "版本缺失");
  }
  await expect(page.getByTestId("chat-skill-role-counts")).toHaveAttribute("data-available-count", String(scope.pins.length));
  await expect(page.getByTestId("chat-skill-role-counts")).toHaveAttribute("data-pending-count", String(scope.pending.length));
}

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
  const scopesByRole = new Map<string, RoleSkillScope>();
  await test.step("published official role profiles pin only their reviewed direct skills", async () => {
    for (const role of ROLES) {
      const card = adminDirectory.find(card => card.avatar?.key === role.avatar && card.catalogSource === "official");
      expect(card).toBeDefined();
      const scope = await roleSkillScope(page, card!.agentId);
      const verifiedRefs = await stableSkillRefs(page, scope.pins);
      const pendingRefs = scope.pending.map(binding => binding.stableId);
      expect(verifiedRefs.filter(ref => pendingRefs.includes(ref)), "verified pins and pending coordinates must not overlap").toEqual([]);
      expect([...verifiedRefs, ...pendingRefs].sort(), `${role.ref} must disclose its exact reviewed skill set without inventing verification`)
        .toEqual([...DIRECT_SKILLS[role.ref]!].sort());
      scopesByRole.set(role.ref, scope);
    }
    await info.attach("published-role-direct-skill-references", { contentType: "application/json", body: Buffer.from(JSON.stringify(
      ROLES.map(role => ({ roleRef: role.ref, stableIds: DIRECT_SKILLS[role.ref], scope: scopesByRole.get(role.ref) })), null, 2)) });
  });
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
      for (const role of ROLES) {
        const portrait = member.locator(`img[src="/avatars/digital-humans/${role.avatar}.webp"]`);
        await expect(portrait).toBeVisible();
        await expect.poll(() => portrait.evaluate(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))
          .toBe(true);
      }
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
        const memberScope = await roleSkillScope(member, card!.agentId);
        expect(memberScope).toEqual(scopesByRole.get(role.ref));
        await member.getByTestId("chat-skill-mount").click();
        await expect(member.getByTestId("chat-skill-mount-picker")).toBeVisible();
        await expectRoleSkillOptions(member, memberScope);
        // Seeded unrelated organization skills must remain excluded even though
        // the same member has access to them with the general assistant.
        await expect(member.getByTestId(`chat-skill-mount-option-${FULLSTACK_E2E.mountableSkillId}`)).toHaveCount(0);
        await screenshot(member, info, `${index + 6}a-${role.ref}-skill-scope`);
        await member.getByTestId("chat-skill-mount-cancel").click();
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
    await test.step("changing role clears an incompatible real temporary skill mount", async () => {
      const product = cards.find(card => card.avatar?.key === ROLES[1].avatar)!;
      const productScope = scopesByRole.get("D003")!;
      const incompatible = FULLSTACK_E2E.mountableSkillId;
      expect(productScope.pins.some(pin => pin.skillId === incompatible)).toBe(false);
      expect(productScope.pending.some(binding => binding.skillId === incompatible)).toBe(false);
      // The existing fixture skill is genuinely mountable. Official candidates
      // remain unverified: never fabricate a verified official pin for this test.
      await member.goto(`/chat/${verified.find(run => run.roleRef === "D002")!.threadId}`);
      await expect(member.getByTestId("copilotkit-v2-input")).toBeVisible();
      await member.getByTestId("chat-task-workbench-capability-picker").click();
      await member.getByTestId("chat-task-workbench-capability-auto").click();
      await member.getByTestId("chat-skill-mount").click();
      await expect(member.getByTestId(`chat-skill-mount-option-${incompatible}`)).toBeEnabled();
      const mounted = member.waitForResponse(response => response.request().method() === "POST" && /\/threads\/[^/]+\/skill-mounts(?:\?|$)/.test(response.url()));
      await member.getByTestId(`chat-skill-mount-option-${incompatible}`).click();
      expect((await mounted).ok()).toBe(true);
      await expect(member.getByTestId(`chat-skill-mounted-${incompatible}`)).toBeVisible();
      const threadId = verified.find(run => run.roleRef === "D002")!.threadId;
      const deviationsPath = skills.operations.listThreadDeviations.path.replace(":threadId", encodeURIComponent(threadId));
      const before = skills.operations.listThreadDeviations.out.parse(await readApi(member, deviationsPath));
      expect(before.temporary.some(mount => mount.skillId === incompatible)).toBe(true);
      const deleted = member.waitForResponse(response => response.request().method() === "DELETE" && /\/threads\/[^/]+\/skill-mounts\/[^/?]+(?:\?|$)/.test(response.url()));
      await selectWorkbenchAgent(member, product.agentId);
      await expect(member.getByTestId("chat-task-workbench-capability-picker-name")).toContainText("产品经理");
      await expect(member.getByTestId(`chat-skill-mounted-${incompatible}`)).toHaveCount(0);
      expect((await deleted).ok()).toBe(true);
      const after = skills.operations.listThreadDeviations.out.parse(await readApi(member, deviationsPath));
      expect(after.temporary.some(mount => mount.skillId === incompatible)).toBe(false);
      await member.getByTestId("chat-skill-mount").click();
      await expectRoleSkillOptions(member, productScope);
      await screenshot(member, info, "10-role-switch-clears-incompatible-skill");
      await member.getByTestId("chat-skill-mount-cancel").click();
      await member.reload();
      await expect(member.getByTestId(`chat-skill-mounted-${incompatible}`)).toHaveCount(0);
    });
    await info.attach("persisted-role-runs", { body: Buffer.from(JSON.stringify(verified, null, 2)), contentType: "application/json" });
  } finally {
    await memberContext.close();
  }
});
