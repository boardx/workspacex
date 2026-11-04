# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: entity-localization.spec.ts >> workflow grant management persists canonical permissions and audit across locales with real member denial
- Location: e2e/entity-localization.spec.ts:434:5

# Error details

```
Error: expect(locator).toBeInViewport() failed

Locator:  getByTestId('workflow-grant-dialog').getByTestId('workflow-grant-cancel')
Expected: in viewport
Received: viewport ratio 0.700371265411377
Timeout:  5000ms

Call log:
  - Expect "toBeInViewport" with timeout 5000ms
  - waiting for getByTestId('workflow-grant-dialog').getByTestId('workflow-grant-cancel')
    14 × locator resolved to <button data-testid="workflow-grant-cancel" class="inline-flex min-h-6 items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-colors duration-base ease-base motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-foreground disabled:border-transparent border border-border bg-card text-card-foreground hover:bg-muted acti…>Cancel</button>
       - unexpected value "viewport ratio 0.700371265411377"

```

```yaml
- button "Cancel"
```

# Test source

```ts
  375 |   await login(page, true);
  376 |   let countReads = 0;
  377 |   page.on("request", request => {
  378 |     const url = new URL(request.url());
  379 |     if (request.method() === "GET" && (url.pathname.endsWith("/capabilities") || url.pathname.endsWith("/feedback/drafts/count"))) countReads += 1;
  380 |   });
  381 |   const countReady = page.waitForResponse(response => {
  382 |     const url = new URL(response.url());
  383 |     return url.pathname.endsWith("/capabilities") && url.searchParams.get("kind") === "skill" && response.status() === 200;
  384 |   });
  385 |   await page.goto("/org-admin/members");
  386 |   await countReady;
  387 |   await expect(page.getByTestId("org-admin-member-list")).toBeVisible();
  388 |   await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  389 |   const nav = page.getByTestId("admin-nav");
  390 |   const members = page.getByTestId("admin-nav-org-members");
  391 |   await expect(nav).toHaveAttribute("data-admin-scope", "org");
  392 |   await expect(nav).toHaveAccessibleName("组织后台模块");
  393 |   await expect(members).toHaveAttribute("aria-current", "page");
  394 |   const readsBeforeLocale = countReads;
  395 |   await page.getByTestId("language-switcher").first().selectOption("en");
  396 |   await expect(nav).toHaveAccessibleName("Organization admin modules");
  397 |   await expect(members).toHaveText(/^Members\s*—$/);
  398 |   await expect(page.getByTestId("admin-nav-org-members-count")).toHaveAccessibleName("Members count unavailable");
  399 |   await expect(members).toHaveAttribute("href", "/org-admin/members");
  400 |   await expect(members).toHaveAttribute("aria-current", "page");
  401 |   expect(countReads).toBe(readsBeforeLocale);
  402 |   await expect(page.getByTestId("admin-nav-agent")).toHaveCount(0);
  403 |   await page.setViewportSize({ width: 1280, height: 900 });
  404 |   await page.screenshot({ path: testInfo.outputPath("admin-nav-org-en-1280.png"), fullPage: true });
  405 |   await page.reload();
  406 |   await expect(page.getByTestId("admin-nav")).toHaveAccessibleName("Organization admin modules");
  407 |
  408 |   // This private organization admin is not a platform operator; preserve the real403.
  409 |   const denied = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/platform/members"));
  410 |   await page.goto("/platform-admin/members");
  411 |   expect((await denied).status()).toBe(403);
  412 |   await expect(page.getByTestId("admin-platform-members-forbidden")).toBeVisible();
  413 |   await expect(page.getByTestId("admin-nav")).toHaveAccessibleName("Platform admin modules");
  414 |   await expect(page.getByTestId("admin-nav")).toHaveAttribute("data-admin-scope", "platform");
  415 |   await expect(page.getByTestId("admin-nav-org-members")).toHaveCount(0);
  416 |   await expect(page.getByTestId("admin-nav-agent-count")).toHaveText(/^\d+$/);
  417 |   const agentCount = await page.getByTestId("admin-nav-agent-count").textContent();
  418 |   await expect(page.getByTestId("admin-nav-mcp-count")).toHaveText("—");
  419 |   await expect(page.getByTestId("admin-nav-mcp-count")).toHaveAccessibleName("MCP count unavailable");
  420 |   await page.setViewportSize({ width: 820, height: 900 });
  421 |   await expect(page.getByTestId("admin-nav")).toBeVisible();
  422 |   await expect(page.getByTestId("admin-nav-agent")).toHaveAttribute("href", "/platform-admin/agent");
  423 |   await page.screenshot({ path: testInfo.outputPath("admin-nav-platform-en-820.png"), fullPage: true });
  424 |   await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  425 |   await expect(page.getByTestId("admin-nav")).toHaveAccessibleName("平台后台模块");
  426 |   await expect(page.getByTestId("admin-nav-agent-count")).toHaveText(agentCount ?? "");
  427 |   await expect(page.getByTestId("admin-nav-mcp-count")).toHaveAccessibleName("MCP 计数暂不可用");
  428 |   // Existing AppShell hides its left sidebar below768px; this slice keeps that policy.
  429 |   await page.setViewportSize({ width: 375, height: 812 });
  430 |   await expect(page.getByTestId("shell-left-panel")).toBeHidden();
  431 |   await expect(page.getByTestId("admin-platform-members-forbidden")).toBeVisible();
  432 | });
  433 |
  434 | test("workflow grant management persists canonical permissions and audit across locales with real member denial", async ({ page, browser }, testInfo) => {
  435 |   await login(page, true);
  436 |   const headers = await authorization(page);
  437 |   const listPath = "/__fullstack_api" + WG.operations.listWorkflowCapabilityGrants.path;
  438 |   const itemPath = listPath + "/artifact.write";
  439 |   const read = async () => {
  440 |     const response = await page.request.get(listPath, { headers });
  441 |     expect(response.status()).toBe(200);
  442 |     return WG.operations.listWorkflowCapabilityGrants.out.parse(await response.json());
  443 |   };
  444 |   // This tenant belongs to this registered fixture; establish a real read-only baseline.
  445 |   const baseline = await page.request.delete(itemPath, { headers });
  446 |   expect(baseline.status()).toBe(200);
  447 |   expect(WG.operations.revokeWorkflowCapabilityGrant.out.parse(await baseline.json())).toMatchObject({ capabilityCategory: "artifact.write", configured: false, authorized: true, sideEffectCap: "read" });
  448 |   const catalog = await read();
  449 |   expect(catalog.workflows.some(workflow => workflow.workflowId === "W029" && workflow.capabilities.some(capability => capability.capabilityCategory === "artifact.write"))).toBe(true);
  450 |   let reads = 0, writes = 0;
  451 |   page.on("request", request => {
  452 |     const path = new URL(request.url()).pathname;
  453 |     if (request.method() === "GET" && path === listPath) reads++;
  454 |     if (["PUT", "DELETE"].includes(request.method()) && path === itemPath) writes++;
  455 |   });
  456 |   await page.goto("/org-admin/workflow-grants?workflow=W029");
  457 |   const focused = page.getByTestId("workflow-grants-workflow-W029");
  458 |   await expect(focused).toHaveAttribute("data-focused", "true");
  459 |   await expect(focused).toBeFocused();
  460 |   const countsBeforeLocale = [reads, writes];
  461 |   expect(reads).toBeGreaterThan(0);
  462 |   await page.getByTestId("language-switcher").first().selectOption("en");
  463 |   await expect(page.getByRole("heading", { name: "Workflow permissions", exact: true })).toBeVisible();
  464 |   await expect(focused).toContainText("Problem to PRD");
  465 |   await expect(page.getByTestId("workflow-grants-tab-workflow")).toHaveAttribute("aria-selected", "true");
  466 |   await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  467 |   await expect(focused).toContainText("问题定义到 PRD");
  468 |   await page.getByTestId("language-switcher").first().selectOption("en");
  469 |   expect([reads, writes]).toEqual(countsBeforeLocale);
  470 |   const revealDialogFooter = async () => {
  471 |     const modal = page.getByTestId("workflow-grant-dialog");
  472 |     await modal.hover();
  473 |     await page.mouse.wheel(0, 1200);
  474 |     await expect(modal.getByTestId("workflow-grant-confirm")).toBeInViewport({ ratio: 1 });
> 475 |     await expect(modal.getByTestId("workflow-grant-cancel")).toBeInViewport({ ratio: 1 });
      |                                                              ^ Error: expect(locator).toBeInViewport() failed
  476 |   };
  477 |   const capture = async (state: string) => {
  478 |     for (const width of [1280, 375]) {
  479 |       await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  480 |       if (state === "workflow") await focused.scrollIntoViewIfNeeded();
  481 |       if (state === "capability") await page.getByTestId("workflow-grant-row-artifact.write").scrollIntoViewIfNeeded();
  482 |       if (state === "audit") await page.getByTestId("workflow-grants-audit").scrollIntoViewIfNeeded();
  483 |       if (state === "dialog") {
  484 |         const modal = page.getByTestId("workflow-grant-dialog");
  485 |         await modal.hover();
  486 |         await page.mouse.wheel(0, -5000);
  487 |         await expect(modal.getByRole("heading")).toBeInViewport({ ratio: 1 });
  488 |         await page.screenshot({ path: testInfo.outputPath("workflow-grants-dialog-top-" + width + ".png") });
  489 |         await revealDialogFooter();
  490 |       }
  491 |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  492 |       await page.screenshot({ path: testInfo.outputPath("workflow-grants-" + state + "-" + width + ".png") });
  493 |     }
  494 |   };
  495 |   await capture("workflow");
  496 |   await page.getByTestId("workflow-grants-tab-capability").click();
  497 |   const artifact = page.getByTestId("workflow-grant-row-artifact.write");
  498 |   await expect(artifact).toContainText("Save output documents");
  499 |   await capture("capability");
  500 |   await artifact.getByTestId("workflow-grant-edit").click();
  501 |   const dialog = page.getByTestId("workflow-grant-dialog");
  502 |   await expect(dialog).toBeVisible();
  503 |   await page.getByTestId("workflow-grant-level-write").check();
  504 |   const beforeDialogLocale = [reads, writes];
  505 |   // A modal blocks the underlying header. Use the real cross-tab locale channel.
  506 |   const localePage = await page.context().newPage();
  507 |   try {
  508 |     await localePage.goto("/home");
  509 |     await localePage.getByTestId("language-switcher").first().selectOption("zh-CN");
  510 |     await expect(dialog).toContainText("调整「保存产出文档」权限");
  511 |     await expect(page.getByTestId("workflow-grant-level-write")).toBeChecked();
  512 |     await localePage.getByTestId("language-switcher").first().selectOption("en");
  513 |     await expect(dialog).toContainText("Adjust permission for Save output documents");
  514 |     await expect(page.getByTestId("workflow-grant-level-write")).toBeChecked();
  515 |   } finally { await localePage.close(); }
  516 |   expect([reads, writes]).toEqual(beforeDialogLocale);
  517 |   await capture("dialog");
  518 |   const beforeGrantEventIds = new Set(catalog.audit.map(event => event.eventId));
  519 |   const changed = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname === itemPath);
  520 |   await page.getByTestId("workflow-grant-confirm").click();
  521 |   const granted = await changed;
  522 |   expect(granted.status()).toBe(200);
  523 |   expect(WG.operations.setWorkflowCapabilityGrant.in.parse(granted.request().postDataJSON())).toEqual({ sideEffectCap: "write" });
  524 |   expect(WG.operations.setWorkflowCapabilityGrant.out.parse(await granted.json())).toMatchObject({ capabilityCategory: "artifact.write", configured: true, authorized: true, sideEffectCap: "write" });
  525 |   await expect(dialog).toBeHidden();
  526 |   await expect(page.getByTestId("workflow-grants-notice")).toContainText("Granted");
  527 |   await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  528 |   await expect(page.getByTestId("workflow-grants-notice")).toContainText("已授予「保存产出文档」可写入权限");
  529 |   await page.getByTestId("language-switcher").first().selectOption("en");
  530 |   const persisted = await read();
  531 |   expect(persisted.grants.find(grant => grant.capabilityCategory === "artifact.write")).toMatchObject({ configured: true, sideEffectCap: "write" });
  532 |   const grantEvent = persisted.audit.find(event => !beforeGrantEventIds.has(event.eventId) && event.capabilityCategory === "artifact.write" && event.action === "granted" && event.fromCap === "read" && event.toCap === "write" && event.actorId === ENTITY_LOCALIZATION_E2E.adminUserId);
  533 |   expect(grantEvent).toMatchObject({ actorId: ENTITY_LOCALIZATION_E2E.adminUserId });
  534 |   expect(Number.isFinite(Date.parse(grantEvent!.at))).toBe(true);
  535 |   await page.reload();
  536 |   await expect(page.getByRole("heading", { name: "Workflow permissions", exact: true })).toBeVisible();
  537 |   await page.getByTestId("workflow-grants-tab-capability").click();
  538 |   await expect(artifact.getByTestId("workflow-grant-current")).toContainText("Write");
  539 |   expect((await read()).audit).toContainEqual(grantEvent);
  540 |   const audit = page.getByTestId("workflow-grants-audit");
  541 |   await expect(audit).toContainText("Granted");
  542 |   await expect(audit.getByTestId("workflow-grants-audit-actor").filter({ hasText: "Localization admin (me)" }).first()).toHaveText("Localization admin (me)");
  543 |   const localizedAuditTime = await page.evaluate(iso => new Intl.DateTimeFormat("en", {
  544 |     year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  545 |   }).format(new Date(iso)), grantEvent!.at);
  546 |   await expect(audit).toContainText(localizedAuditTime);
  547 |   await expect(audit).not.toContainText(ENTITY_LOCALIZATION_E2E.adminUserId);
  548 |   await audit.scrollIntoViewIfNeeded();
  549 |   await capture("audit");
  550 |   await artifact.getByTestId("workflow-grant-edit").click();
  551 |   await page.getByTestId("workflow-grant-level-read").check();
  552 |   await revealDialogFooter();
  553 |   const beforeRevokeEventIds = new Set(persisted.audit.map(event => event.eventId));
  554 |   const revoked = page.waitForResponse(response => response.request().method() === "DELETE" && new URL(response.url()).pathname === itemPath);
  555 |   await page.getByTestId("workflow-grant-confirm").click();
  556 |   const revokeResponse = await revoked;
  557 |   expect(revokeResponse.status()).toBe(200);
  558 |   expect(WG.operations.revokeWorkflowCapabilityGrant.out.parse(await revokeResponse.json())).toMatchObject({ capabilityCategory: "artifact.write", configured: false, sideEffectCap: "read" });
  559 |   await expect(page.getByTestId("workflow-grants-notice")).toContainText("Revoked");
  560 |   const restored = await read();
  561 |   const revokeEvent = restored.audit.find(event => !beforeRevokeEventIds.has(event.eventId) && event.capabilityCategory === "artifact.write" && event.action === "revoked" && event.fromCap === "write" && event.toCap === "read" && event.actorId === ENTITY_LOCALIZATION_E2E.adminUserId);
  562 |   expect(revokeEvent).toMatchObject({ actorId: ENTITY_LOCALIZATION_E2E.adminUserId });
  563 |   expect(Number.isFinite(Date.parse(revokeEvent!.at))).toBe(true);
  564 |   await page.reload();
  565 |   await page.getByTestId("workflow-grants-tab-capability").click();
  566 |   await expect(artifact.getByTestId("workflow-grant-current")).toContainText("Read-only");
  567 |   expect((await read()).audit).toContainEqual(revokeEvent);
  568 |   const memberContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  569 |   try {
  570 |     const member = await memberContext.newPage();
  571 |     await login(member, false);
  572 |     const memberHeaders = await authorization(member);
  573 |     expect((await member.request.get(listPath, { headers: memberHeaders })).status()).toBe(403);
  574 |     expect((await member.request.put(itemPath, { headers: memberHeaders, data: { sideEffectCap: "external_send" } })).status()).toBe(403);
  575 |     expect((await member.request.delete(itemPath, { headers: memberHeaders })).status()).toBe(403);
```
