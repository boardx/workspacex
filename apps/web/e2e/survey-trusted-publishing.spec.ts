import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function api<T>(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ apiBase, path, method, body }) => {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${window.localStorage.getItem("wsx.sessionToken")}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }, { apiBase: API, path, method, body }) as Promise<{ status: number; data: T }>;
}

const blockedDraft = {
  title: "发布质量门控验证",
  questions: [{
    id: "q-leading",
    title: "你是否同意我们的优秀服务显然值得推荐？",
    type: "single",
    chapterId: "general",
    order: 1,
    required: true,
    options: [],
  }],
  template: {
    id: "report-template",
    title: "发布质量门控报告",
    sections: [{ id: "section-empty", title: "核心结论", blocks: [] }],
  },
};

const repairedDraft = {
  ...blockedDraft,
  questions: [{ ...blockedDraft.questions[0], title: "您向同事推荐我们服务的意愿如何？", options: ["愿意", "不愿意"] }],
  template: {
    ...blockedDraft.template,
    sections: [{
      id: "section-empty",
      title: "核心结论",
      blocks: [{
        id: "recommendation-distribution",
        title: "推荐意愿分布",
        type: "bar",
        questionIds: ["q-leading"],
        statistic: "distribution",
        samplePolicy: "valid",
        minGroupSize: 5,
      }],
    }],
  },
};

test("发布门控展示全部阻断，修复后显式进入回收且匿名方式被冻结", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAsAdmin(page);

  const created = await api<{ id: string; version: number }>(page, "/surveys", "POST", {
    draft: blockedDraft,
    anonymity: "anonymous",
  });
  expect(created.status).toBe(201);

  await page.goto(`/studio/survey/${created.data.id}?step=publish`);
  await page.getByRole("button", { name: "检查发布条件" }).click();
  await expect(page.getByText("发现 4 项发布阻断")).toBeVisible();
  await expect(page.getByText(/题目措辞可能带有诱导性/)).toBeVisible();
  await expect(page.getByText(/选项题必须包含有效选项/)).toBeVisible();
  await expect(page.getByText(/报告章节尚未覆盖对应题目/)).toHaveCount(2);
  await expect(page.getByText("发布准备已完成")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("publishing-blocked.png"), fullPage: true });

  const repaired = await api<{ version: number }>(page, `/surveys/${created.data.id}`, "PUT", {
    expectedVersion: created.data.version,
    draft: repairedDraft,
  });
  expect(repaired.status).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "检查发布条件" }).click();
  await expect(page.getByText("发布准备已完成")).toBeVisible();
  await page.getByRole("button", { name: "开始回收" }).click();
  await expect(page.getByText(/正在回收 · 0 份答卷/)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/正在回收 · 0 份答卷/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("publishing-collecting.png"), fullPage: true });

  const current = await api<{ version: number }>(page, `/surveys/${created.data.id}`);
  const anonymityChange = await api<{ reasonCode: string }>(page, `/surveys/${created.data.id}`, "PUT", {
    expectedVersion: current.data.version,
    draft: repairedDraft,
    anonymity: "identified",
  });
  expect(anonymityChange.status).toBe(409);
  expect(anonymityChange.data.reasonCode).toBe("ANONYMITY_IMMUTABLE");

});

test("管理员可在真实答卷页排除测试答卷且保留审计理由", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAsAdmin(page);
  const created = await api<{ id: string; version: number }>(page, "/surveys", "POST", {
    draft: repairedDraft,
    anonymity: "anonymous",
  });
  expect(created.status).toBe(201);
  const published = await api<{ publication: { token: string } }>(page, `/surveys/${created.data.id}/publish`, "POST", {
    expectedVersion: created.data.version,
  });
  expect(published.status).toBe(201);
  const submitted = await api<{ responseId: string }>(page, `/public/surveys/${published.data.publication.token}/responses`, "POST", {
    submissionId: `browser-governance-${Date.now()}`,
    answers: [{ questionId: "q-leading", value: "愿意" }],
  });
  expect(submitted.status).toBe(201);

  await page.goto(`/studio/survey/${created.data.id}?step=responses`);
  await page.getByRole("button", { name: "查看完整答卷" }).click();
  await page.getByLabel("排除分析原因").fill("浏览器验收中的测试答卷");
  await page.getByRole("button", { name: "排除分析" }).click();
  await expect(page.getByText("排除原因：浏览器验收中的测试答卷")).toBeVisible();
  await expect(page.getByText(/已排除分析 1/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("response-governance-excluded.png"), fullPage: true });

  const persisted = await api<{ responses: Array<{ id: string; analysis: string; exclusionReason?: string }> }>(page, `/surveys/${created.data.id}`);
  expect(persisted.status).toBe(200);
  expect(persisted.data.responses.find((response) => response.id === submitted.data.responseId)).toMatchObject({
    id: submitted.data.responseId,
    analysis: "excluded",
    exclusionReason: "浏览器验收中的测试答卷",
  });
});
