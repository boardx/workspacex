import { test, expect } from "@playwright/test";
import { ACCEPTANCE_DOC, expectAnchor, gapMessage, openChatEmptyState } from "./chat-task-workbench-fixture";

/**
 * issue #2068 —— **TW-P0-1 任务型空状态**（判据见 `${ACCEPTANCE_DOC}` TW-P0-1 一节）。
 *
 * 人类 2026-08-26 审计原话（本 spec 唯一要变成「会红的数字」的那段）：
 * > 中央不是「开始新的对话」，而是「今天想完成什么？描述目标，Agent 会先提出计划，
 * > 得到确认后再执行」+ 4 个真实任务模板；输入框上方显示已挂载上下文标签
 * > （项目 / 材料 N / 技能 N / 记忆范围）。
 *
 * ## 当前实现（2026-08-26 代码级勘探，`copilotkit-v2-panel.tsx:1375`）
 * `copilotkit-v2-empty` 是两行静态文字「开始新的对话」+ 一句提示，**没有**目标输入
 * 引导语、**没有**任务模板、**没有**上下文标签。因此本 spec 预期大面积红——
 * 那正是它的价值：把一段审计文字变成一个会红的数字。
 *
 * ⚠ 不许用 `test.skip` 糊过去：skip 掉的差距等于不存在。
 */

test.setTimeout(180_000);

test("TW-P0-1①：新对话中央是任务隐喻（目标 + 计划 + 确认），不是会话隐喻「开始新的对话」", async ({ page }) => {
  await openChatEmptyState(page);

  const headline = await expectAnchor(
    page,
    "chat-task-workbench-goal-headline",
    "TW-P0-1①",
    "新对话中央缺少「今天想完成什么？」这类任务型目标引导语",
    30_000,
  );

  const text = (await headline.innerText()).trim();
  // 判据逐字：引导语必须同时承载「计划」与「确认」两个概念——这正是把聊天工具
  // 与 agent 工作台区分开的那句话（先提计划、经确认再执行）。
  expect(text, gapMessage("TW-P0-1①", "chat-task-workbench-goal-headline", "引导语未提到「计划」")).toContain("计划");
  expect(text, gapMessage("TW-P0-1①", "chat-task-workbench-goal-headline", "引导语未提到「确认」")).toContain("确认");

  // 反证面：任务隐喻立起来之后，会话隐喻的旧文案不应再占据中央主标题。
  const legacy = page.getByTestId("copilotkit-v2-empty");
  if (await legacy.count()) {
    expect(
      (await legacy.innerText()).trim(),
      "TW-P0-1①：中央主标题仍是会话隐喻「开始新的对话」，任务隐喻没有真正替换它",
    ).not.toContain("开始新的对话");
  }
});

test("TW-P0-1②：4 个真实任务模板齐全，且点击后真的把目标填进输入框", async ({ page }) => {
  await openChatEmptyState(page);

  // 审计点名的四类：调研市场产出带来源报告 / 阅读材料整理决策建议 /
  // 需求拆成计划生成项目产物 / 分析数据发现异常制图。
  const templates: readonly { id: string; what: string }[] = [
    { id: "chat-task-workbench-template-research", what: "「调研市场并产出带来源的报告」模板" },
    { id: "chat-task-workbench-template-reading", what: "「阅读材料整理决策建议」模板" },
    { id: "chat-task-workbench-template-planning", what: "「需求拆成计划并生成项目产物」模板" },
    { id: "chat-task-workbench-template-analysis", what: "「分析数据发现异常并制图」模板" },
  ];

  for (const template of templates) {
    await expectAnchor(page, template.id, "TW-P0-1②", `空状态缺少${template.what}`, 20_000);
  }

  // 反伪造条款：模板必须**可点击且真的发起任务**，不是装饰卡片。
  const input = page.getByTestId("copilotkit-v2-input");
  await expect(input).toHaveValue("");
  const firstTemplateId = "chat-task-workbench-template-research";
  await page.getByTestId(firstTemplateId).click();
  await expect(
    input,
    gapMessage("TW-P0-1②", firstTemplateId, "模板点了没有把目标填进输入框——是装饰卡片，按反伪造条款判 0"),
  ).not.toHaveValue("", { timeout: 10_000 });
});

test("TW-P0-1③：输入框上方显示已挂载上下文标签（项目 / 材料 N / 技能 N / 记忆范围）", async ({ page }) => {
  await openChatEmptyState(page);

  const chips = [
    { id: "chat-task-workbench-context-chip-project", what: "「项目」上下文标签" },
    { id: "chat-task-workbench-context-chip-materials", what: "「材料 N」上下文标签" },
    { id: "chat-task-workbench-context-chip-skills", what: "「技能 N」上下文标签" },
    { id: "chat-task-workbench-context-chip-memory", what: "「记忆范围」上下文标签" },
  ];

  for (const chip of chips) {
    await expectAnchor(page, chip.id, "TW-P0-1③", `输入框上方缺少${chip.what}`, 20_000);
  }

  // 反伪造条款：材料/技能的数字必须来自真实后端读取，不得写死。这里断言标签
  // 暴露了数据来源标记（`data-source="live"`），使「写死一个 3」在机械上不可通过。
  for (const id of ["chat-task-workbench-context-chip-materials", "chat-task-workbench-context-chip-skills"]) {
    await expect(
      page.getByTestId(id),
      gapMessage("TW-P0-1③", id, "标签未声明数据来源；写死的数字与真实读取在界面上无法区分，按反伪造条款判 0"),
    ).toHaveAttribute("data-source", "live");
  }
});

/**
 * 2026-09-03 人类反馈（真栈截图）「今天完成什么这部分的内容太上了」+ exact-SHA
 * 复核（PR #2616）—— 空态曾经贴着滚动区顶部出现（`h-full`/`justify-center` 挂在
 * 一个没有真实高度的块级祖先上，从未生效），下方留一大截死白。
 *
 * 修法两版：① 只给 `copilotkit-v2-messages` 开 `flex flex-col` 不够——column flex
 * 下 `align-items: stretch` 拉伸的是交叉轴（宽度），不是主轴（高度）；
 * ② 补上 `messagesContentRef` 自己的 `flex-1`，才真的参与主轴分配。
 *
 * 这条测试断言的是「真实 `/chat` 页面」（真实登录 + 真实 DOM + 真实浏览器布局引擎）
 * 里空态容器的几何中心与滚动区中心足够接近——不是复述实现细节（不断言用了哪个
 * flex 属性），只断言最终能观察到的结果：这不是本文件其余 TW-P0-1 用例覆盖的
 * 「锚点存在」，是专门盯着「这个锚点在哪」的回归测试，防止这个 bug 静默复发。
 */
test("TW-P0-1④：空状态在滚动区内垂直居中，不贴着顶部留一截死白", async ({ page }) => {
  await openChatEmptyState(page);

  const container = page.getByTestId("copilotkit-v2-messages");
  const empty = page.getByTestId("copilotkit-v2-empty");
  const containerBox = await container.boundingBox();
  const emptyBox = await empty.boundingBox();
  if (containerBox === null || emptyBox === null) {
    throw new Error("TW-P0-1④：滚动区或空状态未能取到 bounding box，无法判定是否居中");
  }

  const containerCenterY = containerBox.y + containerBox.height / 2;
  const emptyCenterY = emptyBox.y + emptyBox.height / 2;
  const delta = Math.abs(containerCenterY - emptyCenterY);
  // 容差给到滚动区高度的 20%——不要求像素级重合（内容本身有高度，两者中心不可能
  // 严丝合缝），但足以把"贴顶"这类量级的回归（此前实测 delta 高达容器高度的一半）
  // 挡下来。
  const tolerance = containerBox.height * 0.2;
  expect(
    delta,
    gapMessage(
      "TW-P0-1④",
      "copilotkit-v2-empty",
      `空状态未在滚动区内垂直居中：容器中心 y=${containerCenterY}，空状态中心 y=${emptyCenterY}，`
      + `偏差 ${delta}px 超过容差 ${tolerance}px（贴顶/贴底的回归）`,
    ),
  ).toBeLessThanOrEqual(tolerance);
});
