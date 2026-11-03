# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: entity-localization.spec.ts >> an installed organization explicitly updates authored titles without changing execution or manual copy
- Location: e2e/entity-localization.spec.ts:102:5

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: locator.click: Test timeout of 120000ms exceeded.
Call log:
  - waiting for getByTestId('display-translation-update').getByRole('button', { name: 'Update display translations', exact: true })

```

# Page snapshot

```yaml
- generic [active] [ref=f2e1]:
  - alert [ref=f2e2]
  - generic [ref=f2e3]:
    - link "Skip to main content" [ref=f2e4] [cursor=pointer]:
      - /url: "#wsx-main-content"
    - navigation "Main navigation" [ref=f2e6]:
      - 'button "Organization menu, current: Localization acceptance" [ref=f2e8] [cursor=pointer]':
        - generic [ref=f2e9]: L
      - generic [ref=f2e10]:
        - generic [ref=f2e11]:
          - link "Home" [ref=f2e12] [cursor=pointer]:
            - /url: /home
          - link "Chats" [ref=f2e17] [cursor=pointer]:
            - /url: /chat
        - link "Projects" [ref=f2e23] [cursor=pointer]:
          - /url: /projects
        - generic [ref=f2e27]:
          - link "Research" [ref=f2e28] [cursor=pointer]:
            - /url: /research
          - link "Interviews" [ref=f2e33] [cursor=pointer]:
            - /url: /itv
        - generic [ref=f2e38]:
          - link "Brain" [ref=f2e39] [cursor=pointer]:
            - /url: /brain
          - link "Tasks" [ref=f2e51] [cursor=pointer]:
            - /url: /tasks
          - link "Workflows" [ref=f2e56] [cursor=pointer]:
            - /url: /workflows
        - link "Organization admin" [ref=f2e63] [cursor=pointer]:
          - /url: /admin
      - button "More" [ref=f2e69] [cursor=pointer]
      - generic [ref=f2e75]:
        - generic [ref=f2e76]:
          - button "任务提醒，0 条未读" [ref=f2e77] [cursor=pointer]:
            - generic [ref=f2e82]: 提醒
          - generic [ref=f2e83]: 0 条未读
        - button "Send feedback" [ref=f2e84] [cursor=pointer]:
          - generic [ref=f2e87]: Feedback
        - button "Account menu" [ref=f2e88] [cursor=pointer]:
          - generic [ref=f2e89]: L
    - generic [ref=f2e90]:
      - banner [ref=f2e91]:
        - generic [ref=f2e92]: Localization acceptance
        - paragraph [ref=f2e99]: Administrator
        - paragraph [ref=f2e100]: Outside a project · Project roles do not apply
        - combobox "Language" [ref=f2e102]:
          - option "简体中文"
          - option "English" [selected]
      - main [ref=f2e104]:
        - generic [ref=f2e105]:
          - generic [ref=f2e107]:
            - generic [ref=f2e109]:
              - heading "数字人目录" [level=1] [ref=f2e110]
              - paragraph [ref=f2e111]: 按角色找同事，按任务开始工作。
            - generic "数字人目录范围" [ref=f2e113]:
              - button "本组织" [ref=f2e114] [cursor=pointer]
              - button "官方角色" [pressed] [ref=f2e115] [cursor=pointer]
          - generic [ref=f2e118]:
            - region "官方数字人" [ref=f2e119]:
              - paragraph [ref=f2e120]: 启用官方数字人时，会同时准备所需的技能与工作流。启用后可在首页推荐中添加。
              - paragraph [ref=f2e121]: 启用按钮会为当前组织准备以下全部待启用角色及其依赖；成员仅可查看。启用不会增加数据访问或写入权限，也不代表工作流业务验收通过。
              - region "Display translation update" [ref=f2e122]:
                - heading "Display translation update" [level=3] [ref=f2e123]
                - paragraph [ref=f2e124]: Update Chinese and English names for official colleagues and skills. Your manually maintained translations are preserved.
                - alert [ref=f2e125]:
                  - paragraph [ref=f2e126]: Could not update display translations. Please retry.
                  - button "Reload" [ref=f2e127] [cursor=pointer]
              - paragraph [ref=f2e128]: 本组织已启用全部官方数字人。
            - button "查看本组织数字人" [ref=f2e129] [cursor=pointer]
```

# Test source

```ts
  35  |   }
  36  |   const imported = await page.request.post("/__fullstack_api/admin/skills/starter-pack-imports", {
  37  |     headers, data: { packId: "work-research", packVersion: "1.0.1", idempotencyKey: randomUUID() },
  38  |   });
  39  |   expect(imported.status()).toBe(201);
  40  |   const { skillIds, versionIds } = await imported.json() as { skillIds: string[]; versionIds: string[] };
  41  |   const skillId = skillIds[0]!;
  42  |   const versionId = versionIds[0]!;
  43  |   const snapshotPath = `/__fullstack_api${fileOperations.getSkillFileSnapshot.path.replace(":skillId", encodeURIComponent(skillId))}?versionId=${encodeURIComponent(versionId)}`;
  44  |   const beforeResponse = await page.request.get(snapshotPath, { headers });
  45  |   expect(beforeResponse.status()).toBe(200);
  46  |   const before = SkillFileSnapshot.parse(await beforeResponse.json());
  47  |   const adminPath = `/__fullstack_api/admin/skills/${encodeURIComponent(skillId)}/localizations/en`;
  48  |   const originalResponse = await page.request.get(adminPath, { headers });
  49  |   expect(originalResponse.status()).toBe(200);
  50  |   const original = EntityLocalizationAdminView.parse(await originalResponse.json());
  51  | 
  52  |   await page.goto("/skill?screen=work-catalog");
  53  |   await expect(page.getByTestId("work-catalog-load-more")).toBeVisible();
  54  |   const row = page.getByTestId("work-catalog-row-S157");
  55  |   await expect(row).toHaveCount(0);
  56  |   await page.getByTestId("work-catalog-search").fill(original.source.fields.name);
  57  |   await row.click();
  58  |   await page.getByTestId("entity-localization-toggle").click();
  59  |   const editor = page.getByTestId("entity-localization-editor");
  60  |   await expect(editor).toBeVisible();
  61  |   await editor.getByRole("button", { name: "译文语言", exact: true }).click();
  62  |   await page.getByRole("menuitemradio", { name: "英语", exact: true }).click();
  63  |   await page.getByTestId("entity-localization-name").fill(translatedName);
  64  |   await page.getByTestId("entity-localization-summary").fill("Translated display summary only");
  65  |   await editor.getByRole("button", { name: "保存译文", exact: true }).click();
  66  |   await expect(editor.getByRole("status")).toHaveText("译文已保存");
  67  |   await page.getByTestId("language-switcher").selectOption("en");
  68  |   await expect(row.getByTestId("work-catalog-row-title")).toHaveText(translatedName);
  69  |   await expect(page.getByTestId("work-skill-detail")).toContainText("Translated display summary only");
  70  |   await page.screenshot({ path: testInfo.outputPath("admin-translation.png"), fullPage: true });
  71  | 
  72  |   const memberContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  73  |   try {
  74  |     const member = await memberContext.newPage();
  75  |     await login(member, false);
  76  |     const memberHeaders = await authorization(member);
  77  |     expect((await member.request.get(adminPath, { headers: memberHeaders })).status()).toBe(403);
  78  |     await member.goto("/skill?screen=work-catalog");
  79  |     await member.getByTestId("language-switcher").selectOption("en");
  80  |     await member.getByTestId("work-catalog-search").fill(translatedName);
  81  |     const memberRow = member.getByTestId("work-catalog-row-S157");
  82  |     await expect(memberRow).toHaveCount(1);
  83  |     await expect(memberRow.getByTestId("work-catalog-row-title")).toHaveText(translatedName);
  84  |     await memberRow.click();
  85  |     await expect(member.getByTestId("entity-localization-toggle")).toHaveCount(0);
  86  |     await member.screenshot({ path: testInfo.outputPath("member-translation.png"), fullPage: true });
  87  |     await member.getByTestId("work-catalog-search").fill(original.source.fields.name);
  88  |     await member.getByTestId("language-switcher").selectOption("zh-CN");
  89  |     await expect(member.getByTestId("work-catalog-row-S157").getByTestId("work-catalog-row-title")).toHaveText(original.source.fields.name);
  90  |   } finally { await memberContext.close(); }
  91  | 
  92  |   await editor.getByRole("button", { name: "Remove translation", exact: true }).click();
  93  |   await expect(editor.getByRole("status")).toHaveText("Translation removed. The original is shown.");
  94  |   await expect(page.getByTestId("work-catalog-row-S157").getByTestId("work-catalog-row-title")).toHaveText(original.source.fields.name);
  95  |   const afterResponse = await page.request.get(snapshotPath, { headers });
  96  |   expect(afterResponse.status()).toBe(200);
  97  |   expect(SkillFileSnapshot.parse(await afterResponse.json())).toEqual(before);
  98  |   const afterSource = EntityLocalizationAdminView.parse(await (await page.request.get(adminPath, { headers })).json());
  99  |   expect(afterSource.source).toEqual(original.source);
  100 | });
  101 | 
  102 | test("an installed organization explicitly updates authored titles without changing execution or manual copy", async ({ page, browser }, testInfo) => {
  103 |   await login(page,true);
  104 |   const headers = await authorization(page);
  105 |   const offer = agentRole.OfficialRolePackOffer.parse(await (await page.request.get(`/__fullstack_api${agentRole.operations.getOfficialRolePackOffer.path}`,{ headers })).json());
  106 |   for (const pack of offer.requiredSkillPacks) {
  107 |     const response = await page.request.post("/__fullstack_api/admin/skills/starter-pack-imports",{ headers,data: { ...pack,idempotencyKey: randomUUID() } });
  108 |     expect(response.status(),await response.text()).toBe(201);
  109 |   }
  110 |   const roleImport = await page.request.post("/__fullstack_api/admin/agents/starter-pack-imports",{ headers,data: { packId: offer.packId,packVersion: offer.packVersion,idempotencyKey: randomUUID() } });
  111 |   expect(roleImport.status(),await roleImport.text()).toBe(201);
  112 |   const { agentIds } = await roleImport.json() as { agentIds: string[] };
  113 |   const catalog = await (await page.request.get("/__fullstack_api/skills/catalog?q=S003&limit=100",{ headers })).json() as { items: { skillId: string }[] };
  114 |   const skillId = catalog.items[0]!.skillId;
  115 |   const adminPath = `/__fullstack_api/admin/skills/${encodeURIComponent(skillId)}/localizations/en`;
  116 |   const source = EntityLocalizationAdminView.parse(await (await page.request.get(adminPath,{ headers })).json());
  117 |   const manualName = `Manual search title ${randomUUID()}`;
  118 |   const authored = await page.request.put(adminPath,{ headers,data: { sourceRevision: source.source.revision,expectedTranslationRevision: source.translation?.revision ?? null,status: "reviewed",fields: { name: manualName } } });
  119 |   expect(authored.status()).toBe(200);
  120 |   const manual = EntityLocalizationAdminView.parse(await authored.json());
  121 |   const snapshotPath = `/__fullstack_api${fileOperations.getSkillFileSnapshot.path.replace(":skillId",encodeURIComponent(skillId))}?versionId=${encodeURIComponent(source.source.versionId!)}`;
  122 |   const before = SkillFileSnapshot.parse(await (await page.request.get(snapshotPath,{ headers })).json());
  123 |   const exported = async () => Promise.all(agentIds.map(async id => {
  124 |     const response = await page.request.get(`/__fullstack_api/admin/agents/${encodeURIComponent(id)}/portable-package`,{ headers });
  125 |     expect(response.status()).toBe(200);
  126 |     const pack = await response.json() as { agents: Record<string,unknown>[] };
  127 |     return pack.agents.map(({ localization: _copy,...original }) => original);
  128 |   }));
  129 |   const rolesBefore = await exported();
  130 |   await page.goto("/agent");
  131 |   await page.getByTestId("language-switcher").selectOption("en");
  132 |   await page.getByTestId("agent-directory-enable-official").click();
  133 |   const update = page.getByTestId("display-translation-update");
  134 |   await expect(update).toBeVisible();
> 135 |   await update.getByRole("button",{ name: "Update display translations",exact: true }).click();
      |                                                                                        ^ Error: locator.click: Test timeout of 120000ms exceeded.
  136 |   await expect(page.getByTestId("agent-directory")).toContainText("Product Manager");
  137 |   await page.screenshot({ path: testInfo.outputPath("explicit-display-update.png"),fullPage: true });
  138 |   expect(SkillFileSnapshot.parse(await (await page.request.get(snapshotPath,{ headers })).json())).toEqual(before);
  139 |   const after = EntityLocalizationAdminView.parse(await (await page.request.get(adminPath,{ headers })).json());
  140 |   expect(after.source).toEqual(source.source); expect(after.translation).toEqual(manual.translation);
  141 |   expect(await exported()).toEqual(rolesBefore);
  142 |   const memberContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  143 |   try {
  144 |     const member = await memberContext.newPage(); await login(member,false);
  145 |     const memberHeaders = await authorization(member);
  146 |     expect((await member.request.get("/__fullstack_api/admin/entity-display-updates/offer",{ headers: memberHeaders })).status()).toBe(403);
  147 |     await member.goto("/agent"); await member.getByTestId("language-switcher").selectOption("en");
  148 |     await expect(member.getByTestId("agent-directory")).toContainText("Product Manager");
  149 |     await expect(member.getByTestId("agent-directory-enable-official")).toHaveCount(0);
  150 |     await member.goto("/skill?screen=work-catalog");
  151 |     await member.getByTestId("work-catalog-search").fill(manualName);
  152 |     await expect(member.getByTestId("work-catalog-row-S003").getByTestId("work-catalog-row-title")).toHaveText(manualName);
  153 |     await member.getByTestId("language-switcher").selectOption("zh-CN");
  154 |     await member.getByTestId("work-catalog-search").fill("企业内部检索");
  155 |     await expect(member.getByTestId("work-catalog-row-S003").getByTestId("work-catalog-row-title")).toHaveText("企业内部检索");
  156 |     await member.screenshot({ path: testInfo.outputPath("authored-member-zh.png"),fullPage: true });
  157 |   } finally { await memberContext.close(); }
  158 | });
  159 | 
```