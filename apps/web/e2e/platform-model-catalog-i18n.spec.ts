/** Source-integrated native acceptance for issue #6255; runtime evidence is supplied separately.
 * Reuses real seeded actors and canonical contracts; never installs provider/auth fixtures.
 * Authenticated runner reports/traces remain private; PNGs require individual visual QA.
 */
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { auth, agentRuntime as M } from "@repo/contracts";
import { operations as C } from "@repo/contracts/organization-core-model";
import { bailianModelCatalog } from "@repo/contracts/bailian-model-catalog";
import { ENTITY_LOCALIZATION_E2E as E, PLATFORM_MEMBERS_E2E as P } from "./entity-localization-fixture";

// Independent exact English expectations from the frozen source, not imported from implementation.
// Never used as canonical model/tag/filter values.
const EN = {
  organization: "Organization model pool", public: "Bailian public catalog",
  title: "Model management", local: "local demo, not saved to the backend",
  coreDenied: "Only current organization administrators can set the core model.",
  next: "Next page", previous: "Previous page", sources: "Official sources",
  capability: "Text generation", refresh: "Refresh configuration and candidates",
  publicPrice: "Unverified; cannot be used for quotes or cost reservations",
};
const prefix = "/__fullstack_api";
const modelPath = prefix + M.operations.listModelPool.path;
const corePath = prefix + C.get.path;
const candidatesPath = prefix + C.candidates.path;
const readPaths = new Set([modelPath, corePath, candidatesPath]);

async function login(page: Page, actor: "superuser" | "member") {
  const superuser = actor === "superuser";
  await page.goto("/login");
  await page.getByTestId("login-email").fill(superuser ? P.superuserEmail : E.memberEmail);
  await page.getByTestId("login-password").fill(superuser ? E.adminPassword : E.memberPassword);
  const response = page.waitForResponse(r => r.request().method() === auth.operations.login.method &&
    new URL(r.url()).pathname === prefix + auth.operations.login.path).then(async actual => {
    expect(actual.status()).toBe(200);
    // Consume the body before navigation can release its CDP response resource.
    // Never assert/attach/log a full auth result, storage, request, cookie or header.
    return auth.operations.login.out.safeParse(await actual.json());
  });
  const [parsed] = await Promise.all([response, page.getByTestId("login-submit").click()]);
  expect(parsed.success, "real login must satisfy canonical contract").toBe(true);
  if (!parsed.success) throw new Error("login contract mismatch");
  expect(parsed.data.userId).toBe(superuser ? P.superuserId : E.memberUserId);
  expect([...parsed.data.orgs].sort()).toEqual(superuser ? [P.orgAId, P.orgBId].sort() : [E.orgId]);
  await expect(page).toHaveURL(/\/home$/);
}

/** Independent real API read in the browser. Token stays inside the page closure. */
async function read(page: Page, path: string) {
  return page.evaluate(async url => {
    const token = localStorage.getItem("wsx.sessionToken");
    if (!token) throw new Error("missing real authenticated session");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() as unknown };
  }, path);
}
function denied(result: Awaited<ReturnType<typeof read>>) {
  expect(result.status).toBe(403);
  expect(result.body).toMatchObject({ reasonCode: "NOT_ORG_ADMIN" });
}
function observe(page: Page) {
  const counts = { reads: 0, writes: 0 };
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (!readPaths.has(path) && !path.startsWith(modelPath + "/")) return;
    if (request.method() === "GET") counts.reads++; else counts.writes++;
  });
  return counts;
}
async function localeHelper(page: Page) {
  const helper = await page.context().newPage();
  try { await helper.goto("/home"); } catch (error) { await helper.close(); throw error; }
  return {
    close: () => helper.close(),
    set: async (value: "en" | "zh-CN") => {
      await helper.getByTestId("language-switcher").first().selectOption(value);
      await expect(page.locator("html")).toHaveAttribute("lang", value);
    },
  };
}
async function roundTrip(page: Page, helper: Awaited<ReturnType<typeof localeHelper>>, counts: ReturnType<typeof observe>,
  chinese: () => Promise<void>, english: () => Promise<void>) {
  const before = { ...counts };
  await helper.set("zh-CN"); await chinese();
  await helper.set("en"); await english();
  expect(counts).toEqual(before);
}

/** Native scroll each relevant visible control/text independently. A long panel is never shrunk to fit.
 * No style edits, forced clicks, fullPage screenshots, hidden layout assertions or arbitrary shot count.
 */
type GeometrySnapshot = {
  target: number[]; card: number[]; scrollport: number[];
  scrollTop: number; clientHeight: number; scrollHeight: number; viewport: number[];
};
type ScrollReceipt = { controlIndex: number; before: GeometrySnapshot; after: GeometrySnapshot };
// Values in this private receipt are geometry only; indices follow audit then anchor traversal.
// Before/after snapshots bracket this same node's native instant centering.
async function position(node: Locator, receipts: ScrollReceipt[]) {
  const geometry = await node.evaluate(el => {
    const card = el.closest('[role="button"][data-testid^="bailian-model-"], [role="button"][data-testid^="admin-model-card-"]');
    let scrollport = el.parentElement;
    while (scrollport && !/(auto|scroll|overlay)/.test(getComputedStyle(scrollport).overflowY)) {
      scrollport = scrollport.parentElement;
    }
    const port = scrollport ?? document.documentElement;
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect();
      return [r.left, r.top, r.right, r.bottom, r.width, r.height];
    };
    const snapshot = () => ({
      target: rect(el), card: card ? rect(card) : [], scrollport: rect(port),
      scrollTop: port.scrollTop, clientHeight: port.clientHeight, scrollHeight: port.scrollHeight,
      viewport: [innerWidth, innerHeight],
    });
    const before = snapshot();
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const after = snapshot();
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, fits: el.scrollWidth <= el.clientWidth + 1, width: innerWidth, before, after };
  });
  receipts.push({ controlIndex: receipts.length, before: geometry.before, after: geometry.after });
  return geometry;
}
async function audit(page: Page, scope: Locator, receipts: ScrollReceipt[]) {
  const relevant = scope.locator("button,input,select,textarea,a,h1,h2,h3,p,label,legend,[role=button],[role=radio],[role=tab],[role=menuitemradio],[role=checkbox],[role=switch],dt,dd");
  for (const node of await relevant.all()) {
    if (!await node.isVisible()) continue;
    const geometry = await position(node, receipts);
    await expect(node).toBeInViewport({ ratio: 1 });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width);
    expect(geometry.fits).toBe(true);
    // Leaf spans cover badge/count/metadata text without requiring a whole long parent to fit.
  }
  for (const text of await scope.locator("span").all()) {
    if (!await text.isVisible() || await text.locator("*").count() || !(await text.textContent())?.trim()) continue;
    const geometry = await position(text, receipts);
    await expect(text).toBeInViewport({ ratio: 1 });
    expect(geometry.left >= 0 && geometry.right <= geometry.width && geometry.fits).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function shots(page: Page, info: TestInfo, name: string, scope: Locator, top: Locator, bottom?: Locator) {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const receipts: ScrollReceipt[] = [];
    try {
      await audit(page, scope, receipts);
      await position(top, receipts); await expect(top).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: info.outputPath(`model-catalog-${name}-top-${width}.png`) });
      if (bottom) {
        await position(bottom, receipts); await expect(bottom).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`model-catalog-${name}-bottom-${width}.png`) });
      }
    } finally {
      await info.attach("private-native-scroll-geometry", { body: JSON.stringify(receipts), contentType: "application/json" });
    }
  }
}

test("model pool preserves actual read results and registration drafts across language events", async ({ page }, info) => {
  await login(page, "superuser");
  const counts = observe(page), helper = await localeHelper(page);
  try {
    const [poolResponse, coreResponse, candidatesResponse] = await Promise.all([
      read(page, modelPath), read(page, corePath), read(page, candidatesPath),
    ]);
    // Read failure is evidence, never a reason to install a provider or fabricate an enabled row.
    expect(coreResponse.status).toBe(200); expect(candidatesResponse.status).toBe(200);
    const core = C.get.out.parse(coreResponse.body), candidates = C.candidates.out.parse(candidatesResponse.body);
    expect([200, 503]).toContain(poolResponse.status);
    const rows = poolResponse.status === 200 ? M.operations.listModelPool.out.parse(poolResponse.body) : null;
    if (!rows) expect(poolResponse.body).toMatchObject({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    await page.goto("/platform-admin/model"); await helper.set("en");
    await expect(page.getByRole("heading", { name: EN.title, exact: true })).toBeVisible();
    const panel = page.getByTestId("org-core-model-panel");
    await expect(panel.getByTestId("loading")).toHaveCount(0);
    await expect(panel.getByTestId("err-core-model")).toHaveCount(0);
    await expect(panel.getByRole("heading", { name: "Organization core model", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: EN.refresh, exact: true })).toBeEnabled();
    await expect(panel).toContainText("Saving the selection does not test a model or enable a provider.");
    await expect(panel).toContainText(`Configuration version ${core.version}`);
    if (!candidates.length) await expect(panel.getByTestId("empty")).toBeVisible();
    for (const candidate of candidates) {
      const button = panel.getByRole("button", { name: `Select ${candidate.displayName}`, exact: true });
      if (candidate.available) await expect(button).toBeEnabled(); else await expect(button).toBeDisabled();
    }
    const reason = panel.locator("textarea");
    await reason.fill("保留原文 {core-reason} — draft only");
    const available = candidates.find(row => row.available);
    if (available) await panel.getByRole("button", { name: `Select ${available.displayName}`, exact: true }).click();
    await roundTrip(page, helper, counts, async () => {
      await expect(panel).toContainText("组织核心模型");
    }, async () => {
      await expect(panel).toContainText("Organization core model");
      await expect(reason).toHaveValue("保留原文 {core-reason} — draft only");
      if (available) await expect(panel.getByRole("button", { name: `Select ${available.displayName}`, exact: true })).toHaveAttribute("aria-pressed", "true");
    });
    await shots(page, info, "core-actual-state", panel, panel.getByRole("heading").first());
    const catalog = page.getByTestId("admin-model-catalog");
    if (rows) {
      await expect(page.getByTestId("admin-model-list")).toHaveCount(rows.length ? 1 : 0);
      if (!rows.length) await expect(page.getByTestId("admin-model-empty")).toBeVisible();
      for (const row of rows) await expect(page.getByTestId(`admin-model-card-${row.modelId}`)).toBeVisible();
      if (rows.length) {
        const row = rows[0];
        if (!row) throw new Error("Nonempty model pool has no first row");
        const search = page.getByTestId("admin-model-search");
        await search.fill(row.modelId);
        const tag = page.getByTestId(`admin-model-tag-${row.kind}`);
        await tag.click();
        await page.getByTestId(`admin-model-card-${row.modelId}`).click();
        const detail = page.getByTestId("admin-model-detail");
        await expect(detail).toContainText(row.modelId); await expect(detail).toContainText(row.vendor);
        await expect(detail).toContainText(row.unitPrice > 0 ? `￥${row.unitPrice} / 1k` : "Unpriced");
        await expect(detail).toContainText(EN.local);
        await roundTrip(page, helper, counts, async () => { await expect(detail).toContainText("模型 ID"); },
          async () => { await expect(detail).toContainText("Model ID"); await expect(detail).toContainText(row.modelId); });
        await page.getByTestId("admin-model-detail-close").click();
        await expect(search).toHaveValue(row.modelId); await expect(tag).toHaveAttribute("aria-pressed", "true");
        await search.fill(""); await page.getByTestId("admin-model-tag-all").click();
      }
    } else {
      await expect(page.getByTestId("admin-model-error")).toContainText("DEPENDENCY_UNAVAILABLE");
      await expect(page.getByTestId("admin-model-list")).toHaveCount(0);
    }
    await shots(page, info, rows?.length ? "actual-pool" : rows ? "empty-pool" : "pool-error", catalog,
      page.getByTestId("admin-model-add"));
    await page.getByTestId("admin-model-add").click();
    const drawer = page.getByTestId("admin-model-panel"), save = page.getByTestId("admin-model-panel-save");
    await expect(drawer.getByRole("heading", { name: "Register model", exact: true })).toBeVisible();
    await expect(page.getByTestId("admin-model-panel-close")).toHaveAccessibleName("Close");
    await expect(page.getByTestId("admin-model-panel-cancel")).toHaveText("Cancel");
    await expect(save).toHaveText("Register (mark untested)");
    await expect(save).toBeDisabled();
    await page.locator("#admin-model-field-name").fill("原文 {model-draft}");
    await page.locator("#admin-model-field-vendor").fill("原文 {vendor-draft}");
    await page.locator("#admin-model-field-endpoint").fill("https://example.invalid/raw-endpoint");
    await page.getByTestId("admin-model-tag-input").fill("raw-capability");
    await page.locator("#admin-model-field-context").fill("0"); await expect(save).toBeDisabled();
    await page.locator("#admin-model-field-context").fill("128000");
    await page.locator("#admin-model-field-price").fill("-1"); await expect(save).toBeDisabled();
    await page.locator("#admin-model-field-price").fill("0.001"); await expect(save).toBeEnabled();
    await page.getByTestId("admin-model-field-kind-self-hosted").click();
    const kindClass = await page.getByTestId("admin-model-field-kind-self-hosted").getAttribute("class");
    await roundTrip(page, helper, counts, async () => { await expect(drawer).toContainText("接入模型"); }, async () => {
      await expect(drawer.getByRole("heading", { name: "Register model", exact: true })).toBeVisible();
      await expect(page.locator("#admin-model-field-name")).toHaveValue("原文 {model-draft}");
      await expect(page.locator("#admin-model-field-vendor")).toHaveValue("原文 {vendor-draft}");
      await expect(page.locator("#admin-model-field-price")).toHaveValue("0.001");
      await expect(page.locator("#admin-model-field-context")).toHaveValue("128000");
      await expect(page.locator("#admin-model-field-endpoint")).toHaveValue("https://example.invalid/raw-endpoint");
      await expect(page.getByTestId("admin-model-tag-input")).toHaveValue("raw-capability");
      expect(await page.getByTestId("admin-model-field-kind-self-hosted").getAttribute("class")).toBe(kindClass);
      await expect(save).toBeEnabled();
    });
    await shots(page, info, "registration-draft", drawer, page.getByTestId("admin-model-field-kind-self-hosted"), save);
    await page.getByTestId("admin-model-panel-cancel").click();
    expect(counts.writes).toBe(0);
    const afterPool = await read(page, modelPath); expect(afterPool.status).toBe(poolResponse.status);
    if (rows) expect(M.operations.listModelPool.out.parse(afterPool.body)).toEqual(rows);
    else expect(afterPool.body).toMatchObject({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    const afterCore = await read(page, corePath); expect(afterCore.status).toBe(200);
    expect(C.get.out.parse(afterCore.body)).toEqual(core);
    info.annotations.push({ type: "limitation", description: `${rows?.length ?? 0} actual model rows; ${candidates.filter(c => c.available).length} available core candidates. No registration/core save/provider dispatch executed.` });
  } finally { await helper.close(); }
});

test("real member denial remains readable and public snapshot preserves canonical values", async ({ page }, info) => {
  await login(page, "member");
  for (const path of readPaths) denied(await read(page, path));
  const counts = observe(page), helper = await localeHelper(page);
  try {
    await page.goto("/platform-admin/model"); await helper.set("en");
    await expect(page.getByTestId("admin-model-error")).toContainText("Only organization administrators can manage models (NOT_ORG_ADMIN).");
    await expect(page.getByTestId("err-core-model")).toHaveText(EN.coreDenied);
    await roundTrip(page, helper, counts, async () => {
      await expect(page.getByTestId("err-core-model")).toContainText("仅当前组织管理员");
    }, async () => { await expect(page.getByTestId("err-core-model")).toHaveText(EN.coreDenied); });
    await shots(page, info, "member-denied", page.getByTestId("org-core-model-panel"), page.getByTestId("err-core-model"));
    await page.getByRole("tab", { name: EN.public, exact: true }).click();
    const catalog = page.getByTestId("bailian-catalog");
    await expect(catalog).toContainText(bailianModelCatalog.observedAt.slice(0, 10));
    const next = catalog.getByRole("button", { name: EN.next, exact: true });
    await next.click();
    const pageIds = await page.getByTestId("bailian-model-list").locator("[data-testid^=bailian-model-]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-testid")));
    await roundTrip(page, helper, counts, async () => { await expect(catalog).toContainText("百炼公共目录"); }, async () => {
      expect(await page.getByTestId("bailian-model-list").locator("[data-testid^=bailian-model-]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-testid")))).toEqual(pageIds);
    });
    await catalog.getByRole("button", { name: EN.previous, exact: true }).click();
    // Choose real metadata from the canonical public snapshot, never an authority fixture.
    const model = bailianModelCatalog.models.find(m => m.modelId === "qwen3.8-max");
    expect(model).toBeDefined(); if (!model) throw new Error("snapshot prerequisite changed");
    const query = page.getByTestId("bailian-search");
    await query.fill(model.modelId);
    await page.getByTestId("bailian-capability-filter").click();
    await page.getByRole("menuitemradio", { name: EN.capability, exact: true }).click();
    if (model.originalVendor) {
      await page.getByTestId("bailian-vendor-filter").click();
      await page.getByRole("menuitemradio", { name: model.originalVendor, exact: true }).click();
    }
    await page.getByTestId(`bailian-model-${model.modelId}`).click();
    const detail = page.getByTestId("bailian-model-detail");
    await expect(detail).toContainText("Public specification summary · Organization availability unverified");
    await expect(detail.getByRole("heading", { name: EN.sources, exact: true })).toBeVisible();
    await expect(page.getByTestId("bailian-model-detail-close")).toHaveAccessibleName("Close");
    const verifyRaw = async () => {
      await expect(detail).toContainText(model.modelId);
      if (model.originalVendor) await expect(detail).toContainText(model.originalVendor);
      if (model.billing.unit) await expect(detail).toContainText(model.billing.unit);
      for (const fact of model.parameters) {
        await expect(detail).toContainText(fact.name); await expect(detail).toContainText(fact.value); await expect(detail).toContainText(fact.scope);
      }
      for (const source of model.sources) await expect(detail.locator("a").filter({ hasText: source.title })).toHaveAttribute("href", source.url);
    };
    await verifyRaw();
    await roundTrip(page, helper, counts, async () => { await expect(detail).toContainText("尚未核验，不能用于报价或费用预留"); await verifyRaw(); },
      async () => { await verifyRaw(); await expect(detail).toContainText(EN.publicPrice); });
    // The drawer header is outside its scrolling body. Use the first real metadata
    // row so shots' native scroll and ratio-1 assertion reset/check body content.
    const detailTopRow = detail.getByText("Model ID", { exact: true }).locator("..");
    await expect(detailTopRow).toContainText(model.modelId);
    await shots(page, info, "public-detail", detail, detailTopRow, detail.locator("a").last());
    await page.getByTestId("bailian-model-detail-close").click();
    await expect(query).toHaveValue(model.modelId);
    await expect(page.getByTestId("bailian-capability-filter")).toContainText(EN.capability);
    if (model.originalVendor) await expect(page.getByTestId("bailian-vendor-filter")).toContainText(model.originalVendor);
    await shots(page, info, "public-filtered", catalog, query);
    expect(counts.writes).toBe(0);
    for (const path of readPaths) denied(await read(page, path));
  } finally { await helper.close(); }
});

test("existing actual model rows expose local manual checks and disable reason semantics only", async ({ page }, info) => {
  await login(page, "superuser");
  const baseline = await read(page, modelPath);
  expect([200, 503]).toContain(baseline.status);
  if (baseline.status === 503) {
    expect(baseline.body).toMatchObject({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    info.annotations.push({ type: "limitation", description: "Actual model pool dependency unavailable; no row/modal coverage claimed." }); return;
  }
  const rows = M.operations.listModelPool.out.parse(baseline.body);
  const row = rows.find(r => r.status === "待测试") ?? rows.find(r => r.status === "已启用") ?? rows[0];
  if (!row) {
    info.annotations.push({ type: "limitation", description: "Real pool has no row. Manual-check/enable/disable journey unavailable; no row was seeded." }); return;
  }
  const counts = observe(page), helper = await localeHelper(page);
  try {
    await page.goto("/platform-admin/model"); await helper.set("en");
    await page.getByTestId(`admin-model-card-${row.modelId}`).click();
    const detail = page.getByTestId("admin-model-detail");
    await expect(detail).toContainText(EN.local);
    if (row.status === "待测试") {
      await detail.getByTestId(`admin-model-test-${row.modelId}`).click();
      const modal = page.getByTestId("admin-model-test-dialog"), submit = page.getByTestId("admin-model-test-submit");
      await expect(modal.getByRole("heading", { name: `Record admission assessment · ${row.displayName}`, exact: true })).toBeVisible();
      await expect(submit).toHaveText("Mark assessments passed and enable");
      await expect(submit).toBeDisabled();
      await page.getByTestId("admin-model-test-check-1").check();
      await roundTrip(page, helper, counts, async () => { await expect(modal).toContainText("人工判读"); }, async () => {
        await expect(modal).toContainText("Phase-1 assessments are recorded manually, without automation.");
        await expect(page.getByTestId("admin-model-test-check-1")).toBeChecked(); await expect(submit).toBeDisabled();
      });
      await shots(page, info, "local-manual-check-draft", modal, page.getByTestId("admin-model-test-check-1"));
      // Exercise current local-only transition, never a successful synthetic API mutation.
      for (let i = 2; i <= 5; i++) await page.getByTestId(`admin-model-test-check-${i}`).check();
      await expect(submit).toBeEnabled(); await submit.click();
      await expect(page.getByTestId("admin-model-toast")).toContainText(EN.local);
    } else if (row.status !== "已启用") {
      // The existing toggle only changes local state; this does not activate a provider.
      await detail.getByTestId(`admin-model-toggle-${row.modelId}`).click();
    }
    await detail.getByTestId(`admin-model-detail-disable-${row.modelId}`).click();
    const modal = page.getByTestId("admin-model-disable-dialog"), confirm = page.getByTestId("admin-model-disable-dialog-confirm");
    await expect(modal.getByRole("heading", { name: `Disable · ${row.displayName}`, exact: true })).toBeVisible();
    await expect(page.getByTestId("admin-model-disable-dialog-close")).toHaveAccessibleName("Close");
    await expect(modal.getByRole("radiogroup")).toHaveAccessibleName("Disable mode");
    const reason = page.getByTestId("admin-model-disable-dialog-reason");
    await expect(confirm).toBeDisabled(); await reason.fill("abc"); await expect(confirm).toBeDisabled();
    await page.getByTestId("admin-model-disable-dialog-mode-drain").click();
    await reason.fill("原文 {disable-reason}"); await expect(confirm).toBeEnabled();
    await roundTrip(page, helper, counts, async () => { await expect(modal).toContainText("允许跑完当前一轮"); }, async () => {
      await expect(confirm).toHaveText("Allow the current round to finish and Disable");
      await expect(reason).toHaveValue("原文 {disable-reason}");
      await expect(page.getByTestId("admin-model-disable-dialog-mode-drain")).toHaveAttribute("aria-checked", "true");
    });
    await shots(page, info, "local-disable-draft", modal, page.getByTestId("admin-model-disable-dialog-impact"), confirm);
    await confirm.click(); await expect(page.getByTestId("admin-model-toast")).toContainText(EN.local);
    expect(counts.writes).toBe(0);
    expect(await read(page, modelPath)).toEqual(baseline);
    await page.reload();
    await expect(page.getByTestId(`admin-model-status-${row.modelId}`).first()).toHaveText(
      row.status === "待测试" ? "Untested" : row.status === "已启用" ? "Enabled" : "Not enabled");
    info.annotations.push({ type: "limitation", description: "Disable reason/mode/checks affected React state only. No backend audit or in-flight count was verified; displayed zero is a fixed UI limitation." });
  } finally { await helper.close(); }
});
