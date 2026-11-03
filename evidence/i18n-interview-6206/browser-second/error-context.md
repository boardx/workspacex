# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: i18n-interview-journey.spec.ts >> interview locale preserves the real private-profile, canonical six-step and history journey
- Location: e2e/i18n-interview-journey.spec.ts:8:5

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: getByRole('textbox', { name: 'Edit question 1', exact: true })
Expected: enabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" with timeout 5000ms
  - waiting for getByRole('textbox', { name: 'Edit question 1', exact: true })
    - locator resolved to <textarea rows="1" disabled aria-label="Edit question 1" class="min-h-9 min-w-0 w-full flex-1 resize-none overflow-y-auto rounded-md bg-transparent px-2 py-1 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring">最近一次完成相关任务时发生了什么？</textarea>
    - unexpected value "disabled"

```

```yaml
- alert
- link "Skip to main content":
  - /url: "#wsx-main-content"
- main:
  - button "Back to interviews"
  - text: "Interviews Status: Markdown research workbench Version 12"
  - 'heading "原始访谈 {count} 74403f3c-4abd-4106-b25b-da1f4485a200" [level=1]'
  - navigation "Interview steps":
    - list:
      - listitem:
        - button "Completed Import requirements Save research Markdown"
      - listitem:
        - button "Completed Confirm analysis Review AI analysis"
      - listitem:
        - button "Completed Select experts Confirm expert profiles"
      - listitem:
        - button "Completed Interview questions Confirm each expert outline"
      - listitem:
        - button "5 Start interviews Run simulated interviews"
      - listitem:
        - button "6 Generate report Review the research report"
  - main:
    - heading "Interview execution" [level=2]
    - text: Experts completed 1/1 Completed 1
    - complementary "Interview experts":
      - heading "Interview experts" [level=3]
      - text: 1 experts
      - 'button "私有专家 {count} 0e7fb051-397c-4f61-9991-15b7f3b5d329 Completed"':
        - 'img "Illustrated avatar for 私有专家 {count} 0e7fb051-397c-4f61-9991-15b7f3b5d329"'
        - 'heading "私有专家 {count} 0e7fb051-397c-4f61-9991-15b7f3b5d329" [level=4]'
        - paragraph: Completed
    - heading "Interview records" [level=3]
    - region "All interview summaries":
      - 'heading "私有专家 {count} 0e7fb051-397c-4f61-9991-15b7f3b5d329" [level=2]':
        - 'link "私有专家 {count} 0e7fb051-397c-4f61-9991-15b7f3b5d329"':
          - /url: "#expert-custom-expert-9a826f03-dffa-4429-8879-4d0995b1415f"
      - button "Q1：最近一次完成相关任务时发生了什么？"
      - button "Q2：是否有与该经历相反的案例？"
    - button "Generate report"
```

# Test source

```ts
  10  |   const errors: string[] = [];
  11  |   let writes = 0;
  12  |   page.on("pageerror", error => errors.push(error.message));
  13  |   page.on("request", request => { if (request.method() === "POST" && apiPath(request.url()).startsWith("/interviews/digital")) writes++; });
  14  |   const rawName = `原始访谈 {count} ${randomUUID()}`;
  15  |   const rawExpert = `私有专家 {count} ${randomUUID()}`;
  16  |   const rawGoal = "# 原始研究需求\n\n## 研究目标\n核对最近一次任务的具体经过和相反案例，保留客户原文。";
  17  |   await page.goto("/login");
  18  |   await page.getByTestId("language-switcher").selectOption("en");
  19  |   await page.getByTestId("login-email").fill(F.email);
  20  |   await page.getByTestId("login-password").fill(F.password);
  21  |   await page.getByTestId("login-submit").click();
  22  |   await expect(page).toHaveURL(/\/home$/);
  23  |   const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  24  |   expect(token).toBeTruthy();
  25  |   const headers = { authorization: `Bearer ${token}` };
  26  |   const languagePage = await context.newPage();
  27  |   await languagePage.goto("/itv");
  28  |   const language = async (locale: "en" | "zh-CN") => { await languagePage.getByTestId("language-switcher").first().selectOption(locale); };
  29  |   const capture = async (name: string, workflow = false) => {
  30  |     for (const width of [375, 1280]) {
  31  |       await page.setViewportSize({ width, height: 900 });
  32  |       await page.evaluate(() => window.scrollTo(0, 0));
  33  |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  34  |       const nav = page.getByTestId("itv-workbench-navigation");
  35  |       await expect(nav).toHaveCount(workflow ? 1 : 0);
  36  |       if (workflow) {
  37  |         for (const label of ["Import requirements", "Confirm analysis", "Select experts", "Interview questions", "Start interviews", "Generate report"]) {
  38  |           expect(await nav.getByText(label, { exact: true }).evaluate(element => {
  39  |             const cell = element.closest("li")!.getBoundingClientRect(); const bounds = element.getBoundingClientRect();
  40  |             return element.scrollWidth <= element.clientWidth && bounds.left >= cell.left - 1 && bounds.right <= cell.right + 1;
  41  |           })).toBe(true);
  42  |         }
  43  |       }
  44  |       const dialog = page.getByRole("dialog");
  45  |       if (await dialog.count()) {
  46  |         const box = await dialog.boundingBox(); expect(box).not.toBeNull();
  47  |         expect(box!.x).toBeGreaterThanOrEqual(8); expect(box!.x + box!.width).toBeLessThanOrEqual(width - 8);
  48  |         expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  49  |       }
  50  |       await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
  51  |     }
  52  |   };
  53  |   await page.goto("/itv?tab=experts");
  54  |   await page.getByTestId("itv-add-library-expert").click();
  55  |   const profile = page.getByRole("dialog");
  56  |   await expect(profile).toHaveCount(1);
  57  |   await expect(profile.getByRole("heading", { name: "Add expert profile", exact: true })).toBeVisible();
  58  |   for (const [name, value] of Object.entries({ Name: rawExpert, "Professional role": "原专业角色", "Professional domains": "研究", "Research focus": "原始任务与反例", "Perspective style": "原始观点风格", Capabilities: "仅用于模拟研究的私有画像", "Limitations and material boundary": "原始材料边界，仅模拟" })) {
  59  |     await profile.getByRole("textbox", { name, exact: true }).fill(value);
  60  |   }
  61  |   await profile.getByRole("textbox", { name: "Occupation", exact: true }).fill("原始职业");
  62  |   await language("zh-CN"); await expect(profile.getByRole("heading", { name: "添加专家画像", exact: true })).toBeVisible(); await expect(profile.getByRole("textbox", { name: "名称", exact: true })).toHaveValue(rawExpert);
  63  |   await language("en"); await expect(profile.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(rawExpert);
  64  |   await capture("private-profile-en");
  65  |   await profile.getByRole("button", { name: "Save expert", exact: true }).click();
  66  |   await expect(profile).not.toBeVisible();
  67  |   const catalogResponse = await page.request.get("/__fullstack_api/interviews/digital/expert-library", { headers });
  68  |   expect(catalogResponse.ok()).toBe(true);
  69  |   const catalog = await catalogResponse.json();
  70  |   const custom = catalog.items.find((item: { fields: { name: string } }) => item.fields.name === rawExpert);
  71  |   expect(custom).toBeTruthy(); expect(custom.fields.profile.occupation).toBe("原始职业");
  72  |   await page.reload();
  73  |   const customCard = page.getByTestId(`itv-library-${custom.expertId}`);
  74  |   await expect(customCard).toContainText(rawExpert);
  75  |   await customCard.getByRole("button", { name: `View profile ${rawExpert}`, exact: true }).click();
  76  |   await expect(page.getByRole("dialog", { name: rawExpert, exact: true })).toContainText("原始职业");
  77  |   await capture("private-profile-detail-en");
  78  |   await page.keyboard.press("Escape");
  79  |   await expect(customCard.getByRole("button", { name: `View profile ${rawExpert}`, exact: true })).toBeFocused();
  80  |   await page.goto("/itv/new");
  81  |   const create = page.getByRole("dialog", { name: "New interview", exact: true });
  82  |   await create.getByRole("textbox", { name: "Interview name", exact: true }).fill(rawName);
  83  |   await capture("create-interview-en");
  84  |   await create.getByRole("button", { name: "Start interview", exact: true }).click();
  85  |   await expect(page).toHaveURL(/\/itv\/[^/]+\/intake$/);
  86  |   const id = new URL(page.url()).pathname.split("/")[2]!;
  87  |   const sourceUrl = `/__fullstack_api/interviews/digital/${encodeURIComponent(id)}/markdown`;
  88  |   const readSource = async () => { const response = await page.request.get(sourceUrl, { headers }); expect(response.ok()).toBe(true); return C.InterviewMarkdownEnvelope.parse(await response.json()); };
  89  |   const demand = page.getByRole("textbox", { name: "Research requirements Markdown", exact: true });
  90  |   await expect(demand).toBeEnabled(); await demand.fill(rawGoal);
  91  |   const beforeSwitch = writes;
  92  |   await language("zh-CN"); await expect(page.getByRole("textbox", { name: "研究需求 Markdown", exact: true })).toHaveValue(rawGoal);
  93  |   await language("en"); await expect(demand).toHaveValue(rawGoal); expect(writes).toBe(beforeSwitch);
  94  |   page.once("dialog", async dialog => { expect(dialog.message()).toContain("unsaved Markdown"); await dialog.dismiss(); });
  95  |   await page.getByRole("button", { name: "Back to interviews", exact: true }).click();
  96  |   await expect(page).toHaveURL(new RegExp(`/itv/${id}/intake$`));
  97  |   await capture("interview-intake-en", true);
  98  |   await page.getByRole("button", { name: "Next: confirm analysis", exact: true }).click();
  99  |   await expect(page).toHaveURL(/\/analysis$/);
  100 |   await capture("interview-analysis-en", true);
  101 |   expect((await readSource()).documents.find(document => document.step === "intake")?.markdown).toBe(rawGoal);
  102 |   await page.getByRole("button", { name: "Select experts", exact: true }).click();
  103 |   await expect(page).toHaveURL(/\/experts$/);
  104 |   await page.getByTestId(`itv-library-${custom.expertId}`).getByRole("button", { name: `Add profile ${rawExpert}`, exact: true }).click();
  105 |   await expect.poll(async () => (await readSource()).documents.find(document => document.step === "experts")?.markdown).toContain(`#expert-${custom.expertId}`);
  106 |   await capture("interview-experts-en", true);
  107 |   await page.getByRole("button", { name: "Confirm experts and generate questions", exact: true }).click();
  108 |   await expect(page).toHaveURL(/\/outline$/);
  109 |   const question = page.getByRole("textbox", { name: "Edit question 1", exact: true });
> 110 |   await expect(question).toBeEnabled(); await question.fill("用户原始修改的问题？");
      |                          ^ Error: expect(locator).toBeEnabled() failed
  111 |   await language("zh-CN"); await language("en"); await expect(question).toHaveValue("用户原始修改的问题？");
  112 |   await page.getByRole("button", { name: "Save question draft", exact: true }).click();
  113 |   await expect.poll(async () => (await readSource()).documents.find(document => document.step === "outline")?.markdown).toContain("用户原始修改的问题？");
  114 |   await page.reload(); await expect(question).toHaveValue("用户原始修改的问题？");
  115 |   await capture("interview-outline-en", true);
  116 |   await page.getByRole("button", { name: "Confirm questions and start interviews", exact: true }).click();
  117 |   await expect(page).toHaveURL(/\/runs$/);
  118 |   const generateReport = page.getByRole("button", { name: "Generate report", exact: true });
  119 |   await expect(generateReport).toBeEnabled({ timeout: 60_000 });
  120 |   await capture("interview-runs-en", true);
  121 |   await generateReport.click();
  122 |   await expect(page).toHaveURL(/\/report$/);
  123 |   await expect(page.getByTestId("itv-source-report-markdown")).toContainText("确定性测试模型", { timeout: 60_000 });
  124 |   await expect.poll(async () => {
  125 |     const current = await readSource(); const report = current.documents.find(document => document.step === "report");
  126 |     const state = current.states.find(state => state.documentId === report?.documentId);
  127 |     return Boolean(report && state && ["draft", "confirmed", "completed"].includes(state.status) && !state.failure && report.references.some(reference => reference.locator));
  128 |   }, { timeout: 60_000 }).toBe(true);
  129 |   const saved = await readSource(); const report = saved.documents.find(document => document.step === "report")!;
  130 |   expect(report.references.some(reference => reference.locator)).toBe(true);
  131 |   const terminalWrites = writes;
  132 |   await language("zh-CN"); await expect(page.getByRole("navigation", { name: "报告目录", exact: true })).toBeVisible();
  133 |   await language("en"); await expect(page.getByRole("navigation", { name: "Report contents", exact: true })).toBeVisible();
  134 |   const unchanged = await readSource(); expect(unchanged.version).toBe(saved.version);
  135 |   expect(unchanged.documents.find(document => document.step === "report")).toEqual(report); expect(writes).toBe(terminalWrites);
  136 |   await capture("interview-report-en", true);
  137 |   await page.getByRole("button", { name: "Back to interviews", exact: true }).click();
  138 |   await page.getByTestId(`itv-history-actions-${id}`).click(); await page.getByTestId(`itv-history-edit-${id}`).click();
  139 |   await page.getByTestId("itv-edit-name").fill(rawName); await page.getByTestId("itv-edit-tag-input").fill("原始标签");
  140 |   await language("zh-CN"); await language("en"); await expect(page.getByTestId("itv-edit-tag-input")).toHaveValue("原始标签");
  141 |   await capture("interview-metadata-en"); await page.getByTestId("itv-edit-submit").click();
  142 |   await expect(page.getByTestId("itv-edit-dialog")).not.toBeVisible(); await page.reload();
  143 |   await expect(page.getByTestId(`itv-history-card-${id}`)).toContainText("原始标签");
  144 |   await capture("interview-history-en");
  145 |   await page.getByTestId(`itv-history-actions-${id}`).click(); await page.getByTestId(`itv-history-delete-${id}`).click();
  146 |   await expect(page.getByRole("dialog")).toContainText("interview");
  147 |   await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(page.getByTestId(`itv-history-card-${id}`)).toBeVisible();
  148 |   expect(errors).toEqual([]);
  149 | });
  150 | 
```