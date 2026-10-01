import { expect, test } from "@playwright/test";
import { MODE_EVAL } from "./kg-mode-acceptance.fixture";
import { claimIdOf, login, newThread, openMemoryPanel, say, tell } from "./kg-experience-eval/eval-helpers";

test.setTimeout(240_000);

for (const [mode, orgId] of [["cloud", MODE_EVAL.cloudOrgId], ["local", MODE_EVAL.localOrgId]] as const) {
 for (const kind of ["general", "workshop"] as const) {
  test(`[L-${mode}-${kind}] 会话决定 → 个人长期记忆 → 新会话引用 → 分享项目 → 项目对话引用 → 撤回`, async ({ page }, info) => {
    await login(page, MODE_EVAL.account);
    if (mode === "local") {
      await page.getByTestId("org-switcher").click();
      await page.getByTestId(`org-switcher-option-${orgId}`).click();
      await page.waitForURL(/\/projects(?:\?|$)/);
    }
    // Default general projects are created via UI; workshop membership is a fixture precondition, with zero memories.
    let projectId = `${orgId}-project`;
    if (kind === "general") {
      await page.goto("/project/new");
      await page.getByTestId("project-new-name").fill(`${mode}决策验收项目`);
      await page.getByTestId("project-new-create").click();
      await page.waitForURL(/\/projects\/[^/?]+\?org=/);
      projectId = new URL(page.url()).pathname.split("/")[2]!;
    }
    const thread = await newThread(page);
    await tell(page, thread, ["M5"]);
    const panel = await openMemoryPanel(page);
    await expect(panel).toContainText("王芳");
    const id = await claimIdOf(page, thread, "王芳决定北极星项目首发只做安卓版");
    await expect(page.getByText("正在记…", { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: info.outputPath(`${mode}-levels-01-session.png`), fullPage: true });
    // A decision is automatically copied; verify the visible personal layer, rather than assuming it exists.
    await page.getByTestId("rail-profile-menu").click();
    await page.getByTestId("personal-menu-brain").click();
    await page.getByTestId("brain-tab-personal").click();
    const item = page.getByTestId("brain-personal-item").filter({ hasText: "王芳决定北极星项目首发只做安卓版" }).first();
    await expect(item).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${mode}-levels-02-personal.png`), fullPage: true });
    await newThread(page);
    const personal = await say(page, "北极星项目首发只做安卓版，是谁决定的？");
    await expect(personal.answer).toContainText("王芳");
    await expect(page.getByText("正在记…", { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: info.outputPath(`${mode}-levels-03-cross-session.png`), fullPage: true });
    await page.getByTestId("rail-profile-menu").click();
    await page.getByTestId("personal-menu-brain").click();
    await page.getByTestId("brain-tab-personal").click();
    await item.getByTestId("brain-share-open").click();
    await page.getByTestId(`brain-share-target-${projectId}`).click();
    await expect(page.getByTestId("brain-share-audience")).toContainText("全部");
    await expect(page.getByTestId("brain-share-confirm")).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`${mode}-levels-04-share-preview.png`), fullPage: true });
    await page.getByTestId("brain-share-confirm").click();
    await expect(page.getByTestId("brain-share-dialog").getByRole("status")).toContainText("已分享到");
    await page.getByTestId("brain-share-close").click();
    await page.goto(`/projects/${projectId}?tab=${kind === "general" ? "brain" : "research"}`);
    await expect(page.getByTestId("project-brain")).toContainText("王芳");
    await expect(page.getByTestId("project-brain")).toContainText("分享自个人记忆");
    await page.screenshot({ path: info.outputPath(`${mode}-levels-05-project-brain.png`), fullPage: true });
    if (kind === "general") {
      await page.getByRole("button", { name: "记到组织记忆", exact: true }).first().click();
      await expect(page.getByTestId(/^project-brain-promote-org-result-/).first()).toContainText("已记到组织记忆");
      await page.goto("/brain");
      await page.getByTestId("brain-tab-shared").click();
      await page.getByRole("button", { name: "查看组织记忆", exact: true }).click();
      await expect(page.getByTestId("brain-org-content")).toContainText("王芳");
      await page.screenshot({ path: info.outputPath(`${mode}-levels-org-memory.png`), fullPage: true });
    }

    if (kind === "general") {
      await page.goto(`/projects/${projectId}?tab=content`);
      await page.getByTestId("project-content-empty-new-conv").click();
    } else {
      await page.goto(`/projects/${projectId}?tab=research&sub=conv`);
      await page.getByTestId("project-conversations-new").click();
    }
    await page.waitForURL(/\/chat\/[^/?]+\?projectId=/);
    const answer = await say(page, "北极星项目首发只做安卓版，是谁决定的？");
    await expect(answer.answer).toContainText("王芳");
    const footer = answer.answer.locator("xpath=..");
    await expect(footer).toContainText("项目");
    await expect(page.getByText("正在记…", { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: info.outputPath(`${mode}-levels-06-project-answer.png`), fullPage: true });
    await info.attach("measure", { body: JSON.stringify({ mode, projectId, sourceThread: thread, sourceClaim: id, personalAnswer: personal.text, projectAnswer: answer.text }), contentType: "application/json" });
    await page.goto("/brain");
    await page.getByTestId("brain-tab-personal").click();
    await item.getByTestId("brain-share-open").click();
    await page.getByTestId(`brain-share-target-${projectId}`).click();
    await page.getByTestId("brain-share-revoke").click();
    await expect(page.getByTestId("brain-share-dialog").getByRole("status")).toContainText("已从");
    await page.getByTestId("brain-share-close").click();
    await expect(item).toBeVisible();
    await page.goto(`/projects/${projectId}?tab=${kind === "general" ? "brain" : "research"}`);
    await expect(page.getByTestId("project-brain")).not.toContainText("王芳");
    await page.screenshot({ path: info.outputPath(`${mode}-levels-07-project-revoked.png`), fullPage: true });
  });
 }
}

for (const teamKind of ["workshop", "general"] as const) {
test(`[L-team-${teamKind}] 分享前项目成员不可用 → 分享后可用 → 非成员不可见 → 撤回后新会话不再使用`, async ({ page, browser }, info) => {
  const orgId = MODE_EVAL.cloudOrgId;
  let projectId = `${orgId}-project`;
  await login(page, MODE_EVAL.account);
  if (teamKind === "general") {
    await page.goto("/project/new");
    await page.getByTestId("project-new-name").fill("通用项目成员共享验收");
    await page.getByTestId("project-new-create").click();
    await page.waitForURL(/\/projects\/[^/?]+\?org=/);
    projectId = new URL(page.url()).pathname.split("/")[2]!;
    await page.goto(`/projects/${projectId}?tab=settings`);
    await page.getByTestId("project-collaborators-add-user").click();
    await page.getByRole("menuitemradio", { name: MODE_EVAL.member.name, exact: true }).click();
    await page.getByTestId("project-collaborators-add-submit").click();
    await expect(page.getByTestId("project-collaborators-panel")).toContainText(MODE_EVAL.member.name);
  }
  const original = await newThread(page);
  await tell(page, original, ["M5"]);
  const contexts = [await browser.newContext(), await browser.newContext()];
  const member = await contexts[0]!.newPage();
  const outsider = await contexts[1]!.newPage();
  const openProjectThread = async () => {
    if (teamKind === "general") {
      await member.goto(`/projects/${projectId}?tab=content`);
      await member.getByTestId("project-content-new-menu").click();
      await member.getByTestId("project-content-new-conv").click();
    } else {
      await member.goto(`/projects/${projectId}?tab=research&sub=conv`);
      await member.getByTestId("project-conversations-new").click();
    }
    await member.waitForURL(/\/chat\/[^/?]+\?projectId=/);
  };
  try {
    for (const [target, account] of [[member, MODE_EVAL.member], [outsider, MODE_EVAL.outsider]] as const) {
      await login(target, account);
      // Mode-only accounts belong to the cloud fixture; baseline privacy accounts keep their original organization.
    }
    await openProjectThread();
    const before = await say(member, "北极星项目首发只做安卓版，是谁决定的？");
    expect(before.text).not.toContain("王芳");
    await page.goto("/brain");
    await page.getByTestId("brain-tab-personal").click();
    const item = page.getByTestId("brain-personal-item").filter({ hasText: "王芳决定北极星项目首发只做安卓版" }).first();
    await item.getByTestId("brain-share-open").click();
    await page.getByTestId(`brain-share-target-${projectId}`).click();
    await expect(page.getByTestId("brain-share-audience")).toContainText(MODE_EVAL.member.name);
    await page.screenshot({ path: info.outputPath("team-01-audience.png"), fullPage: true });
    await page.getByTestId("brain-share-confirm").click();
    await expect(page.getByTestId("brain-share-dialog").getByRole("status")).toContainText("已分享到");
    await page.getByTestId("brain-share-close").click();
    await openProjectThread();
    const shared = await say(member, "北极星项目首发只做安卓版，是谁决定的？");
    await expect(shared.answer).toContainText("王芳");
    await member.screenshot({ path: info.outputPath("team-02-member-recall.png"), fullPage: true });
    await outsider.goto(`/projects/${projectId}?tab=research`);
    await expect(outsider.getByTestId("project-access-denied")).toBeVisible();
    expect(await outsider.locator("body").innerText()).not.toContain("王芳");
    await outsider.screenshot({ path: info.outputPath("team-03-nonmember-denied.png"), fullPage: true });
    await item.getByTestId("brain-share-open").click();
    await page.getByTestId(`brain-share-target-${projectId}`).click();
    await page.getByTestId("brain-share-revoke").click();
    await expect(page.getByTestId("brain-share-dialog").getByRole("status")).toContainText("已从");
    await page.getByTestId("brain-share-close").click();
    await expect(item).toBeVisible();
    await openProjectThread();
    const after = await say(member, "北极星项目首发只做安卓版，是谁决定的？");
    expect(after.text).not.toContain("王芳");
    await member.screenshot({ path: info.outputPath("team-04-revoked-new-session.png"), fullPage: true });
    await info.attach("measure", { body: JSON.stringify({ before: before.text, shared: shared.text, after: after.text }), contentType: "application/json" });
  } finally {
    for (const context of contexts) await context.close();
  }
});

}

for (const mode of ["cloud", "local"] as const) {
  test(`[L-undo-${mode}] 通用项目共享随个人记忆忘掉失效，撤销忘掉后恢复来源与项目引用`, async ({ page }, info) => {
    await login(page, MODE_EVAL.account);
    if (mode === "local") {
      await page.getByTestId("org-switcher").click();
      await page.getByTestId(`org-switcher-option-${MODE_EVAL.localOrgId}`).click();
      await page.waitForURL(/\/projects(?:\?|$)/);
    }
    await page.goto("/project/new");
    await page.getByTestId("project-new-name").fill(`${mode}撤销恢复验收`);
    await page.getByTestId("project-new-create").click();
    await page.waitForURL(/\/projects\/[^/?]+\?org=/);
    const projectId = new URL(page.url()).pathname.split("/")[2]!;
    const sourceThread = await newThread(page);
    await tell(page, sourceThread, ["M5"]);
    await page.goto("/brain");
    await page.getByTestId("brain-tab-personal").click();
    const item = page.getByTestId("brain-personal-item").filter({ hasText: "王芳决定北极星项目首发只做安卓版" }).first();
    await item.getByTestId("brain-share-open").click();
    await page.getByTestId(`brain-share-target-${projectId}`).click();
    await page.getByTestId("brain-share-confirm").click();
    await expect(page.getByTestId("brain-share-dialog").getByRole("status")).toContainText("已分享到");
    await page.getByTestId("brain-share-close").click();
    const forgetThread = await newThread(page);
    const forget = await say(page, "忘掉王芳决定北极星项目首发只做安卓版");
    const block = forget.answer.locator("xpath=..");
    await expect(block.getByTestId("kg-card-forget")).toBeVisible();
    await block.getByTestId("kg-card-accept").click();
    await expect(block.getByTestId("kg-card-done")).toContainText("已忘掉");
    await page.goto(`/projects/${projectId}?tab=brain`);
    await expect(page.getByTestId("project-brain-empty")).toBeVisible();
    await expect(page.getByTestId("project-brain")).not.toContainText("王芳");
    await page.screenshot({ path: info.outputPath(`${mode}-undo-01-forgotten-project.png`), fullPage: true });
    await page.goto(`/chat/${forgetThread}`);
    await page.getByTestId("kg-card-undo").last().click();
    await expect(page.getByTestId("kg-card-undone").last()).toContainText("恢复");
    await page.goto(`/projects/${projectId}?tab=brain`);
    await expect(page.getByTestId("project-brain")).toContainText("王芳");
    await expect(page.getByTestId("project-brain")).toContainText("分享自个人记忆");
    await page.screenshot({ path: info.outputPath(`${mode}-undo-02-restored-project.png`), fullPage: true });
    await page.goto(`/projects/${projectId}?tab=content`);
    await page.getByTestId("project-content-empty-new-conv").click();
    await page.waitForURL(/\/chat\/[^/?]+\?projectId=/);
    const answer = await say(page, "北极星项目首发只做安卓版，是谁决定的？");
    await expect(answer.answer).toContainText("王芳");
    await page.screenshot({ path: info.outputPath(`${mode}-undo-03-restored-recall.png`), fullPage: true });
  });
}
