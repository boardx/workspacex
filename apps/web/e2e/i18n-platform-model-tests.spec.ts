/** Actual historical API prerequisite only: no UI paid start, vendor invocation,
 * financial reservation, receipt, settlement or configured-form native claim.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Locator, type APIResponse } from "@playwright/test";
import { auth, platformMembers as PM, platformOrganizations as PO } from "@repo/contracts";
import { operations as MT } from "@repo/contracts/platform-model-test";
import { ENTITY_LOCALIZATION_E2E as E, PLATFORM_MEMBERS_E2E as F } from "./entity-localization-fixture";

const prefix = "/__fullstack_api";
const route = "/platform-admin/model-tests";
const candidatePath = prefix + MT.candidates.path;
const organizationPath = prefix + PO.operations.listOrganizations.path;
const grantPath = prefix + PM.operations.grantPlatformAdmin.path.replace(":userId", encodeURIComponent(F.targetId));
const preparation = (page: Page) => page.getByRole("region", { name: /^(?:Prepare a test|准备测试)$/ });
const results = (page: Page) => page.getByRole("region", { name: /^(?:Execution and settlement results|执行与结算结果)$/ });
const organization = (page: Page) => page.getByRole("button", { name: /^(?:Test organization|测试所属组织)$/ });
const search = (page: Page) => page.getByRole("textbox", { name: /^(?:Search test organizations|搜索测试组织)$/ });
const recovery = (page: Page) => page.locator("#test-recovery-id");
const recoverButton = (page: Page) => page.getByRole("button", { name: /^(?:Recover original test \(query only\)|恢复原测试（仅查询）)$/ });
const queryButton = (page: Page) => page.getByRole("button", { name: /^(?:Query original test status|查询原测试状态)$/ });
const cancelButton = (page: Page) => page.getByRole("button", { name: /^(?:Cancel this test|取消本次测试)$/ });
const prepareButton = (page: Page) => page.getByRole("button", { name: /^(?:Prepare a new test|准备新测试)$/ });
const hold = (page: Page) => page.getByRole("checkbox", { name: /^(?:Confirm previous test reservation remains held|确认旧测试预留仍保留)$/ });
const previous = (page: Page) => page.getByRole("region", { name: /^(?:Previous tests|之前测试)$/ });
const recordPath = (id: string) => prefix + MT.get.path.replace(":testId", encodeURIComponent(id));
const cancelPath = (id: string) => prefix + MT.cancel.path.replace(":testId", encodeURIComponent(id));
const permissionCopy = "Platform operator permission and real membership in the selected organization are required. Platform permission does not exempt the organization budget.";
const missingCopy = "The test record or test service is unavailable. Check the environment.";
const financialCautionCopy = "Costs or results are unconfirmed; the budget reservation remains held. Querying the original record does not make a new model call. A new test still requires cost confirmation and does not release this reservation.";
const chineseFinancialCautionCopy = "费用或结果尚未确认，预算预留继续保留。查询原记录不会产生新的模型调用；新测试仍需重新确认费用，且不会释放此预留。";

test("model testbench preserves actual unavailable-adapter history across locales and operator boundaries", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  // Canonical config must retain expect20s, worker1/retry0/maxFailures1 and original startup.
  // Scope execution with --no-deps; do not import another spec or change its cases.
  const receipts: { operation: string; status: number; body: unknown }[] = [];
  async function responseBody(response: APIResponse, status: number, operation: string) {
    const body: unknown = await response.json();
    receipts.push({ operation, status: response.status(), body });
    expect(response.status(), operation).toBe(status);
    return body;
  }
  async function login(actorPage: Page, actor: "superuser" | "target" | "ordinary") {
    const ordinary = actor === "ordinary", superuser = actor === "superuser";
    const email = ordinary ? E.adminEmail : superuser ? F.superuserEmail : F.targetEmail;
    const password = ordinary || superuser ? E.adminPassword : E.memberPassword;
    await actorPage.goto("/login");
    await actorPage.getByTestId("login-email").fill(email);
    await actorPage.getByTestId("login-password").fill(password);
    const pending = actorPage.waitForResponse(response => response.request().method() === auth.operations.login.method && new URL(response.url()).pathname === prefix + auth.operations.login.path);
    await actorPage.getByTestId("login-submit").click();
    const response = await pending; expect(response.status()).toBe(200);
    const authenticated = auth.operations.login.out.parse(await response.json());
    expect(authenticated.userId).toBe(ordinary ? E.adminUserId : superuser ? F.superuserId : F.targetId);
    // seed-entity-localization.ts adds the ordinary admin only to E.orgId;
    // its separate platform fixture adds the SS/target to both normal organizations.
    expect([...authenticated.orgs].sort()).toEqual(ordinary ? [E.orgId] : [F.orgAId, F.orgBId].sort());
    await expect(actorPage).toHaveURL(/\/home$/);
    // Same actual signed-session pattern as parent journey. Never print/attach token or login body.
    const token = await actorPage.evaluate(() => localStorage.getItem("wsx.sessionToken"));
    expect(token).toBeTruthy();
    return { Authorization: `Bearer ${token}` };
  }
  const headers = await login(page, "superuser");
  const testId = randomUUID();
  const request = MT.start.in.parse({ testId, orgId: F.orgAId,
    modelId: `model-i18n-unregistered-${testId}`, capability: "text", declaredNonConfidential: true,
    input: { prompt: "Non-confidential i18n historical prerequisite 原文 {prompt}" },
    bounds: { maximumCostMicros: "1", timeoutMs: 1, maxOutputTokens: 1 },
  });
  const startResponse = await page.request.post(prefix + MT.start.path, { headers, data: request });
  const baseline = MT.start.out.parse(await responseBody(startResponse, 201, "protected unavailable-adapter historical prerequisite"));
  expect(baseline).toMatchObject({ testId, orgId: request.orgId, modelId: request.modelId, capability: "text", state: "failed", failureReason: "adapter-unavailable", result: null, usage: null });
  // No physical receipt means repository normally preserves pending. Follow actual public response.
  expect(["held", "pending"]).toContain(baseline.settlementState);
  const readOriginal = async () => {
    const response = await page.request.get(recordPath(testId), { headers, params: { orgId: F.orgAId } });
    const record = MT.get.out.parse(await responseBody(response, 200, "independent original GET"));
    expect(record).toEqual(baseline);
    return record;
  };
  await readOriginal();

  const uiRequests: { method: string; path: string; orgId: string | null }[] = [];
  const observe = (actorPage: Page) => actorPage.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith(prefix + MT.start.path) || url.pathname === organizationPath)
      uiRequests.push({ method: request.method(), path: url.pathname, orgId: url.searchParams.get("orgId") });
  });
  observe(page);
  const helper = await page.context().newPage(); await helper.goto("/home");
  const locale = async (value: "en" | "zh-CN") => {
    const before = [...uiRequests];
    const identityInput = await recovery(page).elementHandle(); expect(identityInput).not.toBeNull();
    const oldValue = await recovery(page).inputValue();
    const oldSearch = await search(page).inputValue();
    const oldOrganization = await organization(page).textContent();
    const disabled = await recovery(page).isDisabled();
    const retainedControls = await Promise.all([
      search(page).elementHandle(),
      organization(page).elementHandle(), recoverButton(page).elementHandle(),
    ]);
    await helper.getByTestId("language-switcher").first().selectOption(value);
    await expect(page.locator("html")).toHaveAttribute("lang", value);
    await expect(preparation(page)).toBeVisible();
    expect(await identityInput!.evaluate(node => node === document.getElementById("test-recovery-id"))).toBe(true);
    await expect(recovery(page)).toHaveValue(oldValue);
    expect(await recovery(page).isDisabled()).toBe(disabled);
    expect(await search(page).inputValue()).toBe(oldSearch);
    expect(await organization(page).textContent()).toBe(oldOrganization);
    for (const control of retainedControls) {
      expect(control).not.toBeNull(); expect(await control!.evaluate(node => node.isConnected)).toBe(true);
      await control!.dispose();
    }
    expect(uiRequests).toEqual(before); // Includes candidates GET, history GET, start and cancel.
    await identityInput!.dispose();
  };
  const uiResponse = (actorPage: Page, path: string) => actorPage.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === path);
  async function enter(actorPage: Page, denied = false) {
    const pending = uiResponse(actorPage, organizationPath);
    await actorPage.goto(route);
    const response = await pending; const body: unknown = await response.json();
    receipts.push({ operation: "native organization list", status: response.status(), body });
    expect(response.status()).toBe(denied ? 403 : 200);
    if (denied) expect(body).toMatchObject({ reasonCode: "NOT_PLATFORM_SUPERUSER" });
    else {
      const organizations = PO.operations.listOrganizations.out.parse(body);
      expect(organizations.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ orgId: F.orgAId, name: F.orgAName }), expect.objectContaining({ orgId: F.orgBId, name: F.orgBName })]));
    }
  }
  async function chooseOrg(actorPage: Page) {
    await organization(actorPage).click();
    const pending = uiResponse(actorPage, candidatePath);
    await actorPage.getByRole("menuitemradio", { name: F.orgAName, exact: true }).click();
    const response = await pending; expect(response.status()).toBe(200);
    expect(new URL(response.url()).searchParams.get("orgId")).toBe(F.orgAId);
    const candidates = MT.candidates.out.parse(await response.json());
    receipts.push({ operation: "native candidates", status: response.status(), body: candidates });
    expect(candidates.every(candidate => !candidate.available)).toBe(true);
    await expect(organization(actorPage)).toContainText(F.orgAName);
    await expect(actorPage.locator("#test-prompt")).toHaveCount(0);
    if (candidates.length === 0) await expect(preparation(actorPage)).toContainText(/No testable models\. Configure organization models and budget first\.|没有可测试模型，请先配置组织模型与预算。/);
    for (const candidate of candidates) {
      await expect(preparation(actorPage)).toContainText(candidate.modelId);
      const candidateButtons = preparation(actorPage).getByRole("button", { name: new RegExp(candidate.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
      await expect(candidateButtons.first()).toBeVisible();
      for (const button of await candidateButtons.all())
        await expect(button).toBeDisabled();
    }
    return candidates;
  }
  async function nativeRead(actorPage: Page, control: Locator, expectedStatus: number) {
    const before = uiRequests.length;
    const pending = uiResponse(actorPage, recordPath(testId));
    await control.click();
    const response = await pending; const body: unknown = await response.json();
    receipts.push({ operation: "native original UUID GET", status: response.status(), body });
    expect(response.status()).toBe(expectedStatus);
    expect(new URL(response.url()).searchParams.get("orgId")).toBe(F.orgAId);
    if (expectedStatus === 200) expect(MT.get.out.parse(body)).toEqual(baseline);
    else expect(body).toMatchObject({ reasonCode: "TEST_NOT_FOUND" });
    await expect(control).toBeDisabled(); // Recovery remains disabled once original attempt is owned.
    expect(uiRequests.slice(before)).toEqual([{ method: "GET", path: recordPath(testId), orgId: F.orgAId }]);
  }
  // Inspect each warning, label and control locally by native scrolling. Long sections need not
  // fit a viewport; screenshot focus is the pertinent recovery/result/history/error subsection.
  async function capture(actorPage: Page, state: string, focus: Locator, context: Locator[] = []) {
    for (const width of [375, 1280]) {
      await actorPage.setViewportSize({ width, height: 900 });
      const section = focus.locator("xpath=ancestor-or-self::section[1]");
      for (const item of await section.locator("p,label,h2,h3,input,textarea,button").all()) {
        if (!await item.isVisible()) continue;
        await item.scrollIntoViewIfNeeded();
        await expect(item).toBeInViewport({ ratio: 1 });
        const bounds = await item.boundingBox(); expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
        // Native wrapping/scrolling checks do not modify page style or substitute controls.
        if (!await item.evaluate(element => element.matches("input,textarea")))
          expect(await item.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
      // Each screenshot has an explicit local focus; recovered summary and financial
      // caution are separate images, so no whole long result card must fit at once.
      await focus.scrollIntoViewIfNeeded(); await expect(focus).toBeInViewport({ ratio: 1 });
      for (const item of context) await expect(item).toBeInViewport({ ratio: 1 });
      expect(await actorPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await actorPage.screenshot({ path: testInfo.outputPath(`model-tests-${state}-${width}.png`) });
    }
  }
  async function deniedApi(actorPage: Page, actorHeaders: typeof headers, status: 403 | 404) {
    const expectedReason = status === 404 ? "TEST_NOT_FOUND" : "NOT_PLATFORM_SUPERUSER";
    if (status === 403) {
      const response = await actorPage.request.get(candidatePath, { headers: actorHeaders, params: { orgId: F.orgAId } });
      expect(await responseBody(response, 403, "denied candidates")).toMatchObject({ reasonCode: expectedReason });
    }
    const response = await actorPage.request.get(recordPath(testId), { headers: actorHeaders, params: { orgId: F.orgAId } });
    expect(await responseBody(response, status, "denied foreign original GET")).toMatchObject({ reasonCode: expectedReason });
    const cancel = await actorPage.request.post(cancelPath(testId), { headers: actorHeaders, data: MT.cancel.in.parse({ orgId: F.orgAId }) });
    expect(await responseBody(cancel, status, "denied foreign cancellation")).toMatchObject({ reasonCode: expectedReason });
    await readOriginal();
  }
  const foreignContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const ordinaryContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  let outstandingGrant = false;
  try {
    await enter(page); await chooseOrg(page);
    await recovery(page).fill(testId);
    await locale("en"); await capture(page, "preparation-en", page.getByRole("form", { name: "Recover an existing test", exact: true }));
    await locale("zh-CN"); await capture(page, "preparation-zh", page.getByRole("form", { name: "恢复已有测试" }));
    await nativeRead(page, recoverButton(page), 200);
    await expect(results(page).getByRole("status")).toHaveText("执行失败");
    await expect(cancelButton(page)).toBeDisabled(); await expect(prepareButton(page)).toBeDisabled();
    await expect(recovery(page)).toHaveValue(testId);
    await locale("en");
    await expect(results(page).getByRole("status")).toHaveText("Execution failed");
    await expect(results(page)).toContainText(financialCautionCopy);
    await expect(results(page)).toContainText("Status reason: This capability is not yet adapted");
    await expect(results(page)).toContainText(`Settlement: ${baseline.settlementState === "held" ? "Costs held, awaiting reconciliation" : "Pending settlement"}`);
    await expect(results(page)).toContainText("A cancellation request does not prove the provider has not executed or billed the call. Leaving the page only stops browser queries; it does not automatically cancel the provider call.");
    await expect(results(page)).toContainText("Cost: Unknown · Currency: Unknown");
    const captureRecovered = async (language: "en" | "zh") => {
      const uuidSummary = results(page).locator("p.break-all").first();
      await expect(uuidSummary).toContainText(testId);
      await capture(page, `recovered-summary-${language}`, uuidSummary, [results(page).getByRole("status"), queryButton(page), cancelButton(page)]);
      const caution = results(page).getByText(language === "en" ? financialCautionCopy : chineseFinancialCautionCopy, { exact: true });
      await capture(page, `recovered-financial-caution-${language}`, caution);
    };
    await captureRecovered("en");
    await locale("zh-CN"); await captureRecovered("zh");
    await locale("en"); await expect(cancelButton(page)).toBeDisabled();
    const pendingQuery = uiResponse(page, recordPath(testId)); await queryButton(page).click();
    const query = await pendingQuery; expect(query.status()).toBe(200);
    const queryBody: unknown = await query.json(); receipts.push({ operation: "native query original", status: query.status(), body: queryBody });
    expect(MT.get.out.parse(queryBody)).toEqual(baseline);
    await expect(queryButton(page)).toBeEnabled();
    await hold(page).check();
    const beforePrepare = [...uiRequests]; await prepareButton(page).click();
    await expect(recovery(page)).toHaveValue(""); await expect(previous(page)).toContainText(testId);
    expect(uiRequests).toEqual(beforePrepare);
    const previousQuery = previous(page).getByRole("button", { name: `Query previous test ${testId.slice(0, 8)}`, exact: true });
    const historyPending = uiResponse(page, recordPath(testId)); await previousQuery.click();
    const history = await historyPending; expect(history.status()).toBe(200);
    const historyBody: unknown = await history.json(); receipts.push({ operation: "native previous original", status: history.status(), body: historyBody });
    expect(MT.get.out.parse(historyBody)).toEqual(baseline);
    await expect(previousQuery).toBeEnabled();
    await capture(page, "previous-history-en", previous(page));
    expect(uiRequests.filter(request => request.method !== "GET")).toEqual([]);

    const ordinary = await ordinaryContext.newPage(); observe(ordinary);
    const ordinaryHeaders = await login(ordinary, "ordinary");
    await deniedApi(ordinary, ordinaryHeaders, 403); await enter(ordinary, true);
    await ordinary.getByTestId("language-switcher").first().selectOption("en");
    await expect(ordinary.getByTestId("err-test")).toHaveText(permissionCopy);
    await capture(ordinary, "ordinary-403-en", ordinary.getByTestId("err-test"));

    const initialAccess = await page.request.get(prefix + PM.operations.listPlatformMembers.path, { headers });
    const initialRoster = PM.operations.listPlatformMembers.out.parse(await responseBody(initialAccess, 200, "initial target authority"));
    const target = initialRoster.members.find(member => member.userId === F.targetId);
    // Fail before a grant if another run already owns target authority. Never revoke
    // an unexpected preexisting grant merely to satisfy this journey's prerequisite.
    expect(target).toMatchObject({ platformAdmin: false, platformSuperuser: false });
    expect(target!.memberships.map(member => member.orgId).sort()).toEqual([F.orgAId, F.orgBId].sort());
    const granted = await page.request.post(grantPath, { headers, data: PM.operations.grantPlatformAdmin.in.parse({ userId: F.targetId }) });
    if (granted.status() === 201) outstandingGrant = true;
    expect(PM.operations.grantPlatformAdmin.out.parse(await responseBody(granted, 201, "actual authority prerequisite"))).toEqual({ userId: F.targetId, platformAdmin: true });
    const foreign = await foreignContext.newPage(); observe(foreign);
    const foreignHeaders = await login(foreign, "target");
    await deniedApi(foreign, foreignHeaders, 404);
    await enter(foreign); await chooseOrg(foreign);
    await foreign.getByTestId("language-switcher").first().selectOption("en");
    await recovery(foreign).fill(testId); await nativeRead(foreign, recoverButton(foreign), 404);
    await expect(foreign.getByTestId("err-test")).toHaveText(missingCopy);
    await expect(recovery(foreign)).toHaveValue(testId);
    await capture(foreign, "foreign-owner-404-en", results(foreign));
    const revoke = await page.request.delete(grantPath, { headers });
    expect(PM.operations.revokePlatformAdmin.out.parse(await responseBody(revoke, 200, "observed authority revocation"))).toEqual({ userId: F.targetId, platformAdmin: false });
    outstandingGrant = false;
    await deniedApi(foreign, foreignHeaders, 403);
    const deniedReload = uiResponse(foreign, organizationPath); await foreign.reload();
    const denied = await deniedReload; expect(denied.status()).toBe(403);
    const deniedBody: unknown = await denied.json(); receipts.push({ operation: "native revoked reload organization denial", status: denied.status(), body: deniedBody });
    expect(deniedBody).toMatchObject({ reasonCode: "NOT_PLATFORM_SUPERUSER" });
    await expect(foreign.getByTestId("err-test")).toHaveText(permissionCopy);
    await capture(foreign, "revoked-403-en", foreign.getByTestId("err-test"));
    await readOriginal();
    expect(uiRequests.filter(request => request.method !== "GET")).toEqual([]);
  } finally {
    // Restore outstanding temporary grant independently from observed outcome assertions.
    // The immutable historical record has no delete API; dispose with the isolated DB stack.
    try {
      if (outstandingGrant) {
        const cleanup = await page.request.delete(grantPath, { headers });
        expect(PM.operations.revokePlatformAdmin.out.parse(await responseBody(cleanup, 200, "cleanup-only outstanding grant revoke"))).toEqual({ userId: F.targetId, platformAdmin: false });
      }
    } finally {
      await foreignContext.close(); await ordinaryContext.close(); await helper.close();
      // Private test output only; never attach signed auth/login responses, headers or traces.
      await testInfo.attach("private-model-test-api-receipts", { body: JSON.stringify({ receipts, uiRequests }), contentType: "application/json" });
    }
  }
});
