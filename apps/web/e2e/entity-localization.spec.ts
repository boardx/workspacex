import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { ENTITY_LOCALIZATION_E2E } from "./entity-localization-fixture";
import { agentRole } from "@repo/contracts";
import { EntityLocalizationAdminView } from "@repo/contracts/entity-localization";
import { SkillFileSnapshot, operations as fileOperations } from "@repo/contracts/skill-file-edit";

async function login(page: Page, admin: boolean) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(admin ? ENTITY_LOCALIZATION_E2E.adminEmail : ENTITY_LOCALIZATION_E2E.memberEmail);
  await page.getByTestId("login-password").fill(admin ? ENTITY_LOCALIZATION_E2E.adminPassword : ENTITY_LOCALIZATION_E2E.memberPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
}
async function authorization(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

test("admin authors display copy; members switch language; clearing keeps original execution bytes", async ({ page, browser }, testInfo) => {
  const translatedName = `Exploration translation acceptance ${randomUUID()}`;
  await login(page, true);
  const headers = await authorization(page);
  // Reproduce the shared CI catalog shape: the target must be found through search,
  // rather than assuming a small catalog keeps S157 on its first page.
  const offerResponse = await page.request.get(`/__fullstack_api${agentRole.operations.getOfficialRolePackOffer.path}`, { headers });
  expect(offerResponse.status()).toBe(200);
  const offer = agentRole.OfficialRolePackOffer.parse(await offerResponse.json());
  for (const pack of offer.requiredSkillPacks) {
    const prepared = await page.request.post("/__fullstack_api/admin/skills/starter-pack-imports", {
      headers, data: { ...pack, idempotencyKey: randomUUID() },
    });
    expect(prepared.status(), `${pack.packId}@${pack.packVersion}: ${await prepared.text()}`).toBe(201);
  }
  const imported = await page.request.post("/__fullstack_api/admin/skills/starter-pack-imports", {
    headers, data: { packId: "work-research", packVersion: "1.0.1", idempotencyKey: randomUUID() },
  });
  expect(imported.status()).toBe(201);
  const { skillIds, versionIds } = await imported.json() as { skillIds: string[]; versionIds: string[] };
  const skillId = skillIds[0]!;
  const versionId = versionIds[0]!;
  const snapshotPath = `/__fullstack_api${fileOperations.getSkillFileSnapshot.path.replace(":skillId", encodeURIComponent(skillId))}?versionId=${encodeURIComponent(versionId)}`;
  const beforeResponse = await page.request.get(snapshotPath, { headers });
  expect(beforeResponse.status()).toBe(200);
  const before = SkillFileSnapshot.parse(await beforeResponse.json());
  const adminPath = `/__fullstack_api/admin/skills/${encodeURIComponent(skillId)}/localizations/en`;
  const originalResponse = await page.request.get(adminPath, { headers });
  expect(originalResponse.status()).toBe(200);
  const original = EntityLocalizationAdminView.parse(await originalResponse.json());

  await page.goto("/skill?screen=work-catalog");
  await expect(page.getByTestId("work-catalog-load-more")).toBeVisible();
  const row = page.getByTestId("work-catalog-row-S157");
  await expect(row).toHaveCount(0);
  await page.getByTestId("work-catalog-search").fill(original.source.fields.name);
  await row.click();
  await page.getByTestId("entity-localization-toggle").click();
  const editor = page.getByTestId("entity-localization-editor");
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "译文语言", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "英语", exact: true }).click();
  await page.getByTestId("entity-localization-name").fill(translatedName);
  await page.getByTestId("entity-localization-summary").fill("Translated display summary only");
  await editor.getByRole("button", { name: "保存译文", exact: true }).click();
  await expect(editor.getByRole("status")).toHaveText("译文已保存");
  await page.getByTestId("language-switcher").selectOption("en");
  await expect(row.getByTestId("work-catalog-row-title")).toHaveText(translatedName);
  await expect(page.getByTestId("work-skill-detail")).toContainText("Translated display summary only");
  await page.screenshot({ path: testInfo.outputPath("admin-translation.png"), fullPage: true });

  const memberContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const member = await memberContext.newPage();
    await login(member, false);
    const memberHeaders = await authorization(member);
    expect((await member.request.get(adminPath, { headers: memberHeaders })).status()).toBe(403);
    await member.goto("/skill?screen=work-catalog");
    await member.getByTestId("language-switcher").selectOption("en");
    await member.getByTestId("work-catalog-search").fill(translatedName);
    const memberRow = member.getByTestId("work-catalog-row-S157");
    await expect(memberRow).toHaveCount(1);
    await expect(memberRow.getByTestId("work-catalog-row-title")).toHaveText(translatedName);
    await memberRow.click();
    await expect(member.getByTestId("entity-localization-toggle")).toHaveCount(0);
    await member.screenshot({ path: testInfo.outputPath("member-translation.png"), fullPage: true });
    await member.getByTestId("work-catalog-search").fill(original.source.fields.name);
    await member.getByTestId("language-switcher").selectOption("zh-CN");
    await expect(member.getByTestId("work-catalog-row-S157").getByTestId("work-catalog-row-title")).toHaveText(original.source.fields.name);
  } finally { await memberContext.close(); }

  await editor.getByRole("button", { name: "Remove translation", exact: true }).click();
  await expect(editor.getByRole("status")).toHaveText("Translation removed. The original is shown.");
  await expect(page.getByTestId("work-catalog-row-S157").getByTestId("work-catalog-row-title")).toHaveText(original.source.fields.name);
  const afterResponse = await page.request.get(snapshotPath, { headers });
  expect(afterResponse.status()).toBe(200);
  expect(SkillFileSnapshot.parse(await afterResponse.json())).toEqual(before);
  const afterSource = EntityLocalizationAdminView.parse(await (await page.request.get(adminPath, { headers })).json());
  expect(afterSource.source).toEqual(original.source);
});

test("an installed organization explicitly updates authored titles without changing execution or manual copy", async ({ page, browser }, testInfo) => {
  await login(page,true);
  const headers = await authorization(page);
  const offer = agentRole.OfficialRolePackOffer.parse(await (await page.request.get(`/__fullstack_api${agentRole.operations.getOfficialRolePackOffer.path}`,{ headers })).json());
  for (const pack of offer.requiredSkillPacks) {
    const response = await page.request.post("/__fullstack_api/admin/skills/starter-pack-imports",{ headers,data: { ...pack,idempotencyKey: randomUUID() } });
    expect(response.status(),await response.text()).toBe(201);
  }
  const roleImport = await page.request.post("/__fullstack_api/admin/agents/starter-pack-imports",{ headers,data: { packId: offer.packId,packVersion: offer.packVersion,idempotencyKey: randomUUID() } });
  expect(roleImport.status(),await roleImport.text()).toBe(201);
  const { agentIds } = await roleImport.json() as { agentIds: string[] };
  const catalog = await (await page.request.get("/__fullstack_api/skills/catalog?q=S003&limit=100",{ headers })).json() as { items: { skillId: string }[] };
  const skillId = catalog.items[0]!.skillId;
  const adminPath = `/__fullstack_api/admin/skills/${encodeURIComponent(skillId)}/localizations/en`;
  const source = EntityLocalizationAdminView.parse(await (await page.request.get(adminPath,{ headers })).json());
  const manualName = `Manual search title ${randomUUID()}`;
  const authored = await page.request.put(adminPath,{ headers,data: { sourceRevision: source.source.revision,expectedTranslationRevision: source.translation?.revision ?? null,status: "reviewed",fields: { name: manualName } } });
  expect(authored.status()).toBe(200);
  const manual = EntityLocalizationAdminView.parse(await authored.json());
  const snapshotPath = `/__fullstack_api${fileOperations.getSkillFileSnapshot.path.replace(":skillId",encodeURIComponent(skillId))}?versionId=${encodeURIComponent(source.source.versionId!)}`;
  const before = SkillFileSnapshot.parse(await (await page.request.get(snapshotPath,{ headers })).json());
  const exported = async () => Promise.all(agentIds.map(async id => {
    const response = await page.request.get(`/__fullstack_api/admin/agents/${encodeURIComponent(id)}/portable-package`,{ headers });
    expect(response.status()).toBe(200);
    const pack = await response.json() as { agents: Record<string,unknown>[] };
    return pack.agents.map(({ localization: _copy,...original }) => original);
  }));
  const rolesBefore = await exported();
  await page.goto("/agent");
  await page.getByTestId("language-switcher").selectOption("en");
  await page.getByTestId("agent-directory-enable-official").click();
  const update = page.getByTestId("display-translation-update");
  await expect(update).toBeVisible();
  await update.getByRole("button",{ name: "Update display translations",exact: true }).click();
  await expect(page.getByTestId("agent-directory")).toContainText("Product Manager");
  await page.screenshot({ path: testInfo.outputPath("explicit-display-update.png"),fullPage: true });
  expect(SkillFileSnapshot.parse(await (await page.request.get(snapshotPath,{ headers })).json())).toEqual(before);
  const after = EntityLocalizationAdminView.parse(await (await page.request.get(adminPath,{ headers })).json());
  expect(after.source).toEqual(source.source); expect(after.translation).toEqual(manual.translation);
  expect(await exported()).toEqual(rolesBefore);
  const memberContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const member = await memberContext.newPage(); await login(member,false);
    const memberHeaders = await authorization(member);
    expect((await member.request.get("/__fullstack_api/admin/entity-display-updates/offer",{ headers: memberHeaders })).status()).toBe(403);
    await member.goto("/agent"); await member.getByTestId("language-switcher").selectOption("en");
    await expect(member.getByTestId("agent-directory")).toContainText("Product Manager");
    await expect(member.getByTestId("agent-directory-enable-official")).toHaveCount(0);
    await member.goto("/skill?screen=work-catalog");
    await member.getByTestId("work-catalog-search").fill(manualName);
    await expect(member.getByTestId("work-catalog-row-S003").getByTestId("work-catalog-row-title")).toHaveText(manualName);
    await member.getByTestId("language-switcher").selectOption("zh-CN");
    await member.getByTestId("work-catalog-search").fill("企业内部检索");
    await expect(member.getByTestId("work-catalog-row-S003").getByTestId("work-catalog-row-title")).toHaveText("企业内部检索");
    await member.screenshot({ path: testInfo.outputPath("authored-member-zh.png"),fullPage: true });
  } finally { await memberContext.close(); }
});

test("organization members and invitations retain source data across locales", async ({ page, browser }, testInfo) => {
  // Same multi-account invitation/activation budget as core-journey-02.
  test.setTimeout(120_000);
  const email = `org-locale-${randomUUID()}@example.test`;
  const displayName = `邀请原文 {name} ${randomUUID().slice(0, 8)}`;
  await login(page, true);
  await page.getByTestId("language-switcher").first().selectOption("en");
  await page.goto("/org-admin/invites");
  await expect(page.getByRole("heading", { name: "Invitations", exact: true })).toBeVisible();
  await expect(page.getByLabel("Invitee email", { exact: true })).toBeVisible();
  await page.getByTestId("org-admin-invite-email").fill(email);
  const created = page.waitForResponse((r) => r.request().method() === "POST" && /\/organizations\/[^/]+\/invites$/.test(new URL(r.url()).pathname));
  await page.getByTestId("org-admin-invite-submit").click();
  const response = await created;
  expect(response.status()).toBe(201);
  const requestBody = response.request().postDataJSON() as Record<string, unknown>;
  expect(requestBody).toMatchObject({ email, orgRole: "consultant", teamId: "" });
  await expect(page.getByTestId("org-admin-invite-link-once-note")).toContainText("only once");
  const activationUrl = await page.getByTestId("org-admin-invite-link-url").inputValue();
  await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "邀请", exact: true })).toBeVisible();
  await expect(page.getByTestId("org-admin-invite-link-url")).toHaveValue(activationUrl);
  await expect(page.getByTestId("org-admin-invite-link-once-note")).toContainText("只显示这一次");
  await page.getByTestId("org-admin-invite-link-dismiss").click();
  await expect(page.getByTestId("org-admin-invite-link-block")).toHaveCount(0);

  const inviteeContext = await browser.newContext();
  try {
    const invitee = await inviteeContext.newPage();
    await invitee.goto(activationUrl);
    await invitee.getByTestId("activate-name").fill(displayName);
    await invitee.getByTestId("activate-pwd").fill(`Org-Locale-${randomUUID()}!`);
    await invitee.getByTestId("activate-submit").click();
    await expect(invitee).toHaveURL(/\/projects$/);
    await invitee.reload();
    await expect(invitee).toHaveURL(/\/projects$/);

    await page.goto("/org-admin/members");
    const name = page.getByTestId("org-admin-member-list").getByText(displayName, { exact: true });
    await expect(name).toBeVisible();
    const row = page.getByTestId("org-admin-member-list").locator("li").filter({ has: page.getByText(displayName, { exact: true }) });
    const rowId = await row.getAttribute("data-testid");
    expect(rowId).toBeTruthy();
    const userId = rowId!.replace("org-admin-member-", "");
    await page.getByTestId("language-switcher").first().selectOption("en");
    const rolePicker = page.getByTestId(`org-admin-member-${userId}-org-role`);
    await expect(rolePicker).toHaveText(/Consultant/);
    await rolePicker.click();
    const changed = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/members/${userId}/role`));
    await page.getByTestId(`org-admin-member-${userId}-org-role-option-lead`).click();
    expect((await changed).status()).toBe(200);
    await expect(rolePicker).toContainText("Project lead");
    await expect(name).toHaveText(displayName);
    await page.reload();
    await expect(page.getByTestId(`org-admin-member-${userId}-org-role`)).toContainText("Project lead");
    await expect(page.getByTestId(`org-admin-member-${userId}-name`)).toHaveText(displayName);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByTestId(`org-admin-member-${userId}-org-role`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("org-members-en-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    await invitee.goto("/org-admin/invites");
    await expect(invitee.getByTestId("denied")).toBeVisible();
    await expect(invitee.getByTestId("org-admin-invite-form")).toHaveCount(0);
    await expect(invitee.getByTestId("org-admin-shared-links")).toHaveCount(0);

    await page.goto("/org-admin/invites");
    const sharedCreated = page.waitForResponse((r) => r.request().method() === "POST" && /\/organizations\/[^/]+\/invite-links$/.test(new URL(r.url()).pathname));
    await page.getByTestId("org-admin-shared-link-create").click();
    const sharedResponse = await sharedCreated;
    expect(sharedResponse.status()).toBe(201);
    const shared = await sharedResponse.json() as { linkId: string };
    await expect(page.getByTestId("org-admin-shared-link-block")).toBeVisible();
    const sharedUrl = await page.getByTestId("org-admin-shared-link-url").inputValue();
    expect(sharedUrl).toContain("lt=");
    await page.getByTestId("language-switcher").first().selectOption("zh-CN");
    await expect(page.getByTestId("org-admin-shared-link-url")).toHaveValue(sharedUrl);
    await page.getByTestId("language-switcher").first().selectOption("en");
    await page.getByTestId(`org-admin-shared-link-${shared.linkId}-revoke`).click();
    const revoked = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/invite-links/${shared.linkId}/revoke`));
    await page.getByTestId(`org-admin-shared-link-${shared.linkId}-revoke-confirm-yes`).click();
    expect((await revoked).status()).toBe(201);
    await expect(page.getByTestId(`org-admin-shared-link-${shared.linkId}-status`)).toContainText("Revoked");
    await page.getByTestId("org-admin-shared-link-dismiss").click();
    await expect(page.getByTestId("org-admin-shared-link-block")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("org-invites-en-desktop.png"), fullPage: true });
  } finally {
    await inviteeContext.close();
  }
});
