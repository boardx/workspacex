import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { designPrototype, designWorkbench, project } from "@repo/contracts";
import { operations as stageOperations } from "@repo/contracts/aidt-stages";
import { isAidtModuleEnabled } from "@/lib/aidt-module-config";
import { readAidtTestGroups } from "../features/aidt/lib/aidt-test-groups";
import { confirmAidtVerificationQuestion } from "../features/aidt/lib/aidt-verification-loop";
import { updateAidtPrototypeReference } from "../features/aidt/lib/aidt-prototype-reference";
import { bearerOf, sendViaWorkbench, type PersistedMessage } from "./chat-v2-send";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

async function api<T = unknown>(page: Page, path: string, method = "GET", body?: unknown) {
  const response = await page.request.fetch(`/__fullstack_api${path}`, {
    method, headers: { authorization: `Bearer ${await bearerOf(page)}` },
    ...(body === undefined ? {} : { data: body }),
  });
  expect(response.ok(), `${method} ${path}: ${response.status()}`).toBe(true);
  return response.json() as Promise<T>;
}

async function seedDesignVersion(page: Page, projectId: string) {
  if (!process.env.WORKSPACEX_ISOLATION_ID || !process.env.WORKSPACEX_DB?.startsWith("wsx_") ||
      process.env.PGDATABASE !== process.env.WORKSPACEX_DB || !["127.0.0.1", "localhost"].includes(process.env.PGHOST ?? "")) {
    throw new Error("This Design fixture requires an owned loopback PostgreSQL test database.");
  }
  const design = designWorkbench.operations.createProject.out.parse(await api(page, "/pm-designs", "POST", {
    name: "测试夹具 · 口味对比卡", template: "ui",
  })).project;
  const linked = await api(page, `/projects/${projectId}/resources`, "POST", { projectId, kind: "design", resourceId: design.id });
  project.operations.linkProjectResource.out.parse(linked);
  // Seed deterministic artwork through the same scoped repository that appends native Design snapshots.
  // Browser and HTTP assertions below use the real services. The test does not claim model generation.
  const requireApi = createRequire(resolve(process.cwd(), "../api/package.json"));
  const { PgDatabase } = requireApi("./src/infrastructure/db/pg-database.ts");
  const { PgDesignProjectRepository } = requireApi("./src/infrastructure/design-workbench/pg-design-project-repository.ts");
  const config = JSON.parse(execFileSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e",
    "import {appConfig} from '../api/src/infrastructure/db/pg-config.ts'; process.stdout.write(JSON.stringify(appConfig()));",
  ], { cwd: process.cwd(), encoding: "utf8" }));
  expect(config.database).toBe(process.env.WORKSPACEX_DB);
  const db = new PgDatabase(config);
  const repository = new PgDesignProjectRepository(db).forOrg(FULLSTACK_E2E.orgId);
  const versions = [];
  try {
    for (const value of ["首版口味标签", "新版口味标签"]) {
      const written = await repository.update(design.id, FULLSTACK_E2E.leadUserId, {
        frames: ["菜单"], prototype: [designPrototype.PrototypeNode.parse({ id: "menu-title", type: "text", props: { content: value } })],
      }, { source: "user", summary: value });
      expect(written).toBeTruthy();
      const receipt = repository.lastRecordedVersion();
      expect(receipt).toBeTruthy();
      versions.push(receipt.id as string);
    }
  } finally { await db.close(); }
  const versionPath = `/pm-designs/${design.id}/versions/${versions[0]}`;
  const { version } = await api<{ version: { id: string; seq: number; summary: string; createdAt: string; source: "user"; prototype: unknown[] } }>(page, versionPath);
  expect(version).toMatchObject({ id: versions[0], seq: 1, summary: "首版口味标签", prototype: [expect.objectContaining({ props: expect.objectContaining({ content: "首版口味标签" }) })] });
  const question = confirmAidtVerificationQuestion(updateAidtPrototypeReference({
    fields: { verificationQuestion: "能否区分两种奶感？", beforeTestBelief: "并排看更清楚。" }, ideas: [], selectedIdeaId: "",
  }, { designId: design.id, designName: design.name, versionId: version.id, seq: version.seq, summary: version.summary, createdAt: version.createdAt, source: version.source, frameCount: 1, generatedFrameCount: 1 }));
  const stage5 = stageOperations.save.out.parse(await api(page, `/projects/${projectId}/aidt/stages/5`, "PUT", {
    projectId, stageId: 5, operationId: randomUUID(), expectedRevision: 0,
    content: { schemaVersion: 1, draft: question }, sourceStageRevisions: [],
  })).stage;
  return { designId: design.id, versionId: version.id, revision: stage5.revision };
}

async function seedSurvey(page: Page, projectId: string) {
  const created = await api<{ id: string; version: number }>(page, "/surveys", "POST", {
    anonymity: "anonymous",
    draft: {
      title: "测试夹具 · 口味问卷",
      questions: [{ id: "flavor", title: "能分辨奶感差别吗？", type: "single", chapterId: "general", order: 1, required: true, options: ["能分辨", "不能分辨"] }],
      template: { id: "report", title: "测试夹具 · 答卷", sections: [{ id: "main", title: "结果", blocks: [
        { id: "distribution", title: "答案分布", type: "bar", questionIds: ["flavor"], statistic: "distribution", samplePolicy: "valid", minGroupSize: 5 },
      ] }] },
    },
  });
  const published = await api<{ publication: { token: string } }>(page, `/surveys/${created.id}/publish`, "POST", { expectedVersion: created.version });
  const submissionId = randomUUID();
  await api(page, `/public/surveys/${published.publication.token}/responses`, "POST", {
    submissionId, answers: [{ questionId: "flavor", value: "能分辨" }],
  });
  await api(page, `/projects/${projectId}/resources`, "POST", { projectId, kind: "survey", resourceId: created.id });
  return { id: created.id, submissionId };
}

function routeThread(page: Page) { return new URL(page.url()).searchParams.get("thread"); }
async function openTest(page: Page, href: string) {
  await page.goto(href);
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await expect.poll(() => routeThread(page)).toBeTruthy();
  return routeThread(page)!;
}

test("AIDT testing entities bind an immutable Design and isolate parallel native Chats and survey feedback", async ({ page, context }, info) => {
  test.skip(!isAidtModuleEnabled(), "Run with the explicit AIDT full-stack configuration.");
  test.setTimeout(180_000);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.leadEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.leadPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByTestId("rail-aidt").click();
  await page.getByTestId("aidt-new").click();
  await page.getByTestId("project-new-name").fill(`分组测试隔离 ${randomUUID().slice(0, 8)}`);
  await page.getByTestId("project-new-create").click();
  await expect(page).toHaveURL(/\/aidt\/[^/?]+$/);
  const pathname = new URL(page.url()).pathname;
  const projectId = pathname.split("/").at(-1)!;
  const prototype = await seedDesignVersion(page, projectId);
  const survey = await seedSurvey(page, projectId);

  await page.goto(`${pathname}?step=6&prototypeRevision=${prototype.revision}`);
  const directory = page.getByTestId("aidt-test-group-directory");
  await expect(directory.getByText(/尚无测试/)).toBeVisible();
  await expect(page.getByTestId("copilotkit-v2-input")).toHaveCount(0);
  const hrefs: string[] = [];
  for (const name of ["A 赶课访谈", "B 非高峰问卷"]) {
    await directory.getByRole("textbox", { name: "测试名称" }).fill(name);
    await directory.getByRole("button", { name: "新建测试草稿" }).click();
    const card = directory.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card.getByText("保存后可以打开对话")).toBeVisible();
    await directory.getByRole("button", { name: "保存测试列表" }).click();
    const link = card.getByRole("link", { name: "打开测试", exact: true });
    await expect(link).toBeVisible();
    hrefs.push(await link.evaluate(el => (el as HTMLAnchorElement).href));
  }
  expect(hrefs).toHaveLength(2);
  const tabs = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
  try {
    const [a, peer, b] = tabs;
    const [threadA, threadPeer, threadB] = await Promise.all([
      openTest(a!, hrefs[0]!), openTest(peer!, hrefs[0]!), openTest(b!, hrefs[1]!),
    ]);
    expect(threadA).toBe(threadPeer);
    expect(threadA).not.toBe(threadB);
    const message = "合成验收：先写一项可观察的测试任务。";
    await sendViaWorkbench(a!, message);
    await expect.poll(async () => (await api<{ messages: PersistedMessage[] }>(a!, `/chat/threads/${threadA}/messages?limit=100`)).messages.some(item => item.authorKind === "human" && item.text === message)).toBe(true);
    expect((await api<{ messages: PersistedMessage[] }>(b!, `/chat/threads/${threadB}/messages?limit=100`)).messages.find(item => item.text === message)).toBeUndefined();

    const outcome = new URL(hrefs[1]!);
    outcome.searchParams.set("tool", "outcome");
    await b!.goto(outcome.toString());
    const detail = b!.getByTestId("aidt-test-group-detail");
    await expect(detail).toContainText(prototype.versionId);
    await detail.getByRole("combobox", { name: "测试方式" }).selectOption("survey");
    await detail.getByRole("combobox", { name: "关联项目问卷" }).selectOption(survey.id);
    await detail.getByRole("textbox", { name: "原件位置（时间点、答卷或批次）" }).fill(survey.submissionId);
    await detail.getByRole("textbox", { name: "原话或问卷原始回答" }).fill("能分辨");
    await expect(detail.getByRole("textbox", { name: "现场观察到的行为" })).toHaveValue("");
    await b!.getByTestId("aidt-shared-save").click();
    await expect(b!.getByTestId("aidt-shared-receipt")).toBeVisible();
    await b!.reload();
    await expect(detail.getByRole("textbox", { name: "原话或问卷原始回答" })).toHaveValue("能分辨");
    await expect.poll(() => routeThread(b!)).toBe(threadB);
    const { stage } = stageOperations.get.out.parse(await api(page, `/projects/${projectId}/aidt/stages/6`));
    const records = readAidtTestGroups(stage!.content.draft.fields).sort((first, second) => first.name.localeCompare(second.name));
    expect(records).toMatchObject([
      { name: "A 赶课访谈", method: "interview", said: "", stage5Revision: prototype.revision, versionId: prototype.versionId },
      { name: "B 非高峰问卷", method: "survey", said: "能分辨", did: "", source: { id: survey.id, kind: "survey" }, sourceLocation: survey.submissionId, stage5Revision: prototype.revision, versionId: prototype.versionId },
    ]);
    await b!.screenshot({ path: info.outputPath("aidt-survey-test-group.png"), fullPage: true });
  } finally { await Promise.all(tabs.map(tab => tab.close())); }
});
