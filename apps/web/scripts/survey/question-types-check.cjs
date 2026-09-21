// Real Chromium + HTTP + PostgreSQL evidence; no route mocking or fabricated submission.
require("tsx/cjs");
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 60000 });
const {
  SURVEY_QUESTION_TYPES,
  createSurveyQuestion,
  surveyChoices,
  validateSurveyAnswer,
} = require("@repo/contracts/survey-question-types");
const { SurveyDraftInputSchema } = require("@repo/contracts/survey-runtime");
const {
  getDevModeAccount,
  assertDevModeAllowed,
} = require("@repo/dev-mode-accounts");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const api = process.env.SURVEY_API_URL,
  base = process.env.SURVEY_WEB_URL;
for (const url of [api, base])
  if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw Error("Use isolated local services");
assertDevModeAllowed();
(async () => {
  const preset = getDevModeAccount("consultant");
  const auth = await fetch(api + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: preset.email, password: preset.password }),
  });
  if (!auth.ok) throw Error("login " + auth.status);
  const session = await auth.json();
  async function request(route, body) {
    const r = await fetch(api + route, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${session.sessionToken}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) throw Error(`${route}: ${r.status} ${await r.text()}`);
    return r.json();
  }
  const answerQuestions = SURVEY_QUESTION_TYPES.filter(
    (e) => !["description", "page_break"].includes(e.type),
  ).map((e, i) => {
    const q = createSurveyQuestion(e.type, `browser-${e.type}`, i + 1);
    q.title = `${e.label} · 实际答题验证`;
      if (e.type === "file") q.config.allowedExtensions = ["txt"];
    if (e.type.startsWith("image_"))
      q.config.images = Object.fromEntries(
        surveyChoices(q).map((c) => [
          c.id,
          { url: "/workspacex-logo.png", alt: c.label + "示意图" },
        ]),
      );
    return q;
  });
  assert.equal(answerQuestions.length, 29);
  const description = createSurveyQuestion(
    "description",
    "browser-description",
    1,
  );
  description.config = {
    description: "真实浏览器逐题填写，附件与签名真实上传。",
  };
  const split = answerQuestions.findIndex((q) => q.type === "matrix_single");
  const questions = [
    description,
    ...answerQuestions.slice(0, split),
    createSurveyQuestion("page_break", "browser-page", 1),
    ...answerQuestions.slice(split),
  ].map((q, i) => ({ ...q, order: i + 1 }));
  const draft = SurveyDraftInputSchema.parse({
    title: "29题型真实浏览器验收 " + new Date().toISOString(),
    questions,
    template: {
      id: "browser-report",
      title: "真实题型验收",
      sections: [
        {
          id: "section",
          title: "验收说明",
          blocks: [
            {
              id: "intro",
              type: "text",
              title: "说明",
              text: "真实浏览器逐题填写验收。",
              questionIds: [],
            },
          ],
        },
      ],
    },
  });
  let model = await request("/surveys", draft);
  model = await request(`/surveys/${model.id}/publish`, {
    expectedVersion: model.version,
  });
  const out = path.resolve(
    process.env.SURVEY_EVIDENCE_DIR ||
      "../../docs/evidence/survey-question-types-20260921",
  );
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  try {
    await page.goto(
      base + "/surveys/" + encodeURIComponent(model.publication.token),
      { timeout: 180000, waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("heading", { name: model.title }),
    ).toBeVisible();
    await page.screenshot({ path: path.join(out, "public-desktop.png") });
    const entries = {};
    for (const q of answerQuestions) {
      if (q.type === "matrix_single") {
        await page.getByRole("button", { name: "下一页", exact: true }).click();
        console.log("ALERT AUDIT", await page.getByRole("alert").evaluateAll(elements => elements.map(element => ({ text: element.textContent, html: element.outerHTML }))));
        await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
        await page.setViewportSize({ width: 375, height: 900 });
      }
      const group = page.locator(`[id="answer-${q.id}"]`);
      await group.scrollIntoViewIfNeeded();
      const choices = surveyChoices(q),
        first = choices[0]?.id;
      if (
        ["single", "multi", "scale", "image_single", "image_multi"].includes(
          q.type,
        )
      )
        await group.getByLabel(choices[0].label, { exact: true }).check();
      else if (q.type === "dropdown")
        await group.getByRole("combobox").selectOption(first);
      else if (
        [
          "short",
          "open",
          "number",
          "date",
          "time",
          "datetime",
          "email",
          "phone",
        ].includes(q.type)
      ) {
        const values = {
          short: "真实单行回答",
          open: "真实多行回答\n保留换行与内容。",
          number: "12",
          date: "2026-09-21",
          time: "09:30",
          datetime: "2026-09-21T09:30",
          email: "browser@example.com",
          phone: "13800138000",
        };
        await group.getByLabel(q.title, { exact: true }).fill(values[q.type]);
      } else if (["multiple_text", "address"].includes(q.type)) {
        for (const f of q.config.fields)
          await group
            .getByLabel(`${q.title}：${f.label}`, { exact: true })
            .fill(f.label + "实际内容");
      } else if (q.type === "cascade") {
        for (const [i, v] of q.config.cascadePaths[0].entries())
          await group.getByRole("combobox").nth(i).selectOption(v);
      } else if (["rating", "nps"].includes(q.type))
        await group.getByRole("radio").nth(2).check();
      else if (q.type === "slider") {
        await expect(group).toContainText("尚未选择");
        await group.getByRole("slider").focus();
        await page.keyboard.press("End");
      } else if (q.type.startsWith("matrix_")) {
        for (const row of q.config.rows) {
          if (q.type === "matrix_input")
            await group
              .getByLabel(`${q.title}：${row.label}`, { exact: true })
              .fill(row.label + "真实答案");
          else if (q.type === "matrix_dropdown")
            await group
              .getByLabel(`${q.title}：${row.label}`, { exact: true })
              .selectOption(first);
          else
            await group
              .getByRole("group", { name: row.label, exact: true })
              .getByLabel(choices[0].label, { exact: true })
              .check();
        }
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBe(true);
        await group.screenshot({
          path: path.join(out, `${q.type}-mobile.png`),
        });
      } else if (q.type === "ranking") {
        await expect(group).toContainText("尚未确认排序");
        await group
          .getByRole("button", {
            name: `上移 ${choices[1].label}`,
            exact: true,
          })
          .click();
        await expect(group.getByRole("listitem").first()).toContainText(
          choices[1].label,
        );
        await group.getByRole("listitem").first().focus();
        await page.keyboard.press("ArrowDown");
        await expect(group.getByRole("listitem").first()).toContainText(
          choices[0].label,
        );
        await group
          .getByRole("listitem")
          .nth(1)
          .dragTo(group.getByRole("listitem").nth(0));
        await expect(group.getByRole("listitem").first()).toContainText(
          choices[1].label,
        );
        await group.screenshot({ path: path.join(out, "ranking-mobile.png") });
      } else if (q.type === "allocation") {
        await group
          .getByLabel(`${q.title}：${choices[0].label}`, { exact: true })
          .fill("40");
        await group
          .getByLabel(`${q.title}：${choices[1].label}`, { exact: true })
          .fill("60");
        await expect(group).toContainText("已分配 100，还差 0");
      } else if (q.type === "file") {
        await group
          .getByLabel("选择文件", { exact: true })
          .setInputFiles({
            name: "browser-evidence.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("真实浏览器附件内容。"),
          });
        await expect(
          group.getByText("browser-evidence.txt", { exact: true }),
        ).toBeVisible();
      } else if (q.type === "signature") {
        await group.getByLabel("键入签名", { exact: true }).fill("浏览器签名");
        await group
          .getByRole("button", { name: "保存签名", exact: true })
          .click();
        await expect(
          group.getByText("signature.png", { exact: true }),
        ).toBeVisible();
        await group.screenshot({
          path: path.join(out, "signature-mobile.png"),
        });
      } else throw Error("Unhandled answer type " + q.type);
      entries[q.type] = "UI interaction completed";
      console.log("answered", q.type);
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(out, "public-mobile-full.png"), fullPage: true });
    await page.getByRole("button", { name: "提交答卷", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("提交成功");
    await page.screenshot({ path: path.join(out, "submitted-mobile.png") });
    const saved = await request(`/surveys/${model.id}`);
    assert.equal(saved.responses.length, 1);
    const response = saved.responses[0];
    assert.equal(response.answers.length, 29);
    for (const q of answerQuestions) {
      const answer = response.answers.find((a) => a.questionId === q.id);
      assert.ok(answer, `missing ${q.type}`);
      assert.deepEqual(
        validateSurveyAnswer(q, answer.value),
        [],
        `invalid ${q.type}`,
      );
      entries[q.type] = { persisted: true, value: answer.value };
    }
    for (const type of ["file", "signature"]) {
      const id = response.answers.find(
        (a) => a.questionId === `browser-${type}`,
      ).value[0];
      const download = await fetch(
        `${api}/surveys/${model.id}/responses/${response.id}/attachments/${id}/content`,
        { headers: { authorization: `Bearer ${session.sessionToken}` } },
      );
      assert.equal(download.status, 200);
      const bytes = Buffer.from(await download.arrayBuffer());
      if (type === "file")
        assert.equal(bytes.toString("utf8"), "真实浏览器附件内容。");
      else
        assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    }
    const editorModel = await request("/surveys", { ...draft, title: "题型编辑器 · 默认配置与实时预览" });
    const owner = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await owner.addInitScript(session => {
      localStorage.setItem("wsx.sessionToken", session.sessionToken);
      localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: session.userId, orgs: session.orgs, currentOrgId: session.orgs[0], expiresAt: session.expiresAt }));
    }, session);
    const editor = await owner.newPage(); editor.setDefaultTimeout(60000);
    await editor.goto(base + "/studio/survey/" + editorModel.id, { timeout: 180000, waitUntil: "domcontentloaded" });
    await editor.getByRole("button", { name: "新增题目", exact: true }).click();
    await expect(editor.getByLabel("搜索题型", { exact: true })).toBeVisible();
    await editor.getByLabel("搜索题型", { exact: true }).scrollIntoViewIfNeeded();
    await editor.screenshot({ path: path.join(out, "editor-type-picker-desktop.png") });
    await editor.getByRole("button", { name: "新增题目", exact: true }).click();
    await editor.getByRole("button", { name: "展开实时预览", exact: true }).click();
    await editor.getByRole("button", { name: "手机预览", exact: true }).click();
    await expect(editor.getByRole("button", { name: "手机预览", exact: true })).toHaveAttribute("aria-pressed", "true");
    await editor.getByRole("button", { name: "手机预览", exact: true }).scrollIntoViewIfNeeded();
    await editor.screenshot({ path: path.join(out, "editor-live-preview-desktop.png") });
    await owner.close();
    fs.writeFileSync(
      path.join(out, "result.json"),
      JSON.stringify(
        {
          surveyId: model.id,
          responseId: response.id,
          types: entries,
          evidence:
            "Real Chromium anonymous UI → HTTP → isolated PostgreSQL; real upload/download bytes; no mocked routes",
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: 29 types + description + pagination; real anonymous submit; persisted values; authenticated download file bytes and PNG signature.",
    );
  } catch (error) {
    await page
      .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
