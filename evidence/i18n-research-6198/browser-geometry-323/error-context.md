# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: i18n-research-entry.spec.ts >> research locale preserves the real intake, plan, saved report and history management journey
- Location: e2e/i18n-research-entry.spec.ts:8:5

# Error details

```
Test timeout of 180000ms exceeded.
```

```
Error: locator.evaluate: Test timeout of 180000ms exceeded.
Call log:
  - waiting for getByTestId('research-flow-progress').getByText('Confirm research details', { exact: true })

```

# Page snapshot

```yaml
- generic:
  - alert
  - generic:
    - link:
      - /url: "#wsx-main-content"
      - text: Skip to main content
    - generic:
      - banner:
        - generic:
          - generic:
            - button:
              - generic: o
          - generic:
            - button
          - generic: org org-fullstack-xj-6d5fb32c-6ee2b7c7e134
        - generic:
          - combobox
      - generic:
        - main:
          - generic:
            - generic:
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - generic:
                        - generic:
                          - heading [level=1]: Research
                          - generic: 1 research project
                      - generic:
                        - generic:
                          - generic: Search research
                          - textbox:
                            - /placeholder: Search research by name or tag
                        - link:
                          - /url: /research/new
                          - text: New research
                    - generic:
                      - button: Recently updated
                    - group:
                      - generic: Filter by research status
                    - region:
                      - generic:
                        - article:
                          - generic:
                            - generic:
                              - generic:
                                - generic:
                                  - generic:
                                    - heading [level=3]: "研究原名 {count} 732e6dd4-6115-4ff8-96ce-49cf490299d4"
                                - generic:
                                  - generic: Completed
                                  - button
                              - generic: 核对储能并网政策，保留原始研究目标。
                              - generic:
                                - generic:
                                  - generic: Generate report
                                  - generic: Step 3 of 3
                                - progressbar
                              - generic:
                                - generic: 1 source
                                - time: Updated 11/4/2026
                            - generic:
                              - button: View research report
                        - link:
                          - /url: /research/new
                          - generic: New research
      - navigation:
        - link:
          - /url: /chat
          - generic: Chats
        - link:
          - /url: /projects
          - generic: Projects
        - link:
          - /url: /tasks
          - generic: Tasks
        - link:
          - /url: /profile
          - generic: Me
  - dialog [ref=f4e2]:
    - heading "Edit research" [level=2] [ref=f4e3]
    - paragraph [ref=f4e4]: Edit the name and tags to make this easier to find and organize.
    - generic [ref=f4e5]:
      - generic [ref=f4e6]:
        - text: research name
        - textbox "research name" [ref=f4e7]: "研究原名 {count} 732e6dd4-6115-4ff8-96ce-49cf490299d4"
      - generic [ref=f4e8]:
        - generic [ref=f4e9]:
          - generic [ref=f4e10]: Tags (optional)
          - generic [ref=f4e11]: 0/5
        - generic [ref=f4e12]:
          - textbox "Add tag" [active] [ref=f4e14]:
            - /placeholder: Tag; press Enter to add
            - text: 原始标签
          - button "＋ Create tag “原始标签” You can also press Enter" [ref=f4e16] [cursor=pointer]:
            - generic [ref=f4e17]: ＋ Create tag “原始标签”
            - generic [ref=f4e18]: You can also press Enter
          - generic [ref=f4e19]: Type to search existing tags; press Enter to create one
      - generic [ref=f4e20]:
        - button "Cancel" [ref=f4e21] [cursor=pointer]
        - button "Save changes" [ref=f4e22] [cursor=pointer]
    - button "Close" [ref=f4e23] [cursor=pointer]
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import { randomUUID } from "node:crypto";
  3   | import { research as C } from "@repo/contracts";
  4   | import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";
  5   |
  6   | const pathOf = (url: string) => new URL(url).pathname.replace(/^\/__fullstack_api/, "");
  7   |
  8   | test("research locale preserves the real intake, plan, saved report and history management journey", async ({ page, context }) => {
  9   |   test.setTimeout(180_000);
  10  |   const errors: string[] = [];
  11  |   page.on("pageerror", error => errors.push(error.message));
  12  |   const rawName = `研究原名 {count} ${randomUUID()}`;
  13  |   const rawGoal = "核对储能并网政策，保留原始研究目标。";
  14  |   const rawPlan = "核实政策适用范围与实施约束";
  15  |   let commands = 0;
  16  |   page.on("request", request => {
  17  |     if (/\/runtime\/commands(?:\/stream)?$/.test(pathOf(request.url())) && request.method() === "POST") commands++;
  18  |   });
  19  |   await page.goto("/login");
  20  |   await page.getByTestId("language-switcher").selectOption("en");
  21  |   await page.getByTestId("login-email").fill(F.email);
  22  |   await page.getByTestId("login-password").fill(F.password);
  23  |   await page.getByTestId("login-submit").click();
  24  |   await expect(page).toHaveURL(/\/home$/);
  25  |   // Immersive research routes have no global picker. A real same-context page
  26  |   // sends the application's BroadcastChannel locale update without remounting research.
  27  |   const languagePage = await context.newPage();
  28  |   await languagePage.goto("/research");
  29  |   const language = async (locale: "en" | "zh-CN") => {
  30  |     await languagePage.getByTestId("language-switcher").first().selectOption(locale);
  31  |   };
  32  |   const screenshot = async (name: string) => {
  33  |     for (const width of [375, 1280]) {
  34  |       await page.setViewportSize({ width, height: 900 });
  35  |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  36  |       await page.evaluate(() => window.scrollTo(0, 0));
  37  |       for (const text of ["Confirm research details", "Research plan", "Generate report"]) {
  38  |         const label = page.getByTestId("research-flow-progress").getByText(text, { exact: true });
> 39  |         expect(await label.evaluate(element => {
      |                            ^ Error: locator.evaluate: Test timeout of 180000ms exceeded.
  40  |           const cell = element.closest("li")!.getBoundingClientRect();
  41  |           const bounds = element.getBoundingClientRect();
  42  |           return element.scrollWidth <= element.clientWidth && bounds.left >= cell.left - 1 && bounds.right <= cell.right + 1;
  43  |         })).toBe(true);
  44  |       }
  45  |       await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
  46  |     }
  47  |   };
  48  |   await page.goto("/research");
  49  |   await expect(page.getByRole("heading", { name: "Research", exact: true })).toBeVisible();
  50  |   await page.getByTestId("research-create").click();
  51  |   await expect(page).toHaveURL(/\/research\/new$/);
  52  |   await page.getByText("Add research details", { exact: true }).click();
  53  |   await page.getByTestId("research-brief-topic").fill(rawName);
  54  |   await page.getByTestId("research-brief-goal").fill(rawGoal);
  55  |   await language("zh-CN");
  56  |   await expect(page.getByRole("heading", { name: "告诉 AI 你想研究什么" })).toBeVisible();
  57  |   await expect(page.getByTestId("research-brief-topic")).toHaveValue(rawName);
  58  |   await language("en");
  59  |   await expect(page.getByRole("heading", { name: "Tell AI what you want to research" })).toBeVisible();
  60  |   await page.getByTestId("research-flow-back").click();
  61  |   await expect(page.getByRole("heading", { name: "Unsaved research changes" })).toBeVisible();
  62  |   await screenshot("intake-unsaved-en");
  63  |   await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  64  |   const created = page.waitForResponse(response => pathOf(response.url()) === C.operations.createGuidedResearchSession.path && response.request().method() === "POST");
  65  |   await page.getByTestId("research-confirm-brief").click();
  66  |   const createResponse = await created;
  67  |   expect(createResponse.ok()).toBe(true);
  68  |   expect(createResponse.request().postDataJSON().brief).toMatchObject({ topic: rawName, goal: rawGoal });
  69  |   await expect(page).toHaveURL(/\/research\/[^/]+\/plan$/);
  70  |   await page.getByRole("button", { name: "Previous step", exact: true }).click();
  71  |   await expect(page).toHaveURL(/\/research\/[^/]+\/import$/);
  72  |   await expect(page.getByRole("textbox", { name: "Research requirements", exact: true })).toHaveValue(rawGoal);
  73  |   const beforeImportSwitch = commands;
  74  |   await language("zh-CN");
  75  |   await expect(page.getByRole("textbox", { name: "研究需求", exact: true })).toHaveValue(rawGoal);
  76  |   await language("en");
  77  |   await page.getByTestId("research-flow-progress").getByRole("button", { name: /Research plan$/ }).click();
  78  |   await expect(page).toHaveURL(/\/research\/[^/]+\/plan$/);
  79  |   expect(commands).toBe(beforeImportSwitch);
  80  |   await page.getByRole("button", { name: /^Edit plan 1/ }).click();
  81  |   const plan = page.getByRole("textbox", { name: "Plan 1", exact: true });
  82  |   await plan.fill(rawPlan);
  83  |   const beforeSwitch = commands;
  84  |   await language("zh-CN");
  85  |   await expect(page.getByRole("textbox", { name: "计划 1", exact: true })).toHaveValue(rawPlan);
  86  |   await language("en");
  87  |   await expect(plan).toHaveValue(rawPlan);
  88  |   expect(commands).toBe(beforeSwitch);
  89  |   await page.getByRole("button", { name: "Save plan", exact: true }).click();
  90  |   await expect(page.getByRole("heading", { name: "Save research plan?" })).toBeVisible();
  91  |   await screenshot("plan-confirm-en");
  92  |   const saved = page.waitForResponse(response => response.url().endsWith("/runtime/commands") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "save");
  93  |   await page.getByRole("button", { name: "Confirm save", exact: true }).click();
  94  |   expect((await saved).ok()).toBe(true);
  95  |   await page.reload();
  96  |   await page.getByRole("button", { name: /^Edit plan 1/ }).click();
  97  |   await expect(plan).toHaveValue(rawPlan);
  98  |   await plan.press("Enter");
  99  |   const generated = page.waitForResponse(response => response.url().endsWith("/runtime/commands/stream") && response.request().postDataJSON()?.action === "generate_report");
  100 |   await page.getByRole("button", { name: "Generate report", exact: true }).click();
  101 |   const stream = await generated;
  102 |   expect(stream.headers()["content-type"]).toContain("application/x-ndjson");
  103 |   await expect(page).toHaveURL(/\/research\/[^/]+\/report$/);
  104 |   await expect(page.getByTestId("research-report-document")).toBeVisible({ timeout: 60_000 });
  105 |   const runtimeUrl = stream.url().replace(/\/commands\/stream$/, "");
  106 |   const runtime = await page.request.get(runtimeUrl, { headers: { authorization: stream.request().headers()["authorization"]! } });
  107 |   expect(runtime.ok()).toBe(true);
  108 |   const body = C.GuidedResearchRuntime.parse(await runtime.json());
  109 |   expect(body.completed).toBe(true);
  110 |   expect(body.brief.goal).toBe(rawGoal);
  111 |   expect(body.outline[0]!.title).toBe(rawPlan);
  112 |   await expect(page.getByTestId("research-report-document")).toContainText(body.report!.title);
  113 |   await expect(page.getByTestId("research-report-document")).toContainText("执行摘要");
  114 |   await expect(page.getByTestId("guided-research-report-contents")).toContainText("Report contents");
  115 |   const terminalCommands = commands;
  116 |   await language("zh-CN");
  117 |   await expect(page.getByTestId("research-report-document")).toContainText("执行摘要");
  118 |   await language("en");
  119 |   await expect(page.getByRole("button", { name: "Generate PDF", exact: true })).toBeEnabled();
  120 |   await expect(page.getByRole("button", { name: "Generate Word", exact: true })).toBeEnabled();
  121 |   expect(commands).toBe(terminalCommands);
  122 |   const unchanged = await page.request.get(runtimeUrl, { headers: { authorization: stream.request().headers()["authorization"]! } });
  123 |   expect(unchanged.ok()).toBe(true);
  124 |   expect(JSON.stringify(C.GuidedResearchRuntime.parse(await unchanged.json()).report)).toBe(JSON.stringify(body.report));
  125 |   await screenshot("report-en");
  126 |   await page.getByTestId("research-report-more-actions").click();
  127 |   await expect(page.getByRole("menuitem", { name: "Regenerate report", exact: true })).toBeVisible();
  128 |   const regenerated = page.waitForResponse(response => response.url().endsWith("/runtime/commands/stream") && response.request().postDataJSON()?.action === "generate_report");
  129 |   await page.getByRole("menuitem", { name: "Regenerate report", exact: true }).click();
  130 |   const regeneration = await regenerated;
  131 |   expect(regeneration.headers()["content-type"]).toContain("application/x-ndjson");
  132 |   await expect.poll(async () => {
  133 |     const response = await page.request.get(runtimeUrl, { headers: { authorization: stream.request().headers()["authorization"]! } });
  134 |     expect(response.ok()).toBe(true);
  135 |     const saved = C.GuidedResearchRuntime.parse(await response.json());
  136 |     return saved.version > regeneration.request().postDataJSON().expectedVersion && !saved.busy && saved.completed && Boolean(saved.reportPrevious?.report);
  137 |   }, { timeout: 60_000 }).toBe(true);
  138 |   const history = page.getByTestId("research-report-history");
  139 |   await expect(history.locator("summary")).toHaveText("Previous report · Historical content, read only");
```
