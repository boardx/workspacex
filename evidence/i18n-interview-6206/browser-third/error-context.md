# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: i18n-interview-journey.spec.ts >> interview locale preserves the real private-profile, canonical six-step and history journey
- Location: e2e/i18n-interview-journey.spec.ts:8:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=f5e1]:
  - alert [ref=f5e2]
  - generic [ref=f5e3]:
    - link "Skip to main content" [ref=f5e4] [cursor=pointer]:
      - /url: "#wsx-main-content"
    - main [ref=f5e7]:
      - generic [ref=f5e8]:
        - generic [ref=f5e9]:
          - generic [ref=f5e12]:
            - generic [ref=f5e13]:
              - button "Back to interviews" [ref=f5e14] [cursor=pointer]
              - generic [ref=f5e19]: Interviews
            - generic:
              - generic [ref=f5e20]: "Status: Markdown research workbench"
              - generic [ref=f5e21]: Version 19
          - generic [ref=f5e22]:
            - 'heading "原始访谈 {count} d5ade201-f9f9-41b2-b307-acdea6b3e77b" [level=1] [ref=f5e23]'
            - navigation "Interview steps" [ref=f5e24]:
              - list [ref=f5e25]:
                - listitem [ref=f5e26]:
                  - button "Completed Import requirements Save research Markdown" [ref=f5e27] [cursor=pointer]:
                    - generic [ref=f5e28]: Completed
                    - generic [ref=f5e32]: Import requirements
                    - generic [ref=f5e33]: Save research Markdown
                - listitem [ref=f5e35]:
                  - button "Completed Confirm analysis Review AI analysis" [ref=f5e36] [cursor=pointer]:
                    - generic [ref=f5e37]: Completed
                    - generic [ref=f5e41]: Confirm analysis
                    - generic [ref=f5e42]: Review AI analysis
                - listitem [ref=f5e44]:
                  - button "Completed Select experts Confirm expert profiles" [ref=f5e45] [cursor=pointer]:
                    - generic [ref=f5e46]: Completed
                    - generic [ref=f5e50]: Select experts
                    - generic [ref=f5e51]: Confirm expert profiles
                - listitem [ref=f5e53]:
                  - button "Completed Interview questions Confirm each expert outline" [ref=f5e54] [cursor=pointer]:
                    - generic [ref=f5e55]: Completed
                    - generic [ref=f5e59]: Interview questions
                    - generic [ref=f5e60]: Confirm each expert outline
                - listitem [ref=f5e62]:
                  - button "Completed Start interviews Run simulated interviews" [ref=f5e63] [cursor=pointer]:
                    - generic [ref=f5e64]: Completed
                    - generic [ref=f5e68]: Start interviews
                    - generic [ref=f5e69]: Run simulated interviews
                - listitem [ref=f5e71]:
                  - button "6 Generate report Review the research report" [ref=f5e72] [cursor=pointer]:
                    - generic [ref=f5e73]: "6"
                    - generic [ref=f5e74]: Generate report
                    - generic [ref=f5e75]: Review the research report
        - main [ref=f5e76]:
          - generic [ref=f5e79]:
            - heading "Research report" [level=2] [ref=f5e81]
            - generic [ref=f5e82]:
              - navigation "Report contents" [ref=f5e83]:
                - heading "Contents" [level=3] [ref=f5e85]
                - list [ref=f5e86]:
                  - listitem [ref=f5e87]:
                    - link "研究目标" [ref=f5e88] [cursor=pointer]:
                      - /url: "#section-1"
                  - listitem [ref=f5e89]:
                    - link "访谈对象与专家类型" [ref=f5e90] [cursor=pointer]:
                      - /url: "#section-2"
                  - listitem [ref=f5e91]:
                    - link "研究范围" [ref=f5e92] [cursor=pointer]:
                      - /url: "#section-3"
                  - listitem [ref=f5e93]:
                    - link "成功标准" [ref=f5e94] [cursor=pointer]:
                      - /url: "#section-4"
                  - listitem [ref=f5e95]:
                    - link "研究建议" [ref=f5e96] [cursor=pointer]:
                      - /url: "#section-5"
                  - listitem [ref=f5e97]:
                    - link "待验证假设" [ref=f5e98] [cursor=pointer]:
                      - /url: "#section-6"
                  - listitem [ref=f5e99]:
                    - link "适用边界" [ref=f5e100] [cursor=pointer]:
                      - /url: "#section-7"
                  - listitem [ref=f5e101]:
                    - link "资料：experts" [ref=f5e102] [cursor=pointer]:
                      - /url: "#section-8"
                  - listitem [ref=f5e103]:
                    - 'link "私有专家 {count} 8add127d-42e6-470f-bd07-e87ecf5fa4cf" [ref=f5e104] [cursor=pointer]':
                      - /url: "#section-9"
                  - listitem [ref=f5e105]:
                    - link "专业角色" [ref=f5e106] [cursor=pointer]:
                      - /url: "#section-10"
                  - listitem [ref=f5e107]:
                    - link "专业领域" [ref=f5e108] [cursor=pointer]:
                      - /url: "#section-11"
                  - listitem [ref=f5e109]:
                    - link "研究关注" [ref=f5e110] [cursor=pointer]:
                      - /url: "#section-12"
                  - listitem [ref=f5e111]:
                    - link "观点风格" [ref=f5e112] [cursor=pointer]:
                      - /url: "#section-13"
                  - listitem [ref=f5e113]:
                    - link "简介" [ref=f5e114] [cursor=pointer]:
                      - /url: "#section-14"
                  - listitem [ref=f5e115]:
                    - link "局限与材料边界" [ref=f5e116] [cursor=pointer]:
                      - /url: "#section-15"
                  - listitem [ref=f5e117]:
                    - link "职业" [ref=f5e118] [cursor=pointer]:
                      - /url: "#section-16"
                  - listitem [ref=f5e119]:
                    - link "资料：intake" [ref=f5e120] [cursor=pointer]:
                      - /url: "#section-17"
                  - listitem [ref=f5e121]:
                    - link "原始研究需求" [ref=f5e122] [cursor=pointer]:
                      - /url: "#section-18"
                  - listitem [ref=f5e123]:
                    - link "研究目标" [ref=f5e124] [cursor=pointer]:
                      - /url: "#section-19"
                  - listitem [ref=f5e125]:
                    - link "资料：outline" [ref=f5e126] [cursor=pointer]:
                      - /url: "#section-20"
                  - listitem [ref=f5e127]:
                    - 'link "私有专家 {count} 8add127d-42e6-470f-bd07-e87ecf5fa4cf" [ref=f5e128] [cursor=pointer]':
                      - /url: "#section-21"
                  - listitem [ref=f5e129]:
                    - link "资料：runs" [ref=f5e130] [cursor=pointer]:
                      - /url: "#section-22"
                  - listitem [ref=f5e131]:
                    - link "模拟访谈记录" [ref=f5e132] [cursor=pointer]:
                      - /url: "#section-23"
                  - listitem [ref=f5e133]:
                    - link "custom-expert-e7a1d738-1888-4000-9cd5-3eb2bd0ffcee" [ref=f5e134] [cursor=pointer]:
                      - /url: "#section-24"
                  - listitem [ref=f5e135]:
                    - link "Q1：用户原始修改的问题？" [ref=f5e136] [cursor=pointer]:
                      - /url: "#section-25"
                  - listitem [ref=f5e137]:
                    - link "Q2：是否有与该经历相反的案例？" [ref=f5e138] [cursor=pointer]:
                      - /url: "#section-26"
              - article [ref=f5e139]:
                - generic [ref=f5e140]:
                  - paragraph [ref=f5e141]: "[loopback] ## 资料：analysis 内部来源元数据：evidenceMode=simulated"
                  - heading "研究目标" [level=2] [ref=f5e142]
                  - paragraph [ref=f5e143]: 受控测试提案：核对需求中的实际行为及其约束，研究问题须由人工审阅。
                  - heading "访谈对象与专家类型" [level=2] [ref=f5e144]
                  - paragraph [ref=f5e145]: 建议招募需求涉及的执行者及协作角色，具体身份与人数待人工确认。
                  - heading "研究范围" [level=2] [ref=f5e146]
                  - paragraph [ref=f5e147]: 依据输入需求比较实际场景，地区、时间窗、排除范围均待确认。
                  - heading "成功标准" [level=2] [ref=f5e148]
                  - paragraph [ref=f5e149]: 收集可比较的具体案例与反例，不以证实预设结论作为成功标准。
                  - heading "研究建议" [level=2] [ref=f5e150]
                  - list [ref=f5e151]:
                    - listitem [ref=f5e152]: 请受访者回溯最近一次相关经历的具体时间线，区分回忆与可核对记录。
                    - listitem [ref=f5e153]: 对比不同角色在相同场景中的约束，寻找可以交叉核对的行为材料。
                    - listitem [ref=f5e154]: 主动追问与初步假设不一致的案例，记录差异和仍需验证的信息。
                  - heading "待验证假设" [level=2] [ref=f5e155]
                  - paragraph [ref=f5e156]: 待验证：角色之间可能存在不同约束，需要寻找相反案例并比较解释。
                  - heading "适用边界" [level=2] [ref=f5e157]
                  - paragraph [ref=f5e158]: 这是显式回环模型的确定性测试提案，不是真实模型质量证据；回忆与口述为自报材料，模拟画像不能替代真人证据。
                  - heading "资料：experts" [level=2] [ref=f5e159]
                  - paragraph [ref=f5e160]: 内部来源元数据：evidenceMode=simulated
                  - heading [level=2] [ref=f5e161]:
                    - 'link "私有专家 {count} 8add127d-42e6-470f-bd07-e87ecf5fa4cf" [ref=f5e162] [cursor=pointer]':
                      - /url: "#expert-custom-expert-e7a1d738-1888-4000-9cd5-3eb2bd0ffcee"
                  - heading "专业角色" [level=3] [ref=f5e163]
                  - paragraph [ref=f5e164]: 原专业角色
                  - heading "专业领域" [level=3] [ref=f5e165]
                  - paragraph [ref=f5e166]: 研究
                  - heading "研究关注" [level=3] [ref=f5e167]
                  - paragraph [ref=f5e168]: 原始任务与反例
                  - heading "观点风格" [level=3] [ref=f5e169]
                  - paragraph [ref=f5e170]: 原始观点风格
                  - heading "简介" [level=3] [ref=f5e171]
                  - paragraph [ref=f5e172]: 仅用于模拟研究的私有画像
                  - heading "局限与材料边界" [level=3] [ref=f5e173]
                  - paragraph [ref=f5e174]: 原始材料边界，仅模拟
                  - heading "职业" [level=3] [ref=f5e175]
                  - paragraph [ref=f5e176]: 原始职业
                  - paragraph [ref=f5e177]: 材料边界：模拟画像，仅用于模拟研究，不作为真人访谈证据。
                  - heading "资料：intake" [level=2] [ref=f5e178]
                  - paragraph [ref=f5e179]: 内部来源元数据：evidenceMode=simulated
                  - heading "原始研究需求" [level=1] [ref=f5e180]
                  - heading "研究目标" [level=2] [ref=f5e181]
                  - paragraph [ref=f5e182]: 核对最近一次任务的具体经过和相反案例，保留客户原文。
                  - heading "资料：outline" [level=2] [ref=f5e183]
                  - paragraph [ref=f5e184]: 内部来源元数据：evidenceMode=simulated
                  - heading [level=2] [ref=f5e185]:
                    - 'link "私有专家 {count} 8add127d-42e6-470f-bd07-e87ecf5fa4cf" [ref=f5e186] [cursor=pointer]':
                      - /url: "#expert-custom-expert-e7a1d738-1888-4000-9cd5-3eb2bd0ffcee"
                  - list [ref=f5e187]:
                    - listitem [ref=f5e188]: 用户原始修改的问题？
                    - listitem [ref=f5e189]: 是否有与该经历相反的案例？
                  - heading "资料：runs" [level=2] [ref=f5e190]
                  - paragraph [ref=f5e191]: 内部来源元数据：evidenceMode=simulated
                  - heading "模拟访谈记录" [level=1] [ref=f5e192]
                  - paragraph [ref=f5e193]: 以下回答来自模型模拟，需真人验证。
                  - heading [level=2] [ref=f5e194]:
                    - link "custom-expert-e7a1d738-1888-4000-9cd5-3eb2bd0ffcee" [ref=f5e195] [cursor=pointer]:
                      - /url: "#expert-custom-expert-e7a1d738-1888-4000-9cd5-3eb2bd0ffcee"
                  - heading "Q1：用户原始修改的问题？" [level=3] [ref=f5e196]
                  - paragraph [ref=f5e197]: 模拟回答：确定性测试模型提供的场景材料，仅用于验证保存与显示。本次模拟案例先核对任务约束，再尝试小范围操作。
                  - heading "Q2：是否有与该经历相反的案例？" [level=3] [ref=f5e198]
                  - paragraph [ref=f5e199]: 模拟回答：确定性测试模型提供的场景材料，仅用于验证保存与显示。相反的模拟案例可以继续操作，具体原因仍未知，需独立核对。
            - generic [ref=f5e200]:
              - generic [ref=f5e202]:
                - button "Generate PDF" [ref=f5e203] [cursor=pointer]
                - button "Generate Word" [ref=f5e204] [cursor=pointer]
              - button "Share report" [ref=f5e205] [cursor=pointer]
```

# Test source

```ts
  47  |       const dialog = page.getByRole("dialog");
  48  |       if (await dialog.count()) {
  49  |         const box = await dialog.boundingBox(); expect(box).not.toBeNull();
  50  |         expect(box!.x).toBeGreaterThanOrEqual(8); expect(box!.x + box!.width).toBeLessThanOrEqual(width - 8);
  51  |         expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  52  |       }
  53  |       await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
  54  |     }
  55  |   };
  56  |   await page.goto("/itv?tab=experts");
  57  |   await page.getByTestId("itv-add-library-expert").click();
  58  |   const profile = page.getByRole("dialog");
  59  |   await expect(profile).toHaveCount(1);
  60  |   await expect(profile.getByRole("heading", { name: "Add expert profile", exact: true })).toBeVisible();
  61  |   for (const [name, value] of Object.entries({ Name: rawExpert, "Professional role": "原专业角色", "Professional domains": "研究", "Research focus": "原始任务与反例", "Perspective style": "原始观点风格", Capabilities: "仅用于模拟研究的私有画像", "Limitations and material boundary": "原始材料边界，仅模拟" })) {
  62  |     await profile.getByRole("textbox", { name, exact: true }).fill(value);
  63  |   }
  64  |   await profile.getByRole("textbox", { name: "Occupation", exact: true }).fill("原始职业");
  65  |   await language("zh-CN"); await expect(profile.getByRole("heading", { name: "添加专家画像", exact: true })).toBeVisible(); await expect(profile.getByRole("textbox", { name: "名称", exact: true })).toHaveValue(rawExpert);
  66  |   await language("en"); await expect(profile.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(rawExpert);
  67  |   await capture("private-profile-en");
  68  |   await profile.getByRole("button", { name: "Save expert", exact: true }).click();
  69  |   await expect(profile).not.toBeVisible();
  70  |   const catalogResponse = await page.request.get("/__fullstack_api/interviews/digital/expert-library", { headers });
  71  |   expect(catalogResponse.ok()).toBe(true);
  72  |   const catalog = await catalogResponse.json();
  73  |   const custom = catalog.items.find((item: { fields: { name: string } }) => item.fields.name === rawExpert);
  74  |   expect(custom).toBeTruthy(); expect(custom.fields.profile.occupation).toBe("原始职业");
  75  |   await page.reload();
  76  |   const customCard = page.getByTestId(`itv-library-${custom.expertId}`);
  77  |   await expect(customCard).toContainText(rawExpert);
  78  |   await customCard.getByRole("button", { name: `View profile ${rawExpert}`, exact: true }).click();
  79  |   await expect(page.getByRole("dialog", { name: rawExpert, exact: true })).toContainText("原始职业");
  80  |   await capture("private-profile-detail-en");
  81  |   await page.keyboard.press("Escape");
  82  |   await expect(customCard.getByRole("button", { name: `View profile ${rawExpert}`, exact: true })).toBeFocused();
  83  |   await page.goto("/itv/new");
  84  |   const create = page.getByRole("dialog", { name: "New interview", exact: true });
  85  |   await create.getByRole("textbox", { name: "Interview name", exact: true }).fill(rawName);
  86  |   await capture("create-interview-en");
  87  |   await create.getByRole("button", { name: "Start interview", exact: true }).click();
  88  |   await expect(page).toHaveURL(/\/itv\/[^/]+\/intake$/);
  89  |   const id = new URL(page.url()).pathname.split("/")[2]!;
  90  |   const sourceUrl = `/__fullstack_api/interviews/digital/${encodeURIComponent(id)}/markdown`;
  91  |   const readSource = async () => { const response = await page.request.get(sourceUrl, { headers }); expect(response.ok()).toBe(true); return C.InterviewMarkdownEnvelope.parse(await response.json()); };
  92  |   const demand = page.getByRole("textbox", { name: "Research requirements Markdown", exact: true });
  93  |   await expect(demand).toBeEnabled(); await demand.fill(rawGoal);
  94  |   const beforeSwitch = writes;
  95  |   await language("zh-CN"); await expect(page.getByRole("textbox", { name: "研究需求 Markdown", exact: true })).toHaveValue(rawGoal);
  96  |   await language("en"); await expect(demand).toHaveValue(rawGoal); expect(writes).toBe(beforeSwitch);
  97  |   page.once("dialog", async dialog => { expect(dialog.message()).toContain("unsaved Markdown"); await dialog.dismiss(); });
  98  |   await page.getByRole("button", { name: "Back to interviews", exact: true }).click();
  99  |   await expect(page).toHaveURL(new RegExp(`/itv/${id}/intake$`));
  100 |   await capture("interview-intake-en", true);
  101 |   await page.getByRole("button", { name: "Next: confirm analysis", exact: true }).click();
  102 |   await expect(page).toHaveURL(/\/analysis$/);
  103 |   await capture("interview-analysis-en", true);
  104 |   expect((await readSource()).documents.find(document => document.step === "intake")?.markdown).toBe(rawGoal);
  105 |   await page.getByRole("button", { name: "Select experts", exact: true }).click();
  106 |   await expect(page).toHaveURL(/\/experts$/);
  107 |   await page.getByTestId(`itv-library-${custom.expertId}`).getByRole("button", { name: `Add profile ${rawExpert}`, exact: true }).click();
  108 |   await expect.poll(async () => (await readSource()).documents.find(document => document.step === "experts")?.markdown).toContain(`#expert-${custom.expertId}`);
  109 |   await capture("interview-experts-en", true);
  110 |   await page.getByRole("button", { name: "Confirm experts and generate questions", exact: true }).click();
  111 |   // Expert confirmation also confirms the generated outline and starts execution.
  112 |   // Edit through the real revision action; confirmed source must remain read-only.
  113 |   await expect(page).toHaveURL(/\/runs$/);
  114 |   await expect(page.getByRole("button", { name: "Generate report", exact: true })).toBeEnabled();
  115 |   const beforeRevision = await readSource();
  116 |   expect(beforeRevision.execution?.status).toBe("completed");
  117 |   const confirmedOutline = beforeRevision.documents.find(document => document.step === "outline")!;
  118 |   await page.getByTestId("itv-workbench-step-outline").click();
  119 |   await expect(page).toHaveURL(/\/outline$/);
  120 |   const question = page.getByRole("textbox", { name: "Edit question 1", exact: true });
  121 |   await expect(question).toBeDisabled();
  122 |   page.once("dialog", async dialog => { expect(dialog.message()).toContain("preserves the previous version"); await dialog.accept(); });
  123 |   await page.getByRole("button", { name: "Create revision and edit", exact: true }).click();
  124 |   await expect(question).toBeEnabled();
  125 |   const revised = await readSource();
  126 |   expect(revised.revisionId).not.toBe(beforeRevision.revisionId);
  127 |   expect(revised.version).toBeGreaterThan(beforeRevision.version);
  128 |   expect(revised.documents.find(document => document.step === "outline")?.markdown).toBe(confirmedOutline.markdown);
  129 |   await question.fill("用户原始修改的问题？");
  130 |   await language("zh-CN"); await language("en"); await expect(question).toHaveValue("用户原始修改的问题？");
  131 |   await page.getByRole("button", { name: "Save question draft", exact: true }).click();
  132 |   await expect.poll(async () => (await readSource()).documents.find(document => document.step === "outline")?.markdown).toContain("用户原始修改的问题？");
  133 |   await page.reload(); await expect(question).toHaveValue("用户原始修改的问题？");
  134 |   await capture("interview-outline-en", true);
  135 |   await page.getByRole("button", { name: "Confirm questions and start interviews", exact: true }).click();
  136 |   await expect(page).toHaveURL(/\/runs$/);
  137 |   const generateReport = page.getByRole("button", { name: "Generate report", exact: true });
  138 |   await expect(generateReport).toBeEnabled({ timeout: 60_000 });
  139 |   await capture("interview-runs-en", true);
  140 |   await generateReport.click();
  141 |   await expect(page).toHaveURL(/\/report$/);
  142 |   await expect(page.getByTestId("itv-source-report-markdown")).toContainText("确定性测试模型", { timeout: 60_000 });
  143 |   await expect.poll(async () => {
  144 |     const current = await readSource(); const report = current.documents.find(document => document.step === "report");
  145 |     const state = current.states.find(state => state.documentId === report?.documentId);
  146 |     return Boolean(report && state && ["draft", "confirmed", "completed"].includes(state.status) && !state.failure && report.references.some(reference => reference.locator));
> 147 |   }, { timeout: 60_000 }).toBe(true);
      |                           ^ Error: expect(received).toBe(expected) // Object.is equality
  148 |   const saved = await readSource(); const report = saved.documents.find(document => document.step === "report")!;
  149 |   expect(report.references.some(reference => reference.locator)).toBe(true);
  150 |   const terminalWrites = writes;
  151 |   await language("zh-CN"); await expect(page.getByRole("navigation", { name: "报告目录", exact: true })).toBeVisible();
  152 |   await language("en"); await expect(page.getByRole("navigation", { name: "Report contents", exact: true })).toBeVisible();
  153 |   const unchanged = await readSource(); expect(unchanged.version).toBe(saved.version);
  154 |   expect(unchanged.documents.find(document => document.step === "report")).toEqual(report); expect(writes).toBe(terminalWrites);
  155 |   await capture("interview-report-en", true);
  156 |   await page.getByRole("button", { name: "Back to interviews", exact: true }).click();
  157 |   await page.getByTestId(`itv-history-actions-${id}`).click(); await page.getByTestId(`itv-history-edit-${id}`).click();
  158 |   await page.getByTestId("itv-edit-name").fill(rawName); await page.getByTestId("itv-edit-tag-input").fill("原始标签");
  159 |   await language("zh-CN"); await language("en"); await expect(page.getByTestId("itv-edit-tag-input")).toHaveValue("原始标签");
  160 |   await capture("interview-metadata-en"); await page.getByTestId("itv-edit-submit").click();
  161 |   await expect(page.getByTestId("itv-edit-dialog")).not.toBeVisible(); await page.reload();
  162 |   await expect(page.getByTestId(`itv-history-card-${id}`)).toContainText("原始标签");
  163 |   await capture("interview-history-en");
  164 |   await page.getByTestId(`itv-history-actions-${id}`).click(); await page.getByTestId(`itv-history-delete-${id}`).click();
  165 |   await expect(page.getByRole("dialog")).toContainText("interview");
  166 |   await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(page.getByTestId(`itv-history-card-${id}`)).toBeVisible();
  167 |   expect(errors).toEqual([]);
  168 | });
  169 | 
```