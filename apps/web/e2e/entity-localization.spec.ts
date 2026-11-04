import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { ENTITY_LOCALIZATION_E2E } from "./entity-localization-fixture";
import { agentRole, aiUsage, homeConfig, orgAdmin, skills, wave2Runtime, workflowCapabilityGrants as WG } from "@repo/contracts";
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

test("administration quotas retain drafts and canonical writes while usage preserves real receipt distinctions across locales", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  await login(page, true);
  const headers = await authorization(page), orgId = ENTITY_LOCALIZATION_E2E.orgId, userId = ENTITY_LOCALIZATION_E2E.memberUserId;
  const base = `/__fullstack_api/organizations/${encodeURIComponent(orgId)}`;
  const quotaPath = `${base}/token-quotas`, budgetPath = `${base}/token-budget`, memberPath = `${quotaPath}/${encodeURIComponent(userId)}`, rulesPath = `${base}/limit-rules`;
  const initialResponse = await page.request.get(quotaPath, { headers }); expect(initialResponse.status()).toBe(200);
  const initial = orgAdmin.operations.getTokenQuotas.out.parse(await initialResponse.json());
  expect(initial.orgBudget).toBeNull(); expect(initial.unallocated).toBeNull();
  expect(initial.members.find(member => member.userId === userId)?.monthlyLimit).toBeNull();
  const helper = await page.context().newPage(); await helper.goto("/home");
  const locale = async (value: "en" | "zh-CN") => {
    await helper.getByTestId("language-switcher").first().selectOption(value);
    await expect(page.locator("html")).toHaveAttribute("lang", value);
  };
  const capture = async (name: string, mobile = false) => {
    await page.setViewportSize({ width: mobile ? 375 : 1280, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`member-quotas-${name}-${mobile ? 375 : 1280}.png`), fullPage: true });
  };
  const responseFor = (method: string, path: string) => page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === path);
  let reads = 0, writes = 0;
  page.on("request", request => {
    if (!new URL(request.url()).pathname.startsWith(base)) return;
    if (request.method() === "GET") reads++; else writes++;
  });
  try {
    await page.goto("/admin/members"); await locale("en");
    await expect(page.getByTestId("admin-quota-live")).toBeVisible();
    await expect(page.getByTestId("admin-quota-card-unallocated")).toContainText("—");
    await expect(page.getByTestId(`admin-member-card-${userId}`)).toContainText("No quota allocated");
    await expect(page.getByRole("heading", { name: "What administrators cannot see" })).toBeVisible();
    await capture("initial-en"); await capture("initial-en", true);
    await page.getByTestId("admin-members-invite-open").click();
    const inviteDraft = `quota-locale-${randomUUID()}-raw{draft}@example.test`;
    await page.getByTestId("org-admin-invite-email").fill(inviteDraft);
    const beforeInviteLocale = [reads, writes]; await locale("zh-CN"); await locale("en");
    await expect(page.getByTestId("admin-members-invite-dialog")).toBeVisible();
    await expect(page.getByTestId("org-admin-invite-email")).toHaveValue(inviteDraft);
    expect([reads, writes]).toEqual(beforeInviteLocale);
    await capture("invite-draft-en", true);
    await page.getByTestId("admin-members-invite-dialog-close").click();
    await expect(page.getByTestId("admin-members-invite-dialog")).toHaveCount(0);
    await expect(page.getByTestId("org-admin-invite-link-block")).toHaveCount(0);
    expect([reads, writes]).toEqual(beforeInviteLocale);
    await page.getByTestId("admin-quota-budget-open").click(); await page.getByTestId("admin-quota-budget-input").fill("500000");
    const beforeBudgetLocale = [reads, writes]; await locale("zh-CN"); await locale("en");
    await expect(page.getByTestId("admin-quota-budget-input")).toHaveValue("500000"); expect([reads, writes]).toEqual(beforeBudgetLocale);
    await expect(page.getByTestId("admin-quota-budget-save")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("admin-quota-budget-modal").getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({ ratio: 1 });
    await capture("budget-draft-en", true);
    const budgetSaved = responseFor("PATCH", budgetPath); await page.getByTestId("admin-quota-budget-save").click();
    const budget = await budgetSaved; expect(budget.status()).toBe(200); expect(budget.request().postDataJSON()).toEqual({ orgId, monthlyBudget: 500000 });
    orgAdmin.operations.setOrgTokenBudget.out.parse(await budget.json()); await expect(page.getByTestId("admin-quota-budget-modal")).toHaveCount(0);
    await page.getByTestId(`admin-member-quota-${userId}`).click(); await page.getByTestId("admin-member-quota-input").fill("12500.9");
    const beforeMemberLocale = [reads, writes]; await locale("zh-CN"); await locale("en");
    await expect(page.getByTestId("admin-member-quota-input")).toHaveValue("12500.9"); expect([reads, writes]).toEqual(beforeMemberLocale);
    await expect(page.getByTestId("admin-member-quota-save")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("admin-member-quota-cancel")).toBeInViewport({ ratio: 1 }); await capture("quota-draft-en", true);
    const memberSaved = responseFor("PATCH", memberPath); await page.getByTestId("admin-member-quota-save").click();
    const memberQuota = await memberSaved; expect(memberQuota.status()).toBe(200); expect(memberQuota.request().postDataJSON()).toEqual({ orgId, userId, monthlyLimit: 12500 });
    orgAdmin.operations.setMemberTokenQuota.out.parse(await memberQuota.json()); await expect(page.getByTestId("admin-member-quota-modal")).toHaveCount(0);
    await page.getByTestId(`admin-member-quota-${userId}`).click(); await page.getByTestId("admin-member-quota-input").fill("500001");
    const quotaRejected = responseFor("PATCH", memberPath); await page.getByTestId("admin-member-quota-save").click();
    const over = await quotaRejected; expect(over.status()).toBe(409); expect(await over.json()).toMatchObject({ reasonCode: "QUOTA_OVERALLOCATED", remainingTokens: 500000 });
    await expect(page.getByTestId("admin-member-quota-error")).toContainText("500,000"); await locale("zh-CN");
    await expect(page.getByTestId("admin-member-quota-error")).toContainText("超出组织剩余额度"); await locale("en");
    await expect(page.getByTestId("admin-member-quota-input")).toHaveValue("500001"); await capture("quota-error-en", true);
    await page.getByTestId("admin-member-quota-cancel").click();
    await page.getByTestId("admin-quota-budget-open").click(); await page.getByTestId("admin-quota-budget-input").fill("1");
    const budgetRejected = responseFor("PATCH", budgetPath); await page.getByTestId("admin-quota-budget-save").click();
    expect((await budgetRejected).status()).toBe(409); await expect(page.getByTestId("admin-quota-budget-error")).toContainText("12,500");
    await page.getByTestId("admin-quota-budget-modal-close").click();
    await page.reload(); await expect(page.getByTestId(`admin-member-card-${userId}`)).toContainText("12,500");
    await page.getByTestId("admin-members-tab-policy").click(); await expect(page.getByTestId("admin-limit-rules-live")).toBeVisible();
    await expect(page.getByTestId("admin-no-backend-notice")).toContainText("static demonstration");
    await page.getByTestId("admin-limit-rule-new").click();
    await page.getByTestId("admin-limit-scope-ref").fill(userId); await page.getByTestId("admin-limit-threshold").fill("20000.9");
    await page.getByTestId("admin-limit-action").selectOption("degrade");
    const ruleRejected = responseFor("POST", rulesPath); await page.getByTestId("admin-limit-rule-create-save").click();
    expect((await ruleRejected).status()).toBe(400); await expect(page.getByTestId("admin-limit-rule-error")).toContainText("Choose a target model");
    await page.getByTestId("admin-limit-degrade-to").fill("model-target-raw{model}");
    const beforeRuleLocale = [reads, writes]; await locale("zh-CN"); await locale("en"); expect([reads, writes]).toEqual(beforeRuleLocale);
    await expect(page.getByTestId("admin-limit-scope-ref")).toHaveValue(userId); await expect(page.getByTestId("admin-limit-threshold")).toHaveValue("20000.9");
    await expect(page.getByTestId("admin-limit-rule-create-save")).toBeInViewport({ ratio: 1 }); await capture("rule-draft-en", true);
    const ruleSaved = responseFor("POST", rulesPath); await page.getByTestId("admin-limit-rule-create-save").click();
    const ruleResponse = await ruleSaved; expect(ruleResponse.status()).toBe(201);
    expect(ruleResponse.request().postDataJSON()).toEqual({ orgId, scopeKind: "member", scopeRef: userId, modelId: null, windowKind: "day", thresholdTokens: 20000, action: "degrade", degradeToModelId: "model-target-raw{model}" });
    const { ruleId } = orgAdmin.operations.createLimitRule.out.parse(await ruleResponse.json());
    await expect(page.getByTestId(`admin-limit-rule-${ruleId}`)).toContainText("model-target-raw{model}");
    await capture("policy-en"); await capture("policy-en", true);
    await page.getByTestId(`admin-limit-rule-edit-${ruleId}`).click(); await page.getByTestId("admin-limit-edit-threshold").fill("22500.9");
    const beforeRuleEditLocale = [reads, writes]; await locale("zh-CN"); await locale("en");
    await expect(page.getByTestId("admin-limit-edit-threshold")).toHaveValue("22500.9"); expect([reads, writes]).toEqual(beforeRuleEditLocale);
    await expect(page.getByTestId("admin-limit-rule-edit-save")).toBeInViewport({ ratio: 1 });
    await capture("rule-edit-draft-en", true);
    const ruleEdited = responseFor("PATCH", `${rulesPath}/${ruleId}`); await page.getByTestId("admin-limit-rule-edit-save").click();
    const editResponse = await ruleEdited; expect(editResponse.status()).toBe(200); expect(editResponse.request().postDataJSON()).toEqual({ orgId, ruleId, thresholdTokens: 22500 });
    await page.reload(); await page.getByTestId("admin-members-tab-policy").click(); await expect(page.getByTestId(`admin-limit-rule-${ruleId}`)).toContainText("22,500");
    const initialSummaryReady = responseFor("GET", `${base}/ai-usage`), initialCallsReady = responseFor("GET", `${base}/ai-usage/calls`);
    await page.getByTestId("admin-members-tab-usage").click();
    const initialSummaryResponse = await initialSummaryReady, initialCallsResponse = await initialCallsReady;
    expect(initialSummaryResponse.status()).toBe(200); expect(initialCallsResponse.status()).toBe(200);
    const initialSummary = aiUsage.Summary.parse(await initialSummaryResponse.json());
    const initialCalls = aiUsage.Calls.parse(await initialCallsResponse.json());
    expect(initialCalls.asOf).toBe(initialSummary.asOf);
    expect(new URL(initialCallsResponse.url()).searchParams.get("asOf")).toBe(initialSummary.asOf);
    await expect(page.getByRole("region", { name: "Usage trend" })).toBeVisible();
    await expect(page.getByText("CNY 1.234567", { exact: true }).first()).toBeVisible(); await expect(page.getByText("USD 0.000001", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("admin-usage-matrix")).toContainText("计量模型原文 {model}");
    const trend = page.getByRole("region", { name: "Usage trend" });
    await trend.getByRole("button", { name: "Monthly", exact: true }).click();
    await trend.getByRole("button", { name: "Calls", exact: true }).click();
    const beforeUsageLocale = [reads, writes]; await locale("zh-CN"); await locale("en"); expect([reads, writes]).toEqual(beforeUsageLocale);
    await expect(trend.getByRole("button", { name: "Monthly", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(trend.getByRole("button", { name: "Calls", exact: true })).toHaveAttribute("aria-pressed", "true");
    await capture("usage-overview-en"); await capture("usage-overview-en", true);
    await page.getByRole("tab", { name: "Call details", exact: true }).click();
    await expect(page.getByTestId("usage-ledger")).toContainText("2,000 milliseconds (estimated)"); await expect(page.getByTestId("usage-ledger")).toContainText("Not reported");
    await expect(page.getByTestId("usage-ledger")).toContainText("1.234567 CNY");
    const rawModel = "计量模型原文 {model}", rawProvider = "locale-fixture";
    const rawRow = page.getByTestId("usage-ledger").getByRole("row").filter({ has: page.getByText(rawModel, { exact: true }) });
    const details = rawRow.locator("details"); await details.locator("summary").click();
    const beforeDetailsLocale = [reads, writes]; await locale("zh-CN"); await locale("en");
    await expect(details).toHaveJSProperty("open", true); await expect(rawRow).toContainText(rawModel); await expect(rawRow).toContainText(rawProvider);
    await expect(rawRow).toContainText("1.234567 CNY"); expect([reads, writes]).toEqual(beforeDetailsLocale);
    await capture("usage-ledger-en"); await capture("usage-ledger-en", true);
    const filteredResponseFor = (path: string) => page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.pathname === path && url.searchParams.get("modelProvider") === rawProvider && url.searchParams.get("modelId") === rawModel;
    });
    const filteredSummaryReady = filteredResponseFor(`${base}/ai-usage`), filteredCallsReady = filteredResponseFor(`${base}/ai-usage/calls`);
    await page.getByTestId("usage-model-filter").click();
    await page.getByRole("menuitemradio", { name: `${rawModel} · ${rawProvider}`, exact: true }).click();
    const filteredSummaryResponse = await filteredSummaryReady, filteredCallsResponse = await filteredCallsReady;
    expect(filteredSummaryResponse.status()).toBe(200); expect(filteredCallsResponse.status()).toBe(200);
    const filteredSummary = aiUsage.Summary.parse(await filteredSummaryResponse.json()), filteredCalls = aiUsage.Calls.parse(await filteredCallsResponse.json());
    expect(filteredSummary.asOf).toBe(initialSummary.asOf); expect(filteredCalls.asOf).toBe(initialSummary.asOf);
    for (const response of [filteredSummaryResponse, filteredCallsResponse]) {
      const query = new URL(response.url()).searchParams;
      expect(query.get("modelProvider")).toBe(rawProvider); expect(query.get("modelId")).toBe(rawModel); expect(query.get("asOf")).toBe(initialSummary.asOf);
    }
    expect(filteredCalls.calls.length).toBeGreaterThan(0);
    expect(filteredCalls.calls.every(call => call.modelProvider === rawProvider && call.modelId === rawModel)).toBe(true);
    await expect(page.getByTestId("usage-ledger")).toContainText(rawModel);
    const beforeFilterLocale = [reads, writes]; await locale("zh-CN"); await locale("en");
    await expect(page.getByTestId("usage-model-filter")).toHaveText(`${rawModel} · ${rawProvider}`);
    await expect(page.getByRole("tab", { name: "Call details", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("usage-ledger")).toContainText(rawModel); expect([reads, writes]).toEqual(beforeFilterLocale);
    await capture("filtered-ledger-en"); await capture("filtered-ledger-en", true);
    const deleted = responseFor("POST", `${rulesPath}/${ruleId}/delete`);
    await page.getByTestId("admin-members-tab-policy").click(); await page.getByTestId(`admin-limit-rule-delete-${ruleId}`).click(); expect((await deleted).status()).toBe(201);
    await expect(page.getByTestId(`admin-limit-rule-${ruleId}`)).toHaveCount(0);
    const persistedResponse = await page.request.get(quotaPath, { headers }); expect(persistedResponse.status()).toBe(200);
    const persisted = orgAdmin.operations.getTokenQuotas.out.parse(await persistedResponse.json()); expect(persisted.orgBudget).toBe(500000); expect(persisted.members.find(member => member.userId === userId)?.monthlyLimit).toBe(12500);
    const memberContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    try {
      const member = await memberContext.newPage(); await login(member, false); const memberHeaders = await authorization(member);
      for (const path of [quotaPath, rulesPath, `${base}/usage?window=week`]) expect((await member.request.get(path, { headers: memberHeaders })).status()).toBe(403);
      expect((await member.request.patch(memberPath, { headers: memberHeaders, data: { orgId, userId, monthlyLimit: 1 } })).status()).toBe(403);
      expect((await member.request.patch(budgetPath, { headers: memberHeaders, data: { orgId, monthlyBudget: 1 } })).status()).toBe(403);
      expect((await member.request.post(rulesPath, { headers: memberHeaders, data: { orgId, scopeKind: "member", scopeRef: userId, modelId: null, windowKind: "day", thresholdTokens: 1, action: "warn", degradeToModelId: null } })).status()).toBe(403);
      await member.goto("/admin/members"); await member.getByTestId("language-switcher").first().selectOption("en"); await expect(member.getByTestId("admin-quota-load-failed")).toContainText("Could not load quota data");
      await expect(member.getByTestId("admin-quota-load-failed")).toContainText("You do not have permission to perform this action.");
      await expect(member.getByTestId("admin-quota-load-failed")).not.toContainText("Your session has expired");
      await member.setViewportSize({ width: 375, height: 900 }); await member.screenshot({ path: testInfo.outputPath("member-quotas-denied-en-375.png"), fullPage: true });
    } finally { await memberContext.close(); }
    const afterDenied = await page.request.get(quotaPath, { headers }); expect(orgAdmin.operations.getTokenQuotas.out.parse(await afterDenied.json())).toEqual(persisted);
    // Real summary parse ensures receipts reached the backend contract, not only DOM text.
    const dates = new URLSearchParams({ start: new Date(Date.now() - 6 * 86400000).toISOString(), end: new Date(Date.now() + 86400000).toISOString(), timezone: "Asia/Shanghai", limit: "25" });
    const reportResponse = await page.request.get(`${base}/ai-usage?${dates}`, { headers }); expect(reportResponse.status()).toBe(200);
    const report = aiUsage.Summary.parse(await reportResponse.json()); expect(report.current.unknownCalls).toBe(1); expect(report.current.nativeCalls).toBe(1); expect(report.costs?.map(cost => cost.currency).sort()).toEqual(["CNY", "USD"]);
  } finally { await helper.close(); }
});

test("organization profile preserves authored data and enforces real grant and memory permissions across locales", async ({ page, browser }, testInfo) => {
  // Multi-account writes/reload budget, matching the existing invitation journey below.
  test.setTimeout(120_000);
  await login(page, true);
  const headers = await authorization(page);
  const profilePath = `/__fullstack_api/organizations/${encodeURIComponent(ENTITY_LOCALIZATION_E2E.orgId)}`;
  const grantsPath = "/__fullstack_api/tool-permission-grants";
  const settingPath = "/__fullstack_api/knowledge-graph/extraction-setting";
  type Grant = { grantId: string; toolName: string; grantedByUserId: string | null; grantedAt: string };
  type Setting = { deploymentCapable: boolean; orgEnabled: boolean };
  const grantsResponse = await page.request.get(grantsPath, { headers });
  expect(grantsResponse.status()).toBe(200);
  // A pre-existing private-tenant grant is a prerequisite, not proof of approval creation.
  const grant = (await grantsResponse.json() as Grant[]).find(row => row.toolName === "历史工具原文 {tool}");
  expect(grant).toBeDefined();
  const settingResponse = await page.request.get(settingPath, { headers });
  expect(settingResponse.status()).toBe(200);
  const setting = await settingResponse.json() as Setting;
  let profileReads = 0, grantReads = 0, settingReads = 0;
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "PATCH" && path === profilePath && Object.keys(request.postDataJSON() as object).length === 1) profileReads++;
    if (request.method() === "GET" && path === grantsPath) grantReads++;
    if (request.method() === "GET" && path === settingPath) settingReads++;
  });
  await page.goto("/org-admin/profile");
  const name = `组织原名 {name} ${randomUUID().slice(0, 8)}`;
  const description = "组织简介原文 {description}\nSecond line stays authored.";
  await page.getByTestId("org-admin-name-input").fill(name);
  await page.getByTestId("org-admin-description-input").fill(description);
  const row = page.getByTestId("standing-tool-grant-row").filter({ hasText: grant!.toolName });
  await expect(row).toContainText(grant!.grantedByUserId!);
  await expect(page.getByRole("switch")).toBeVisible();
  const reads = [profileReads, grantReads, settingReads];
  expect(reads.every(count => count > 0)).toBe(true);
  await page.getByTestId("language-switcher").first().selectOption("en");
  await expect(page.getByRole("heading", { name: "Organization profile", exact: true })).toBeVisible();
  await expect(page.getByLabel("Organization name", { exact: true })).toHaveValue(name);
  await expect(page.getByLabel("Organization description", { exact: true })).toHaveValue(description);
  await expect(row).toContainText(`Approved by ${grant!.grantedByUserId}`);
  expect([profileReads, grantReads, settingReads]).toEqual(reads);
  const saved = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === profilePath);
  await page.getByTestId("org-admin-profile-save").click();
  const saveResponse = await saved;
  expect(saveResponse.status()).toBe(200);
  expect(saveResponse.request().postDataJSON()).toEqual({ orgId: ENTITY_LOCALIZATION_E2E.orgId, name, description });
  await expect(page.getByTestId("saved")).toHaveText("Saved");
  await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  await expect(page.getByTestId("saved")).toHaveText("已保存");
  await page.getByTestId("language-switcher").first().selectOption("en");
  // Real server byte validation; switching language retranslates the retained error.
  const rejected = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `${profilePath}/avatar`);
  await page.getByTestId("org-admin-avatar-file-input").setInputFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("not image bytes") });
  expect((await rejected).ok()).toBe(false);
  await expect(page.getByTestId("org-admin-avatar-error")).toContainText("file content does not match");
  await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  await expect(page.getByTestId("org-admin-avatar-error")).toContainText("文件内容与声明的图片格式不符");
  await page.getByTestId("language-switcher").first().selectOption("en");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 16;
    canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const avatarSaved = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === profilePath);
  await page.getByTestId("org-admin-avatar-file-input").setInputFiles({ name: "组织头像 {file}.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  expect((await avatarSaved).status()).toBe(200);
  await expect(page.getByTestId("org-admin-avatar-image")).toHaveAccessibleName(`${name} avatar`);
  await expect(page.getByTestId("org-admin-avatar-image")).toHaveJSProperty("naturalWidth", 16);
  await page.reload();
  await expect(page.getByLabel("Organization name", { exact: true })).toHaveValue(name);
  await expect(page.getByLabel("Organization description", { exact: true })).toHaveValue(description);
  await expect(page.getByTestId("org-admin-avatar-image")).toHaveJSProperty("naturalWidth", 16);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("org-profile-admin-en-1280.png"), fullPage: true });

  const memberContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const member = await memberContext.newPage(); await login(member, false);
    const memberHeaders = await authorization(member);
    const deniedProfile = member.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === profilePath);
    const deniedGrants = member.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === grantsPath);
    await member.goto("/org-admin/profile");
    expect((await deniedProfile).status()).toBe(403); expect((await deniedGrants).status()).toBe(403);
    await member.getByTestId("language-switcher").first().selectOption("en");
    await expect(member.getByTestId("org-admin-profile-form")).toHaveCount(0);
    await expect(member.getByTestId("denied").filter({ hasText: "Only organization administrators can edit the organization profile." }).getByTestId("denied-layer")).toHaveText("Organization restriction: Only organization administrators can edit the organization profile. You are not an administrator in this organization.");
    await expect(member.getByTestId("standing-tool-grants").getByTestId("denied-layer")).toHaveText("Organization restriction: Only organization administrators can view and revoke standing tool grants.");
    await expect(member.getByRole("switch")).toBeDisabled();
    expect((await member.request.get(settingPath, { headers: memberHeaders })).status()).toBe(200);
    expect((await member.request.put(settingPath, { headers: memberHeaders, data: { enabled: !setting.orgEnabled } })).status()).toBe(403);
    expect((await member.request.delete(`${grantsPath}/${grant!.grantId}`, { headers: memberHeaders })).status()).toBe(403);
    await member.screenshot({ path: testInfo.outputPath("org-profile-member-denied-en.png"), fullPage: true });
    await member.getByTestId("language-switcher").first().selectOption("zh-CN");
    await expect(member.getByTestId("standing-tool-grants").getByTestId("denied-layer")).toHaveText("组织层限制：只有组织管理员可以查看和撤销长期工具授权。");
  } finally { await memberContext.close(); }

  const toggle = page.getByRole("switch", { name: "Enable memory extraction for this organization", exact: true });
  if (setting.deploymentCapable) {
    const changed = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname === settingPath);
    await toggle.click();
    const changedResponse = await changed; expect(changedResponse.status()).toBe(200);
    expect(changedResponse.request().postDataJSON()).toEqual({ enabled: !setting.orgEnabled });
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", String(!setting.orgEnabled));
  } else {
    await expect(toggle).toBeDisabled();
    await expect(page.getByTestId("knowledge-extraction-not-capable")).toContainText("Not active:");
    expect(await (await page.request.get(settingPath, { headers })).json()).toEqual(setting);
  }
  await testInfo.attach("actual-memory-deployment-capability", { body: JSON.stringify(setting), contentType: "application/json" });
  await expect(row).toBeVisible(); // The member's forbidden DELETE preserved the actual row.
  const revoked = page.waitForResponse(response => response.request().method() === "DELETE" && new URL(response.url()).pathname === `${grantsPath}/${grant!.grantId}`);
  await row.getByTestId("standing-tool-grant-revoke").click();
  const revokedResponse = await revoked; expect(revokedResponse.status()).toBe(200);
  expect(await revokedResponse.json()).toEqual({ grantId: grant!.grantId });
  await expect(page.getByTestId("standing-tool-grants-empty")).toHaveText("This organization currently has no standing tool grants.");
  expect(await (await page.request.get(grantsPath, { headers })).json()).toEqual([]);
  await page.reload();
  await expect(page.getByTestId("standing-tool-grants-empty")).toBeVisible();
  await page.setViewportSize({ width: 820, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("org-profile-empty-en-820.png"), fullPage: true });
});

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

test("shared admin sidebars retain routes, scope and live counts across locale changes", async ({ page }, testInfo) => {
  await login(page, true);
  let countReads = 0;
  page.on("request", request => {
    const url = new URL(request.url());
    if (request.method() === "GET" && (url.pathname.endsWith("/capabilities") || url.pathname.endsWith("/feedback/drafts/count"))) countReads += 1;
  });
  const countReady = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/capabilities") && url.searchParams.get("kind") === "skill" && response.status() === 200;
  });
  await page.goto("/org-admin/members");
  await countReady;
  await expect(page.getByTestId("org-admin-member-list")).toBeVisible();
  await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  const nav = page.getByTestId("admin-nav");
  const members = page.getByTestId("admin-nav-org-members");
  await expect(nav).toHaveAttribute("data-admin-scope", "org");
  await expect(nav).toHaveAccessibleName("组织后台模块");
  await expect(members).toHaveAttribute("aria-current", "page");
  const readsBeforeLocale = countReads;
  await page.getByTestId("language-switcher").first().selectOption("en");
  await expect(nav).toHaveAccessibleName("Organization admin modules");
  await expect(members).toHaveText(/^Members\s*—$/);
  await expect(page.getByTestId("admin-nav-org-members-count")).toHaveAccessibleName("Members count unavailable");
  await expect(members).toHaveAttribute("href", "/org-admin/members");
  await expect(members).toHaveAttribute("aria-current", "page");
  expect(countReads).toBe(readsBeforeLocale);
  await expect(page.getByTestId("admin-nav-agent")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("admin-nav-org-en-1280.png"), fullPage: true });
  await page.reload();
  await expect(page.getByTestId("admin-nav")).toHaveAccessibleName("Organization admin modules");

  // This private organization admin is not a platform operator; preserve the real403.
  const denied = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/platform/members"));
  await page.goto("/platform-admin/members");
  expect((await denied).status()).toBe(403);
  await expect(page.getByTestId("admin-platform-members-forbidden")).toBeVisible();
  await expect(page.getByTestId("admin-nav")).toHaveAccessibleName("Platform admin modules");
  await expect(page.getByTestId("admin-nav")).toHaveAttribute("data-admin-scope", "platform");
  await expect(page.getByTestId("admin-nav-org-members")).toHaveCount(0);
  await expect(page.getByTestId("admin-nav-agent-count")).toHaveText(/^\d+$/);
  const agentCount = await page.getByTestId("admin-nav-agent-count").textContent();
  await expect(page.getByTestId("admin-nav-mcp-count")).toHaveText("—");
  await expect(page.getByTestId("admin-nav-mcp-count")).toHaveAccessibleName("MCP count unavailable");
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.getByTestId("admin-nav")).toBeVisible();
  await expect(page.getByTestId("admin-nav-agent")).toHaveAttribute("href", "/platform-admin/agent");
  await page.screenshot({ path: testInfo.outputPath("admin-nav-platform-en-820.png"), fullPage: true });
  await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  await expect(page.getByTestId("admin-nav")).toHaveAccessibleName("平台后台模块");
  await expect(page.getByTestId("admin-nav-agent-count")).toHaveText(agentCount ?? "");
  await expect(page.getByTestId("admin-nav-mcp-count")).toHaveAccessibleName("MCP 计数暂不可用");
  // Existing AppShell hides its left sidebar below768px; this slice keeps that policy.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByTestId("shell-left-panel")).toBeHidden();
  await expect(page.getByTestId("admin-platform-members-forbidden")).toBeVisible();
});


test("organization home configuration preserves drafts, real previews and recommendation snapshots across locales", async ({ page, browser }, testInfo) => {
  // Same multi-account write/reload budget as the other private-tenant journeys.
  test.setTimeout(120_000);
  await login(page, true);
  await page.getByTestId("language-switcher").first().selectOption("en");
  const headers = await authorization(page);
  const orgId = ENTITY_LOCALIZATION_E2E.orgId;
  const scopedPath = (path: string) => "/__fullstack_api" + path.replace(":orgId", encodeURIComponent(orgId));
  const homePath = scopedPath(homeConfig.operations.getHomeConfig.path);
  const bannerPath = scopedPath(homeConfig.operations.uploadHomeBanner.path);
  const avatarPath = scopedPath(orgAdmin.operations.uploadOrgAvatar.path);
  const orgPath = scopedPath(orgAdmin.operations.updateOrganization.path);
  const directoryPath = "/__fullstack_api" + agentRole.operations.listAgentDirectory.path;
  const skillsPath = "/__fullstack_api" + skills.operations.listSkills.path;
  const currentResponse = await page.request.get(homePath, { headers });
  expect(currentResponse.status()).toBe(200);
  const before = homeConfig.HomeConfig.parse(await currentResponse.json());
  const readDirectory = async () => {
    const response = await page.request.get(directoryPath, { headers });
    expect(response.status()).toBe(200);
    return agentRole.operations.listAgentDirectory.out.parse(await response.json()).items
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
  };
  const readLibrary = async () => {
    const response = await page.request.get(skillsPath, { headers, params: { orgId, entry: "library" } });
    expect(response.status()).toBe(200);
    return skills.operations.listSkills.out.parse(await response.json()).items
      .sort((left, right) => left.skillId.localeCompare(right.skillId));
  };
  const initialDirectory = await readDirectory();
  const initialLibrary = await readLibrary();
  const existingAgent = initialDirectory.find(item => item.catalogSource === "official" && item.agentId && item.versionId);
  let importedIds: string[] = [];
  let importedVersionIds: string[] = [];
  if (!existingAgent) {
    // A fresh tenant still installs real dependencies and roles; conflicts remain failures.
    const offerResponse = await page.request.get("/__fullstack_api" + agentRole.operations.getOfficialRolePackOffer.path, { headers });
    expect(offerResponse.status()).toBe(200);
    const offer = agentRole.OfficialRolePackOffer.parse(await offerResponse.json());
    for (const pack of offer.requiredSkillPacks) {
      const installed = await page.request.post("/__fullstack_api/admin/skills/starter-pack-imports", {
        headers, data: { ...pack, idempotencyKey: randomUUID() },
      });
      expect(installed.status(), await installed.text()).toBe(201);
    }
    const installed = await page.request.post("/__fullstack_api" + wave2Runtime.operations.importAgentStarterPack.path, {
      headers, data: { packId: offer.packId, packVersion: offer.packVersion, idempotencyKey: randomUUID() },
    });
    expect(installed.status(), await installed.text()).toBe(201);
    const result = wave2Runtime.operations.importAgentStarterPack.out.parse(await installed.json());
    importedIds = result.agentIds;
    importedVersionIds = result.versionIds;
    expect(importedIds.length).toBeGreaterThan(0);
  }
  const agentSnapshot = (item: typeof initialDirectory[number]) => ({
    agentId: item.agentId, versionId: item.versionId, name: item.name, display: item.display,
  });
  const skillSnapshot = (item: typeof initialLibrary[number]) => ({
    skillId: item.skillId, currentVersionId: item.currentVersionId, name: item.name, display: item.display,
  });
  // Preserve authored identity; readiness, usage and other derived fields may change.
  const directory = await readDirectory();
  const library = await readLibrary();
  for (const original of initialDirectory) {
    const retained = directory.find(item => item.agentId === original.agentId);
    expect(retained).toBeDefined();
    expect(agentSnapshot(retained!)).toEqual(agentSnapshot(original));
  }
  for (const original of initialLibrary) {
    const retained = library.find(item => item.skillId === original.skillId);
    expect(retained).toBeDefined();
    expect(skillSnapshot(retained!)).toEqual(skillSnapshot(original));
  }
  if (existingAgent) {
    expect(directory.map(agentSnapshot)).toEqual(initialDirectory.map(agentSnapshot));
    expect(library.map(skillSnapshot)).toEqual(initialLibrary.map(skillSnapshot));
  }
  const agent = existingAgent
    ? directory.find(item => item.agentId === existingAgent.agentId)
    : directory.find(item => item.catalogSource === "official" && importedIds.includes(item.agentId) && importedVersionIds.includes(item.versionId));
  expect(agent, "Setup must provide a published official agent from existing or actual imported IDs").toBeDefined();
  expect(agent!.agentId).not.toBe("");
  expect(agent!.versionId).not.toBe("");
  expect(agent!.name).not.toBe("");
  if (existingAgent) expect(agentSnapshot(agent!)).toEqual(agentSnapshot(existingAgent));
  // Canonical adapter status and stable IDs are independent of display locale.
  const skill = library.find(item => item.status === "已启用" && item.skillId && item.currentVersionId);
  expect(skill, "Existing official agents require an enabled published skill; setup must not reinstall authored packs").toBeDefined();
  expect(skill!.skillId).not.toBe("");
  expect(skill!.currentVersionId).toBeTruthy();
  expect(skill!.name).not.toBe("");
  if (existingAgent) {
    const originalSkill = initialLibrary.find(item => item.skillId === skill!.skillId);
    expect(originalSkill).toBeDefined();
    expect(skillSnapshot(skill!)).toEqual(skillSnapshot(originalSkill!));
  }
  await testInfo.attach("home-recommendation-preparation", {
    contentType: "application/json",
    body: JSON.stringify({
      branch: existingAgent ? "reuse-existing" : "install-fresh",
      agent: { agentId: agent!.agentId, versionId: agent!.versionId, name: agent!.name },
      skill: { skillId: skill!.skillId, versionId: skill!.currentVersionId, name: skill!.name },
      preservedDirectoryIds: initialDirectory.map(item => item.agentId),
      preservedSkillIds: initialLibrary.map(item => item.skillId),
      existingSnapshotsPreserved: true,
    }),
  });

  const reads = { config: 0, agents: 0, skills: 0 };
  let bannerPosts = 0, threadPosts = 0;
  page.on("request", request => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === homePath) reads.config++;
    if (request.method() === "GET" && url.pathname === directoryPath) reads.agents++;
    if (request.method() === "GET" && url.pathname === skillsPath && url.searchParams.get("entry") === "library") reads.skills++;
    if (request.method() === "POST" && url.pathname === bannerPath) bannerPosts++;
    if (request.method() === "POST" && url.pathname.endsWith("/threads")) threadPosts++;
  });
  await page.goto("/org-admin/home-config");
  await expect(page.getByRole("heading", { name: "Home configuration", exact: true })).toBeVisible();
  await expect(page.getByTestId("home-config-agents")).toBeHidden();
  await expect(page.getByTestId("home-config-quick-actions")).toBeHidden();
  const title = "品牌原文 {name} " + randomUUID().slice(0, 6);
  const headline = "横幅原文 {count}";
  const tagline = "副标题原文 {description}\nSecond line stays authored.";
  await page.getByTestId("home-config-title").fill(title);
  await page.getByTestId("home-config-banner-headline").fill(headline);
  await page.getByTestId("home-config-banner-tagline").fill(tagline);
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#345678"; ctx.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const image = Buffer.from(png, "base64");
  const logoUploaded = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === avatarPath);
  const logoApplied = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === orgPath);
  await page.getByTestId("home-logo-file").setInputFiles({ name: "Logo原文 {file}.png", mimeType: "image/png", buffer: image });
  const logoResponse = await logoUploaded; expect(logoResponse.ok()).toBe(true);
  const logo = orgAdmin.operations.uploadOrgAvatar.out.parse(await logoResponse.json());
  expect(new URL(logoResponse.request().url()).searchParams.get("filename")).toBe("Logo原文 {file}.png");
  const appliedResponse = await logoApplied; expect(appliedResponse.status()).toBe(200);
  expect(appliedResponse.request().postDataJSON()).toEqual({ orgId, avatarArtifactId: logo.orgAvatarArtifactId });
  const organization = orgAdmin.operations.updateOrganization.out.parse(await appliedResponse.json());
  expect(organization.avatarUrl).not.toBeNull();
  const storedLogo = await page.request.get("/__fullstack_api" + organization.avatarUrl!, { headers });
  expect(storedLogo.status()).toBe(200); expect(await storedLogo.body()).toEqual(image);
  await expect(page.getByTestId("home-config-theme").locator("img")).toHaveJSProperty("naturalWidth", 32);
  const primary = "#1a2b3c";
  await page.getByLabel("Primary color value", { exact: true }).fill(primary);
  await page.getByTestId("home-config-banner-preset-custom").click();
  await page.getByTestId("home-config-banner-color-input").fill(primary);
  const rejected = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === bannerPath);
  await page.getByTestId("home-config-banner-file-input").setInputFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  expect((await rejected).ok()).toBe(false);
  await expect(page.getByTestId("home-config-banner-upload-error")).toContainText("Only PNG, JPEG, and WebP images are supported.");
  const postsBeforeLocale = bannerPosts;
  await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  await expect(page.getByTestId("home-config-banner-upload-error")).not.toContainText("Only PNG");
  await page.getByTestId("language-switcher").first().selectOption("en");
  await expect(page.getByTestId("home-config-banner-upload-error")).toContainText("Only PNG");
  expect(bannerPosts).toBe(postsBeforeLocale);
  const uploaded = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === bannerPath);
  await page.getByTestId("home-config-banner-file-input").setInputFiles({ name: "横幅原文 {file}.png", mimeType: "image/png", buffer: image });
  const uploadResponse = await uploaded; expect(uploadResponse.ok()).toBe(true);
  const banner = homeConfig.operations.uploadHomeBanner.out.parse(await uploadResponse.json());
  expect(new URL(uploadResponse.request().url()).searchParams.get("filename")).toBe("横幅原文 {file}.png");
  const storedBanner = await page.request.get("/__fullstack_api" + banner.bannerImageUrl, { headers });
  expect(storedBanner.status()).toBe(200); expect(await storedBanner.body()).toEqual(image);

  await page.getByTestId("home-config-tab-content").click();
  for (const item of before.recommendedAgents) await page.getByTestId("home-config-agent-remove-" + item.agentId).click();
  for (const item of before.recommendedCapabilities) await page.getByTestId("home-config-remove-" + item.kind + "-" + item.refId).click();
  await page.getByRole("button", { name: "Add agent", exact: true }).click();
  const agentChoice = page.getByTestId("home-config-picker-agent-" + agent!.agentId);
  await expect(agentChoice).toHaveText(agent!.name); await agentChoice.click();
  const agentNote = "数字人备注原文 {note}";
  await page.getByTestId("home-config-agent-note-" + agent!.agentId).fill(agentNote);
  await page.getByRole("button", { name: "Add skill", exact: true }).click();
  const skillChoice = page.getByTestId("home-config-picker-skill-" + skill!.skillId);
  await expect(skillChoice).toHaveText(skill!.name); await skillChoice.click();
  const skillNote = "Skill备注原文 {note}";
  await page.getByTestId("home-config-recommendation-note-skill-" + skill!.skillId).fill(skillNote);
  const readsBeforeLocale = { ...reads };
  expect(Object.values(readsBeforeLocale).every(count => count > 0)).toBe(true);
  await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  await page.getByTestId("language-switcher").first().selectOption("en");
  await expect(page.getByTestId("home-config-tab-content")).toHaveAttribute("aria-selected", "true");
  await expect(agentChoice).toHaveText("Added · " + agent!.name); await expect(agentChoice).toBeDisabled();
  await expect(skillChoice).toHaveText("Added · " + skill!.name); await expect(skillChoice).toBeDisabled();
  await expect(page.getByTestId("home-config-agent-note-" + agent!.agentId)).toHaveValue(agentNote);
  expect(reads).toEqual(readsBeforeLocale);

  const capture = async (label: string, tab: "edit" | "content" | "layout" | "preview", section: string) => {
    await expect(page).toHaveURL(/\/org-admin\/home-config$/);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByTestId("home-config-tabs").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("home-config-tab-" + tab)).toHaveAttribute("aria-selected", "true");
      expect(await page.getByTestId("home-config-tabs").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      for (const button of await page.getByTestId("home-config-tabs").getByRole("tab").all()) {
        expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByTestId(section).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("home-config-" + label + "-" + width + ".png"), fullPage: true });
    }
  };
  await expect(page.getByTestId("home-config-theme")).toBeHidden();
  await expect(page.getByTestId("home-config-quick-actions")).toBeHidden();
  await capture("content", "content", "home-config-agents");
  await page.getByTestId("home-config-tab-layout").click();
  await expect(page.getByTestId("home-config-theme")).toBeHidden();
  await expect(page.getByTestId("home-config-agents")).toBeHidden();
  await page.getByTestId("home-config-quick-action-chat").uncheck();
  await capture("layout", "layout", "home-config-quick-actions");
  await page.getByTestId("home-config-tab-edit").click();
  await expect(page.getByTestId("home-config-title")).toHaveValue(title);
  await expect(page.getByTestId("home-config-banner-tagline")).toHaveValue(tagline);
  await expect(page.getByLabel("Primary color value", { exact: true })).toHaveValue(primary);
  await capture("theme", "edit", "home-config-theme");
  await capture("banner", "edit", "home-config-banner-section");
  await page.getByTestId("home-config-tab-preview").click();
  const frame = page.getByTestId("home-config-preview-frame");
  await expect(frame).toHaveAttribute("inert");
  await expect(frame).toHaveAttribute("aria-label", "Home page preview");
  await expect(frame).toContainText(title); await expect(frame).toContainText(headline);
  const requestsBeforePreview = threadPosts;
  const previewLink = frame.locator("a").first();
  await expect(previewLink).toBeAttached();
  expect(await previewLink.evaluate(element => { (element as HTMLElement).focus(); return document.activeElement === element; })).toBe(false);
  await page.getByTestId("home-config-preview-back").focus(); await page.keyboard.press("Tab");
  expect(await frame.evaluate(element => element.contains(document.activeElement))).toBe(false);
  expect(threadPosts).toBe(requestsBeforePreview);
  await capture("preview", "preview", "home-config-preview");
  await page.setViewportSize({ width: 820, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("home-config-preview-820.png"), fullPage: true });
  const saved = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname === homePath);
  await page.getByTestId("home-config-preview-save").click();
  const saveResponse = await saved; expect(saveResponse.status()).toBe(200);
  const payload = homeConfig.operations.updateHomeConfig.in.omit({ orgId: true }).parse(saveResponse.request().postDataJSON());
  expect(payload).toMatchObject({
    title, bannerHeadline: headline, bannerTagline: tagline, bannerPreset: "custom", bannerColor: primary,
    bannerImageArtifactId: banner.bannerImageArtifactId, themeColors: { primary },
    recommendedAgents: [{ agentId: agent!.agentId, name: agent!.name, roleLabel: agent!.roleLabel, avatarKey: agent!.avatar?.key ?? null, note: agentNote }],
    recommendedCapabilities: [{ kind: "skill", refId: skill!.skillId, name: skill!.name, note: skillNote }],
  });
  expect(payload.quickActions.find(item => item.key === "chat")?.enabled).toBe(false);
  await expect(page.getByTestId("home-config-preview-status")).toHaveText("Saved");
  await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  await expect(page.getByTestId("home-config-preview-status")).toHaveText("已保存");
  await page.getByTestId("language-switcher").first().selectOption("en");
  await page.reload(); await expect(page.getByTestId("home-config-title")).toHaveValue(title);
  const persisted = homeConfig.HomeConfig.parse(await (await page.request.get(homePath, { headers })).json());
  expect(persisted).toMatchObject({ title, bannerHeadline: headline, bannerTagline: tagline, bannerColor: primary, themeColors: { primary } });
  expect(persisted.recommendedAgents).toEqual(payload.recommendedAgents);
  expect(persisted.recommendedCapabilities).toEqual(payload.recommendedCapabilities);

  const memberContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const member = await memberContext.newPage(); await login(member, false);
    const memberHeaders = await authorization(member);
    const readable = await member.request.get(homePath, { headers: memberHeaders });
    expect(readable.status()).toBe(200); expect(homeConfig.HomeConfig.parse(await readable.json())).toEqual(persisted);
    const forbidden = await member.request.put(homePath, { headers: memberHeaders, data: { ...payload, title: "Unauthorized edit" } });
    expect(forbidden.status()).toBe(403);
    expect(homeConfig.HomeConfig.parse(await (await page.request.get(homePath, { headers })).json())).toEqual(persisted);
    await member.goto("/org-admin/home-config"); await member.getByTestId("language-switcher").first().selectOption("en");
    await expect(member.getByTestId("home-config-screen").getByRole("alert")).toContainText("Only organization administrators can configure the home page.");
    await expect(member.getByTestId("home-config-form")).toHaveCount(0);
    await member.screenshot({ path: testInfo.outputPath("home-config-member-denied.png"), fullPage: true });
    await member.goto("/home");
    await expect(member.getByTestId("home-screen")).toContainText(title);
    await expect(member.getByTestId("home-screen")).toContainText(agent!.name);
    await expect(member.getByTestId("home-screen")).toContainText(skill!.name);
    await member.screenshot({ path: testInfo.outputPath("home-config-member-home.png"), fullPage: true });
  } finally { await memberContext.close(); }
});

test("workflow grant management persists canonical permissions and audit across locales with real member denial", async ({ page, browser }, testInfo) => {
  await login(page, true);
  const headers = await authorization(page);
  const listPath = "/__fullstack_api" + WG.operations.listWorkflowCapabilityGrants.path;
  const itemPath = listPath + "/artifact.write";
  const read = async () => {
    const response = await page.request.get(listPath, { headers });
    expect(response.status()).toBe(200);
    return WG.operations.listWorkflowCapabilityGrants.out.parse(await response.json());
  };
  // This tenant belongs to this registered fixture; establish a real read-only baseline.
  const baseline = await page.request.delete(itemPath, { headers });
  expect(baseline.status()).toBe(200);
  expect(WG.operations.revokeWorkflowCapabilityGrant.out.parse(await baseline.json())).toMatchObject({ capabilityCategory: "artifact.write", configured: false, authorized: true, sideEffectCap: "read" });
  const catalog = await read();
  expect(catalog.workflows.some(workflow => workflow.workflowId === "W029" && workflow.capabilities.some(capability => capability.capabilityCategory === "artifact.write"))).toBe(true);
  let reads = 0, writes = 0;
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === listPath) reads++;
    if (["PUT", "DELETE"].includes(request.method()) && path === itemPath) writes++;
  });
  await page.goto("/org-admin/workflow-grants?workflow=W029");
  const focused = page.getByTestId("workflow-grants-workflow-W029");
  await expect(focused).toHaveAttribute("data-focused", "true");
  await expect(focused).toBeFocused();
  const countsBeforeLocale = [reads, writes];
  expect(reads).toBeGreaterThan(0);
  await page.getByTestId("language-switcher").first().selectOption("en");
  await expect(page.getByRole("heading", { name: "Workflow permissions", exact: true })).toBeVisible();
  await expect(focused).toContainText("Problem to PRD");
  await expect(page.getByTestId("workflow-grants-tab-workflow")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  await expect(focused).toContainText("问题定义到 PRD");
  await page.getByTestId("language-switcher").first().selectOption("en");
  expect([reads, writes]).toEqual(countsBeforeLocale);
  const revealDialogFooter = async () => {
    const modal = page.getByTestId("workflow-grant-dialog");
    await modal.hover();
    await page.mouse.wheel(0, 1200);
    await expect(modal.getByTestId("workflow-grant-confirm")).toBeInViewport({ ratio: 1 });
    await expect(modal.getByTestId("workflow-grant-cancel")).toBeInViewport({ ratio: 1 });
  };
  const capture = async (state: string) => {
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      if (state === "workflow") await focused.scrollIntoViewIfNeeded();
      if (state === "capability") await page.getByTestId("workflow-grant-row-artifact.write").scrollIntoViewIfNeeded();
      if (state === "audit") await page.getByTestId("workflow-grants-audit").scrollIntoViewIfNeeded();
      if (state === "dialog" || state === "revoke") {
        const modal = page.getByTestId("workflow-grant-dialog");
        await modal.hover();
        await page.mouse.wheel(0, -5000);
        await expect(modal.getByRole("heading")).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: testInfo.outputPath("workflow-grants-" + state + "-top-" + width + ".png") });
        await revealDialogFooter();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("workflow-grants-" + state + "-" + width + ".png") });
    }
  };
  await capture("workflow");
  await page.getByTestId("workflow-grants-tab-capability").click();
  const artifact = page.getByTestId("workflow-grant-row-artifact.write");
  await expect(artifact).toContainText("Save output documents");
  await capture("capability");
  await artifact.getByTestId("workflow-grant-edit").click();
  const dialog = page.getByTestId("workflow-grant-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("workflow-grant-level-write").check();
  const beforeDialogLocale = [reads, writes];
  // A modal blocks the underlying header. Use the real cross-tab locale channel.
  const localePage = await page.context().newPage();
  try {
    await localePage.goto("/home");
    await localePage.getByTestId("language-switcher").first().selectOption("zh-CN");
    await expect(dialog).toContainText("调整「保存产出文档」权限");
    await expect(page.getByTestId("workflow-grant-level-write")).toBeChecked();
    await localePage.getByTestId("language-switcher").first().selectOption("en");
    await expect(dialog).toContainText("Adjust permission for Save output documents");
    await expect(page.getByTestId("workflow-grant-level-write")).toBeChecked();
  } finally { await localePage.close(); }
  expect([reads, writes]).toEqual(beforeDialogLocale);
  await capture("dialog");
  const beforeGrantEventIds = new Set(catalog.audit.map(event => event.eventId));
  const changed = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname === itemPath);
  await page.getByTestId("workflow-grant-confirm").click();
  const granted = await changed;
  expect(granted.status()).toBe(200);
  expect(WG.operations.setWorkflowCapabilityGrant.in.parse(granted.request().postDataJSON())).toEqual({ sideEffectCap: "write" });
  expect(WG.operations.setWorkflowCapabilityGrant.out.parse(await granted.json())).toMatchObject({ capabilityCategory: "artifact.write", configured: true, authorized: true, sideEffectCap: "write" });
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("workflow-grants-notice")).toContainText("Granted");
  await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  await expect(page.getByTestId("workflow-grants-notice")).toContainText("已授予「保存产出文档」可写入权限");
  await page.getByTestId("language-switcher").first().selectOption("en");
  const persisted = await read();
  expect(persisted.grants.find(grant => grant.capabilityCategory === "artifact.write")).toMatchObject({ configured: true, sideEffectCap: "write" });
  const grantEvent = persisted.audit.find(event => !beforeGrantEventIds.has(event.eventId) && event.capabilityCategory === "artifact.write" && event.action === "granted" && event.fromCap === "read" && event.toCap === "write" && event.actorId === ENTITY_LOCALIZATION_E2E.adminUserId);
  expect(grantEvent).toMatchObject({ actorId: ENTITY_LOCALIZATION_E2E.adminUserId });
  expect(Number.isFinite(Date.parse(grantEvent!.at))).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Workflow permissions", exact: true })).toBeVisible();
  await page.getByTestId("workflow-grants-tab-capability").click();
  await expect(artifact.getByTestId("workflow-grant-current")).toContainText("Write");
  expect((await read()).audit).toContainEqual(grantEvent);
  const audit = page.getByTestId("workflow-grants-audit");
  await expect(audit).toContainText("Granted");
  await expect(audit.getByTestId("workflow-grants-audit-actor").filter({ hasText: "Localization admin (me)" }).first()).toHaveText("Localization admin (me)");
  const localizedAuditTime = await page.evaluate(iso => new Intl.DateTimeFormat("en", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso)), grantEvent!.at);
  await expect(audit).toContainText(localizedAuditTime);
  await expect(audit).not.toContainText(ENTITY_LOCALIZATION_E2E.adminUserId);
  await audit.scrollIntoViewIfNeeded();
  await capture("audit");
  await artifact.getByTestId("workflow-grant-edit").click();
  await page.getByTestId("workflow-grant-level-read").check();
  await capture("revoke");
  const beforeRevokeEventIds = new Set(persisted.audit.map(event => event.eventId));
  const revoked = page.waitForResponse(response => response.request().method() === "DELETE" && new URL(response.url()).pathname === itemPath);
  await page.getByTestId("workflow-grant-confirm").click();
  const revokeResponse = await revoked;
  expect(revokeResponse.status()).toBe(200);
  expect(WG.operations.revokeWorkflowCapabilityGrant.out.parse(await revokeResponse.json())).toMatchObject({ capabilityCategory: "artifact.write", configured: false, sideEffectCap: "read" });
  await expect(page.getByTestId("workflow-grants-notice")).toContainText("Revoked");
  const restored = await read();
  const revokeEvent = restored.audit.find(event => !beforeRevokeEventIds.has(event.eventId) && event.capabilityCategory === "artifact.write" && event.action === "revoked" && event.fromCap === "write" && event.toCap === "read" && event.actorId === ENTITY_LOCALIZATION_E2E.adminUserId);
  expect(revokeEvent).toMatchObject({ actorId: ENTITY_LOCALIZATION_E2E.adminUserId });
  expect(Number.isFinite(Date.parse(revokeEvent!.at))).toBe(true);
  await page.reload();
  await page.getByTestId("workflow-grants-tab-capability").click();
  await expect(artifact.getByTestId("workflow-grant-current")).toContainText("Read-only");
  expect((await read()).audit).toContainEqual(revokeEvent);
  const memberContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const member = await memberContext.newPage();
    await login(member, false);
    const memberHeaders = await authorization(member);
    expect((await member.request.get(listPath, { headers: memberHeaders })).status()).toBe(403);
    expect((await member.request.put(itemPath, { headers: memberHeaders, data: { sideEffectCap: "external_send" } })).status()).toBe(403);
    expect((await member.request.delete(itemPath, { headers: memberHeaders })).status()).toBe(403);
    let memberReads = 0;
    member.on("request", request => { if (request.method() === "GET" && new URL(request.url()).pathname === listPath) memberReads++; });
    await member.goto("/org-admin/workflow-grants");
    await member.getByTestId("language-switcher").first().selectOption("en");
    await expect(member.getByTestId("denied-layer")).toContainText("Only organization administrators");
    await member.screenshot({ path: testInfo.outputPath("workflow-grants-member-denied-375.png") });
    await member.getByTestId("language-switcher").first().selectOption("zh-CN");
    await expect(member.getByTestId("denied-layer")).toContainText("仅组织管理员");
    expect(memberReads).toBe(0);
    const afterDenied = await read();
    expect(afterDenied.grants).toEqual(restored.grants);
    expect(afterDenied.audit).toEqual(restored.audit);
  } finally { await memberContext.close(); }
});
