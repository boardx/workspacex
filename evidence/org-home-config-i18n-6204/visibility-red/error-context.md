# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: entity-localization.spec.ts >> organization home configuration preserves drafts, real previews and recommendation snapshots across locales
- Location: e2e/entity-localization.spec.ts:435:5

# Error details

```
Error: expect(locator).toBeHidden() failed

Locator:  getByTestId('home-config-agents')
Expected: hidden
Received: visible
Timeout:  5000ms

Call log:
  - Expect "toBeHidden" with timeout 5000ms
  - waiting for getByTestId('home-config-agents')
    14 × locator resolved to <section data-testid="home-config-agents" class="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4">…</section>
       - unexpected value "visible"

```

```yaml
- heading "Recommended agents (up to 6)" [level=2]
- button "Add agent"
- paragraph: No recommended agents yet.
```

# Test source

```ts
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
  434 |
  435 | test("organization home configuration preserves drafts, real previews and recommendation snapshots across locales", async ({ page, browser }, testInfo) => {
  436 |   // Same multi-account write/reload budget as the other private-tenant journeys.
  437 |   test.setTimeout(120_000);
  438 |   await login(page, true);
  439 |   await page.getByTestId("language-switcher").first().selectOption("en");
  440 |   const headers = await authorization(page);
  441 |   const orgId = ENTITY_LOCALIZATION_E2E.orgId;
  442 |   const scopedPath = (path: string) => "/__fullstack_api" + path.replace(":orgId", encodeURIComponent(orgId));
  443 |   const homePath = scopedPath(homeConfig.operations.getHomeConfig.path);
  444 |   const bannerPath = scopedPath(homeConfig.operations.uploadHomeBanner.path);
  445 |   const avatarPath = scopedPath(orgAdmin.operations.uploadOrgAvatar.path);
  446 |   const orgPath = scopedPath(orgAdmin.operations.updateOrganization.path);
  447 |   const directoryPath = "/__fullstack_api" + agentRole.operations.listAgentDirectory.path;
  448 |   const skillsPath = "/__fullstack_api" + skills.operations.listSkills.path;
  449 |   const currentResponse = await page.request.get(homePath, { headers });
  450 |   expect(currentResponse.status()).toBe(200);
  451 |   const before = homeConfig.HomeConfig.parse(await currentResponse.json());
  452 |   // Populate recommendations through actual installation APIs, never seeded outcomes.
  453 |   const offerResponse = await page.request.get("/__fullstack_api" + agentRole.operations.getOfficialRolePackOffer.path, { headers });
  454 |   expect(offerResponse.status()).toBe(200);
  455 |   const offer = agentRole.OfficialRolePackOffer.parse(await offerResponse.json());
  456 |   for (const pack of offer.requiredSkillPacks) {
  457 |     const installed = await page.request.post("/__fullstack_api/admin/skills/starter-pack-imports", {
  458 |       headers, data: { ...pack, idempotencyKey: randomUUID() },
  459 |     });
  460 |     expect(installed.status(), await installed.text()).toBe(201);
  461 |   }
  462 |   const installed = await page.request.post("/__fullstack_api/admin/agents/starter-pack-imports", {
  463 |     headers, data: { packId: offer.packId, packVersion: offer.packVersion, idempotencyKey: randomUUID() },
  464 |   });
  465 |   expect(installed.status(), await installed.text()).toBe(201);
  466 |   const directoryResponse = await page.request.get(directoryPath, { headers });
  467 |   expect(directoryResponse.status()).toBe(200);
  468 |   const agent = agentRole.operations.listAgentDirectory.out.parse(await directoryResponse.json()).items[0];
  469 |   expect(agent).toBeDefined();
  470 |   const skillsResponse = await page.request.get(skillsPath, { headers, params: { orgId, entry: "library" } });
  471 |   expect(skillsResponse.status()).toBe(200);
  472 |   // This adapter status is a stable filter value, independent of display locale.
  473 |   const skill = skills.operations.listSkills.out.parse(await skillsResponse.json()).items.find(item => item.status === "已启用");
  474 |   expect(skill).toBeDefined();
  475 |
  476 |   const reads = { config: 0, agents: 0, skills: 0 };
  477 |   let bannerPosts = 0, threadPosts = 0;
  478 |   page.on("request", request => {
  479 |     const url = new URL(request.url());
  480 |     if (request.method() === "GET" && url.pathname === homePath) reads.config++;
  481 |     if (request.method() === "GET" && url.pathname === directoryPath) reads.agents++;
  482 |     if (request.method() === "GET" && url.pathname === skillsPath && url.searchParams.get("entry") === "library") reads.skills++;
  483 |     if (request.method() === "POST" && url.pathname === bannerPath) bannerPosts++;
  484 |     if (request.method() === "POST" && url.pathname.endsWith("/threads")) threadPosts++;
  485 |   });
  486 |   await page.goto("/org-admin/home-config");
  487 |   await expect(page.getByRole("heading", { name: "Home configuration", exact: true })).toBeVisible();
> 488 |   await expect(page.getByTestId("home-config-agents")).toBeHidden();
      |                                                        ^ Error: expect(locator).toBeHidden() failed
  489 |   await expect(page.getByTestId("home-config-quick-actions")).toBeHidden();
  490 |   const title = "品牌原文 {name} " + randomUUID().slice(0, 6);
  491 |   const headline = "横幅原文 {count}";
  492 |   const tagline = "副标题原文 {description}\nSecond line stays authored.";
  493 |   await page.getByTestId("home-config-title").fill(title);
  494 |   await page.getByTestId("home-config-banner-headline").fill(headline);
  495 |   await page.getByTestId("home-config-banner-tagline").fill(tagline);
  496 |   const png = await page.evaluate(() => {
  497 |     const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
  498 |     const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#345678"; ctx.fillRect(0, 0, 32, 32);
  499 |     return canvas.toDataURL("image/png").split(",")[1]!;
  500 |   });
  501 |   const image = Buffer.from(png, "base64");
  502 |   const logoUploaded = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === avatarPath);
  503 |   const logoApplied = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === orgPath);
  504 |   await page.getByTestId("home-logo-file").setInputFiles({ name: "Logo原文 {file}.png", mimeType: "image/png", buffer: image });
  505 |   const logoResponse = await logoUploaded; expect(logoResponse.ok()).toBe(true);
  506 |   const logo = orgAdmin.operations.uploadOrgAvatar.out.parse(await logoResponse.json());
  507 |   expect(new URL(logoResponse.request().url()).searchParams.get("filename")).toBe("Logo原文 {file}.png");
  508 |   const appliedResponse = await logoApplied; expect(appliedResponse.status()).toBe(200);
  509 |   expect(appliedResponse.request().postDataJSON()).toEqual({ orgId, avatarArtifactId: logo.orgAvatarArtifactId });
  510 |   const organization = orgAdmin.operations.updateOrganization.out.parse(await appliedResponse.json());
  511 |   expect(organization.avatarUrl).not.toBeNull();
  512 |   const storedLogo = await page.request.get("/__fullstack_api" + organization.avatarUrl!, { headers });
  513 |   expect(storedLogo.status()).toBe(200); expect(await storedLogo.body()).toEqual(image);
  514 |   await expect(page.getByTestId("home-config-theme").locator("img")).toHaveJSProperty("naturalWidth", 32);
  515 |   const primary = "#1a2b3c";
  516 |   await page.getByLabel("Primary color value", { exact: true }).fill(primary);
  517 |   await page.getByTestId("home-config-banner-preset-custom").click();
  518 |   await page.getByTestId("home-config-banner-color-input").fill(primary);
  519 |   const rejected = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === bannerPath);
  520 |   await page.getByTestId("home-config-banner-file-input").setInputFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  521 |   expect((await rejected).ok()).toBe(false);
  522 |   await expect(page.getByTestId("home-config-banner-upload-error")).toContainText("Only PNG, JPEG, and WebP images are supported.");
  523 |   const postsBeforeLocale = bannerPosts;
  524 |   await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  525 |   await expect(page.getByTestId("home-config-banner-upload-error")).not.toContainText("Only PNG");
  526 |   await page.getByTestId("language-switcher").first().selectOption("en");
  527 |   await expect(page.getByTestId("home-config-banner-upload-error")).toContainText("Only PNG");
  528 |   expect(bannerPosts).toBe(postsBeforeLocale);
  529 |   const uploaded = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === bannerPath);
  530 |   await page.getByTestId("home-config-banner-file-input").setInputFiles({ name: "横幅原文 {file}.png", mimeType: "image/png", buffer: image });
  531 |   const uploadResponse = await uploaded; expect(uploadResponse.ok()).toBe(true);
  532 |   const banner = homeConfig.operations.uploadHomeBanner.out.parse(await uploadResponse.json());
  533 |   expect(new URL(uploadResponse.request().url()).searchParams.get("filename")).toBe("横幅原文 {file}.png");
  534 |   const storedBanner = await page.request.get("/__fullstack_api" + banner.bannerImageUrl, { headers });
  535 |   expect(storedBanner.status()).toBe(200); expect(await storedBanner.body()).toEqual(image);
  536 |
  537 |   await page.getByTestId("home-config-tab-content").click();
  538 |   for (const item of before.recommendedAgents) await page.getByTestId("home-config-agent-remove-" + item.agentId).click();
  539 |   for (const item of before.recommendedCapabilities) await page.getByTestId("home-config-remove-" + item.kind + "-" + item.refId).click();
  540 |   await page.getByRole("button", { name: "Add agent", exact: true }).click();
  541 |   const agentChoice = page.getByTestId("home-config-picker-agent-" + agent!.agentId);
  542 |   await expect(agentChoice).toHaveText(agent!.name); await agentChoice.click();
  543 |   const agentNote = "数字人备注原文 {note}";
  544 |   await page.getByTestId("home-config-agent-note-" + agent!.agentId).fill(agentNote);
  545 |   await page.getByRole("button", { name: "Add skill", exact: true }).click();
  546 |   const skillChoice = page.getByTestId("home-config-picker-skill-" + skill!.skillId);
  547 |   await expect(skillChoice).toHaveText(skill!.name); await skillChoice.click();
  548 |   const skillNote = "Skill备注原文 {note}";
  549 |   await page.getByTestId("home-config-recommendation-note-skill-" + skill!.skillId).fill(skillNote);
  550 |   const readsBeforeLocale = { ...reads };
  551 |   expect(Object.values(readsBeforeLocale).every(count => count > 0)).toBe(true);
  552 |   await page.getByTestId("language-switcher").first().selectOption("zh-CN");
  553 |   await page.getByTestId("language-switcher").first().selectOption("en");
  554 |   await expect(page.getByTestId("home-config-tab-content")).toHaveAttribute("aria-selected", "true");
  555 |   await expect(agentChoice).toHaveText("Added · " + agent!.name); await expect(agentChoice).toBeDisabled();
  556 |   await expect(skillChoice).toHaveText("Added · " + skill!.name); await expect(skillChoice).toBeDisabled();
  557 |   await expect(page.getByTestId("home-config-agent-note-" + agent!.agentId)).toHaveValue(agentNote);
  558 |   expect(reads).toEqual(readsBeforeLocale);
  559 |
  560 |   const capture = async (label: string, tab: "edit" | "content" | "layout" | "preview", section: string) => {
  561 |     await expect(page).toHaveURL(/\/org-admin\/home-config$/);
  562 |     for (const width of [375, 1280]) {
  563 |       await page.setViewportSize({ width, height: 900 });
  564 |       await page.getByTestId("home-config-tabs").scrollIntoViewIfNeeded();
  565 |       await expect(page.getByTestId("home-config-tab-" + tab)).toHaveAttribute("aria-selected", "true");
  566 |       expect(await page.getByTestId("home-config-tabs").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  567 |       for (const button of await page.getByTestId("home-config-tabs").getByRole("tab").all()) {
  568 |         expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  569 |       }
  570 |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  571 |       await page.getByTestId(section).scrollIntoViewIfNeeded();
  572 |       await page.screenshot({ path: testInfo.outputPath("home-config-" + label + "-" + width + ".png"), fullPage: true });
  573 |     }
  574 |   };
  575 |   await expect(page.getByTestId("home-config-theme")).toBeHidden();
  576 |   await expect(page.getByTestId("home-config-quick-actions")).toBeHidden();
  577 |   await capture("content", "content", "home-config-agents");
  578 |   await page.getByTestId("home-config-tab-layout").click();
  579 |   await expect(page.getByTestId("home-config-theme")).toBeHidden();
  580 |   await expect(page.getByTestId("home-config-agents")).toBeHidden();
  581 |   await page.getByTestId("home-config-quick-action-chat").uncheck();
  582 |   await capture("layout", "layout", "home-config-quick-actions");
  583 |   await page.getByTestId("home-config-tab-edit").click();
  584 |   await expect(page.getByTestId("home-config-title")).toHaveValue(title);
  585 |   await expect(page.getByTestId("home-config-banner-tagline")).toHaveValue(tagline);
  586 |   await expect(page.getByLabel("Primary color value", { exact: true })).toHaveValue(primary);
  587 |   await capture("theme", "edit", "home-config-theme");
  588 |   await capture("banner", "edit", "home-config-banner-section");
```
