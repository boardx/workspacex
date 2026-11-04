# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: i18n-interview-journey.spec.ts >> interview locale preserves the real private-profile, canonical six-step and history journey
- Location: e2e/i18n-interview-journey.spec.ts:8:5

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator: getByRole('dialog', { name: 'Add expert profile', exact: true }).getByRole('textbox', { name: '名称', exact: true })
Expected: "私有专家 {count} 535a8c83-7c1f-42e4-8e30-bcb25c1ac8a3"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveValue" with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Add expert profile', exact: true }).getByRole('textbox', { name: '名称', exact: true })

```

```yaml
- navigation "主导航": 0 条未读
- dialog "添加专家画像":
  - heading "添加专家画像" [level=2]
  - paragraph: 个人可复用的模拟画像，不代表真人或 Agent。
  - text: 名称
  - textbox "名称": "私有专家 {count} 535a8c83-7c1f-42e4-8e30-bcb25c1ac8a3"
  - text: 专业角色
  - textbox "专业角色": 原专业角色
  - text: 专业领域
  - textbox "专业领域": 研究
  - text: 研究关注
  - textbox "研究关注": 原始任务与反例
  - text: 观点风格
  - textbox "观点风格": 原始观点风格
  - text: 能力简介
  - textbox "能力简介": 仅用于模拟研究的私有画像
  - text: 局限与材料边界
  - textbox "局限与材料边界": 原始材料边界，仅模拟
  - group "完整专家资料（选填）":
    - text: 完整专家资料（选填）
    - paragraph: 列表每行一项；性格评分 1–10，方向见字段名称。留空表示未填写。
    - text: 分类
    - textbox "分类"
    - text: 所在地
    - textbox "所在地"
    - text: 年龄
    - spinbutton "年龄"
    - text: 职业
    - textbox "职业": 原始职业
    - text: 目标
    - textbox "目标"
    - text: 兴趣
    - textbox "兴趣"
    - text: 痛点
    - textbox "痛点"
    - text: 动机
    - textbox "动机"
    - text: 影响因素
    - textbox "影响因素"
    - text: 内向—外向
    - spinbutton "内向—外向"
    - text: 分析—创造
    - spinbutton "分析—创造"
    - text: 忙碌—时间充裕
    - spinbutton "忙碌—时间充裕"
    - text: 服务价值
    - textbox "服务价值"
    - text: 典型建议
    - textbox "典型建议"
  - button "保存专家"
  - button "关闭"
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import { randomUUID } from "node:crypto";
  3   | import { interviewMarkdown as C } from "@repo/contracts";
  4   | import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";
  5   | 
  6   | const apiPath = (url: string) => new URL(url).pathname.replace(/^\/__fullstack_api/, "");
  7   | 
  8   | test("interview locale preserves the real private-profile, canonical six-step and history journey", async ({ page, context }) => {
  9   |   test.setTimeout(180_000);
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
  55  |   const profile = page.getByRole("dialog", { name: "Add expert profile", exact: true });
  56  |   for (const [name, value] of Object.entries({ Name: rawExpert, "Professional role": "原专业角色", "Professional domains": "研究", "Research focus": "原始任务与反例", "Perspective style": "原始观点风格", Capabilities: "仅用于模拟研究的私有画像", "Limitations and material boundary": "原始材料边界，仅模拟" })) {
  57  |     await profile.getByRole("textbox", { name, exact: true }).fill(value);
  58  |   }
  59  |   await profile.getByRole("textbox", { name: "Occupation", exact: true }).fill("原始职业");
> 60  |   await language("zh-CN"); await expect(profile.getByRole("textbox", { name: "名称", exact: true })).toHaveValue(rawExpert);
      |                                                                                                    ^ Error: expect(locator).toHaveValue(expected) failed
  61  |   await language("en"); await expect(profile.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(rawExpert);
  62  |   await capture("private-profile-en");
  63  |   await profile.getByRole("button", { name: "Save expert", exact: true }).click();
  64  |   await expect(profile).not.toBeVisible();
  65  |   const catalogResponse = await page.request.get("/__fullstack_api/interviews/digital/expert-library", { headers });
  66  |   expect(catalogResponse.ok()).toBe(true);
  67  |   const catalog = await catalogResponse.json();
  68  |   const custom = catalog.items.find((item: { fields: { name: string } }) => item.fields.name === rawExpert);
  69  |   expect(custom).toBeTruthy(); expect(custom.fields.profile.occupation).toBe("原始职业");
  70  |   await page.reload();
  71  |   const customCard = page.getByTestId(`itv-library-${custom.expertId}`);
  72  |   await expect(customCard).toContainText(rawExpert);
  73  |   await customCard.getByRole("button", { name: `View profile ${rawExpert}`, exact: true }).click();
  74  |   await expect(page.getByRole("dialog", { name: rawExpert, exact: true })).toContainText("原始职业");
  75  |   await page.keyboard.press("Escape");
  76  |   await expect(customCard.getByRole("button", { name: `View profile ${rawExpert}`, exact: true })).toBeFocused();
  77  |   await page.goto("/itv/new");
  78  |   const create = page.getByRole("dialog", { name: "New interview", exact: true });
  79  |   await create.getByRole("textbox", { name: "Interview name", exact: true }).fill(rawName);
  80  |   await capture("create-interview-en");
  81  |   await create.getByRole("button", { name: "Start interview", exact: true }).click();
  82  |   await expect(page).toHaveURL(/\/itv\/[^/]+\/intake$/);
  83  |   const id = new URL(page.url()).pathname.split("/")[2]!;
  84  |   const sourceUrl = `/__fullstack_api/interviews/digital/${encodeURIComponent(id)}/markdown`;
  85  |   const readSource = async () => { const response = await page.request.get(sourceUrl, { headers }); expect(response.ok()).toBe(true); return C.InterviewMarkdownEnvelope.parse(await response.json()); };
  86  |   const demand = page.getByRole("textbox", { name: "Research requirements Markdown", exact: true });
  87  |   await expect(demand).toBeEnabled(); await demand.fill(rawGoal);
  88  |   const beforeSwitch = writes;
  89  |   await language("zh-CN"); await expect(page.getByRole("textbox", { name: "研究需求 Markdown", exact: true })).toHaveValue(rawGoal);
  90  |   await language("en"); await expect(demand).toHaveValue(rawGoal); expect(writes).toBe(beforeSwitch);
  91  |   page.once("dialog", async dialog => { expect(dialog.message()).toContain("unsaved Markdown"); await dialog.dismiss(); });
  92  |   await page.getByRole("button", { name: "Back to interviews", exact: true }).click();
  93  |   await expect(page).toHaveURL(new RegExp(`/itv/${id}/intake$`));
  94  |   await capture("interview-intake-en", true);
  95  |   await page.getByRole("button", { name: "Next: confirm analysis", exact: true }).click();
  96  |   await expect(page).toHaveURL(/\/analysis$/);
  97  |   expect((await readSource()).documents.find(document => document.step === "intake")?.markdown).toBe(rawGoal);
  98  |   await page.getByRole("button", { name: "Select experts", exact: true }).click();
  99  |   await expect(page).toHaveURL(/\/experts$/);
  100 |   await page.getByTestId(`itv-library-${custom.expertId}`).getByRole("button", { name: `Add profile ${rawExpert}`, exact: true }).click();
  101 |   await expect.poll(async () => (await readSource()).documents.find(document => document.step === "experts")?.markdown).toContain(`#expert-${custom.expertId}`);
  102 |   await capture("interview-experts-en", true);
  103 |   await page.getByRole("button", { name: "Confirm experts and generate questions", exact: true }).click();
  104 |   await expect(page).toHaveURL(/\/outline$/);
  105 |   const question = page.getByRole("textbox", { name: "Edit question 1", exact: true });
  106 |   await expect(question).toBeEnabled(); await question.fill("用户原始修改的问题？");
  107 |   await language("zh-CN"); await language("en"); await expect(question).toHaveValue("用户原始修改的问题？");
  108 |   await page.getByRole("button", { name: "Save question draft", exact: true }).click();
  109 |   await expect.poll(async () => (await readSource()).documents.find(document => document.step === "outline")?.markdown).toContain("用户原始修改的问题？");
  110 |   await page.reload(); await expect(question).toHaveValue("用户原始修改的问题？");
  111 |   await capture("interview-outline-en", true);
  112 |   await page.getByRole("button", { name: "Confirm questions and start interviews", exact: true }).click();
  113 |   await expect(page).toHaveURL(/\/runs$/);
  114 |   const generateReport = page.getByRole("button", { name: "Generate report", exact: true });
  115 |   await expect(generateReport).toBeEnabled({ timeout: 60_000 });
  116 |   await capture("interview-runs-en", true);
  117 |   await generateReport.click();
  118 |   await expect(page).toHaveURL(/\/report$/);
  119 |   await expect(page.getByTestId("itv-source-report-markdown")).toContainText("确定性测试模型", { timeout: 60_000 });
  120 |   await expect.poll(async () => {
  121 |     const current = await readSource(); const report = current.documents.find(document => document.step === "report");
  122 |     const state = current.states.find(state => state.documentId === report?.documentId);
  123 |     return Boolean(report && state && ["draft", "confirmed", "completed"].includes(state.status) && !state.failure && report.references.some(reference => reference.locator));
  124 |   }, { timeout: 60_000 }).toBe(true);
  125 |   const saved = await readSource(); const report = saved.documents.find(document => document.step === "report")!;
  126 |   expect(report.references.some(reference => reference.locator)).toBe(true);
  127 |   const terminalWrites = writes;
  128 |   await language("zh-CN"); await expect(page.getByRole("navigation", { name: "报告目录", exact: true })).toBeVisible();
  129 |   await language("en"); await expect(page.getByRole("navigation", { name: "Report contents", exact: true })).toBeVisible();
  130 |   const unchanged = await readSource(); expect(unchanged.version).toBe(saved.version);
  131 |   expect(unchanged.documents.find(document => document.step === "report")).toEqual(report); expect(writes).toBe(terminalWrites);
  132 |   await capture("interview-report-en", true);
  133 |   await page.getByRole("button", { name: "Back to interviews", exact: true }).click();
  134 |   await page.getByTestId(`itv-history-actions-${id}`).click(); await page.getByTestId(`itv-history-edit-${id}`).click();
  135 |   await page.getByTestId("itv-edit-name").fill(rawName); await page.getByTestId("itv-edit-tag-input").fill("原始标签");
  136 |   await language("zh-CN"); await language("en"); await expect(page.getByTestId("itv-edit-tag-input")).toHaveValue("原始标签");
  137 |   await capture("interview-metadata-en"); await page.getByTestId("itv-edit-submit").click();
  138 |   await expect(page.getByTestId("itv-edit-dialog")).not.toBeVisible(); await page.reload();
  139 |   await expect(page.getByTestId(`itv-history-card-${id}`)).toContainText("原始标签");
  140 |   await page.getByTestId(`itv-history-actions-${id}`).click(); await page.getByTestId(`itv-history-delete-${id}`).click();
  141 |   await expect(page.getByRole("dialog")).toContainText("interview");
  142 |   await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(page.getByTestId(`itv-history-card-${id}`)).toBeVisible();
  143 |   expect(errors).toEqual([]);
  144 | });
  145 | 
```