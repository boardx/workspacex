import { test, expect } from "@playwright/test";
import { ACCEPTANCE_DOC, expectAnchor, gapMessage, openComposerMenu, openFreshThread } from "./chat-task-workbench-fixture";

/**
 * issue #2068 —— **TW-P0-5 统一 Composer**（判据见 `${ACCEPTANCE_DOC}`）。
 *
 * 人类 2026-08-26 审计原话：
 * > 第一行多行任务输入；第二行左＝附件/材料/@Agent//技能/任务模式，右＝语音状态+
 * > 发送或停止；输入后显示附件卡片、上下文范围、权限提示；Agent 未就绪时禁用发送
 * > 并说明原因；**删除重复的麦克风入口**（当前有两个），设备选择降为语音按钮的
 * > 二级菜单，录音时显示计时/音量/取消/确认。
 *
 * ## 当前实现（2026-08-26 勘探，已证实审计说的「两个麦克风」）
 * - `chat-mic-button`（`copilotkit-v2-panel.tsx:1617`）＝真正的录音开关，`Mic` 图标。
 * - `chat-mic-device-select`（`chat-composer-pickers.tsx:162`，由 panel:1610 渲染）
 *   ＝设备选择器，**也**带 `Mic` 图标 + 文字标签，与上者同处一个 flex 行。
 * 两者并排，视觉上确实读成两个麦克风入口——审计属实。判据要求设备选择降级为
 * 语音按钮的**二级菜单**，即 composer 顶层只留一个麦克风语义入口。
 *
 * ## 2026-09-02 composer 三层结构（本 spec 随之改法，判据不变）
 * 第二行常驻只剩「+」/麦克风/发送三个纯图标；附件、选择能力、任务模式住进「+」菜单
 * （`openComposerMenu` 先展开再断言）；技能没有可见入口——人类裁决 skills 由
 * agent 直接加载、具体 agent 的编排覆盖全局，但输入框里的 `/` 命令保留（headless 锚点）；「系统默认麦克风」
 * 这种默认值不再常驻，设备二级菜单的触发器只在悬停/聚焦时露出；「请先输入任务目标」
 * 只在用户试图发送（空输入按 Enter）时短暂出现。
 *
 * ## 边界（不重复声明）
 * 「语音转录必须经服务端代理」「转录是否实时可编辑」属于
 * `chat-ux-acceptance-criteria.md` 第 5 项，本 spec 不评。本条只评**结构**：
 * 入口数量、二级菜单、录音态四件、发送禁用理由。
 */

test.setTimeout(180_000);

/**
 * 麦克风入口计数的作用域。
 *
 * 优先用验收锚点 `chat-task-workbench-composer`；它尚未实现时**退化到整个 `main`**——
 * 这样「两个麦克风」这条能拿到针对当前真实 DOM 的证据，而不是只报一句「锚点不存在」。
 *
 * 退化到 `main` 不会放宽判据：`/chat` 全页只有 composer 一处有麦克风语义元素
 * （2026-08-26 勘探：`chat-mic-button` @ `copilotkit-v2-panel.tsx:1617` 与
 * `chat-mic-device-select` @ `chat-composer-pickers.tsx:162`，两者都在 composer 那一行）。
 * 作用域取大只可能让计数**偏多**，而判据要求恰好 1——偏多只会让门控更严，不会假绿。
 * composer 容器锚点缺失本身，由本文件第一个用例独立记红。
 */
async function composerScope(page: import("@playwright/test").Page) {
  const anchored = page.getByTestId("chat-task-workbench-composer");
  if (await anchored.count()) return anchored.first();
  return page.locator("main").first();
}

test("TW-P0-5①②：Composer 是统一的两行结构，第一行为多行任务输入", async ({ page }) => {
  await openFreshThread(page);

  await expectAnchor(
    page,
    "chat-task-workbench-composer",
    "TW-P0-5①",
    "没有统一 Composer 容器（当前是散落在 panel 里的若干独立控件）",
    30_000,
  );

  // 多行任务输入，不是单行 input——任务描述天然是多行的。
  const tag = await page.getByTestId("copilotkit-v2-input").evaluate((node) => node.tagName.toLowerCase());
  expect(
    tag,
    gapMessage("TW-P0-5①", "copilotkit-v2-input", "任务输入不是多行 textarea"),
  ).toBe("textarea");

  // 三个入口住在「+」菜单里（见文件头注）；「/技能」入口按 2026-09-02 裁决已不存在。
  await openComposerMenu(page);
  for (const [suffix, what] of [
    ["attach", "附件/材料入口"],
    ["mention-agent", "选择能力入口"],
    ["task-mode", "任务模式切换"],
  ] as const) {
    await expectAnchor(page, `chat-task-workbench-composer-${suffix}`, "TW-P0-5②", `Composer「+」菜单缺少${what}`, 15_000);
  }
  // 「/技能」：入口是输入框里的 `/` 命令本身（2026-09-02 裁决保留），编辑器下方不显示
  // 任何东西——锚点存在但零尺寸，所以判 attached 而不是 visible。
  await expect(
    page.getByTestId("chat-task-workbench-composer-mention-skill"),
    gapMessage("TW-P0-5②", "chat-task-workbench-composer-mention-skill", "缺少 `/` 命令的技能候选锚点"),
  ).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("chat-skill-mount")).toHaveCount(0);
});

test("TW-P0-5⑤：麦克风入口全局唯一（审计实测当前有两个）", async ({ page }) => {
  await openFreshThread(page);
  const scope = await composerScope(page);

  // 麦克风语义的可交互元素：按 testid、可访问名、aria-label 三路取并集，
  // 避免「换个 testid 就绕过门控」。
  const micEntries = await scope.evaluate((root) => {
    const hits: string[] = [];
    const seen = new Set<Element>();
    const record = (el: Element, why: string) => {
      if (seen.has(el)) return;
      seen.add(el);
      const testId = el.getAttribute("data-testid") ?? "(no testid)";
      hits.push(`${testId} [${why}]`);
    };
    for (const el of Array.from(root.querySelectorAll("[data-testid]"))) {
      const testId = el.getAttribute("data-testid") ?? "";
      // 只数「入口」本身，不数录音状态提示行（connecting/listening/stopping/error）
      // 和下拉里的选项（listbox/option/empty）。
      if (!/mic/i.test(testId)) continue;
      // `-mic-devices` 是入口的二级菜单触发器（判据 ⑥ 要求它存在），不是第二个入口。
      if (/(connecting|listening|stopping|error|listbox|option|empty|devices)/i.test(testId)) continue;
      record(el, "testid 含 mic");
    }
    for (const el of Array.from(root.querySelectorAll("button, [role='button'], [role='combobox']"))) {
      const name = `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`;
      if (/麦克风|语音|microphone|\bmic\b/i.test(name)) record(el, "可访问名含麦克风语义");
    }
    return hits;
  });

  expect(
    micEntries,
    [
      `【差距 TW-P0-5⑤】Composer 顶层有 ${micEntries.length} 个麦克风入口，应当只有 1 个。`,
      `实测命中：${micEntries.join(" / ")}`,
      "审计原话：删除重复的麦克风入口（当前有两个），设备选择降为语音按钮的二级菜单。",
      "锚点待实现为 data-testid=chat-task-workbench-composer-mic（唯一入口）",
      "+ data-testid=chat-task-workbench-composer-mic-devices（其二级菜单）。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-P0-5 一节。`,
    ].join("\n"),
  ).toHaveLength(1);
});

test("TW-P0-5⑥：设备选择是语音按钮的二级菜单，录音时显示计时/音量/取消/确认", async ({ page }) => {
  await openFreshThread(page);

  const mic = await expectAnchor(
    page,
    "chat-task-workbench-composer-mic",
    "TW-P0-5⑥",
    "没有唯一的语音按钮锚点",
    30_000,
  );

  // 设备选择必须挂在语音按钮下面（二级菜单），不是 composer 顶层的并列控件。
  // 2026-09-02 起触发器默认隐藏，悬停/聚焦在语音按钮这组上才露出（默认值不是信息）。
  await mic.click();
  await mic.hover();
  await expectAnchor(
    page,
    "chat-task-workbench-composer-mic-devices",
    "TW-P0-5⑥",
    "设备选择没有降级为语音按钮的二级菜单（当前 chat-mic-device-select 与麦克风按钮并列在顶层）",
    15_000,
  );

  for (const [suffix, what] of [
    ["timer", "录音计时"],
    ["level", "音量指示"],
    ["cancel", "取消"],
    ["confirm", "确认"],
  ] as const) {
    await expectAnchor(
      page,
      `chat-task-workbench-composer-recording-${suffix}`,
      "TW-P0-5⑥",
      `录音态缺少${what}`,
      15_000,
    );
  }
});

/*
 * ⚠ 诱发方式的一次修正（首轮实测教训）。
 *
 * 本条原本用 `page.route("**\/agents**", 503) + reload` 来构造「Agent 未就绪」。
 * 实测该做法把整张页面打死了：`copilotkit-v2-input` 再也没渲染出来，用例以 3.0m
 * 超时收场，报出来的是「输入框不见了」——一条与本判据毫无关系的噪声红。
 * 用一个会摧毁被测表面的手段去诱发状态，测不出任何东西。
 *
 * 改为用**天然可诱发**的禁用态（空输入）来钉住判据的真正内核：
 * **发送被禁用时，用户必须能读到原因，而不只是一个灰按钮。**
 * 「agent 未就绪」这个具体成因需要一个前端目前没有暴露的注入缝，缺口如实记在
 * 验收卡 TW-P0-5④ 里，不在这里用假手段假装测过。
 */
test("TW-P0-5④：发送被禁用时必须说明原因（不能只是灰掉）", async ({ page }) => {
  await openFreshThread(page);

  const send = page.getByTestId("copilotkit-v2-send");
  const input = page.getByTestId("copilotkit-v2-input");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill("");
  // 2026-09-02 起"空输入"这条理由不常驻（placeholder 已经说了同一句话），
  // 用户**试图**发送——空输入按 Enter——那一刻才亮出来；其余理由（归档/运行中/上传中）仍常驻。
  await input.press("Enter");

  // 空输入是天然的禁用态；若此实现下发送并未禁用，本条判据无从谈起，如实说明。
  const disabled = await send.isDisabled();
  expect(
    disabled,
    "TW-P0-5④：空输入时发送按钮未禁用，无法在此诱发禁用态——需要另一个注入缝",
  ).toBe(true);

  const reason = await expectAnchor(
    page,
    "chat-task-workbench-composer-send-disabled-reason",
    "TW-P0-5④",
    "发送被禁用但没有说明原因（只是灰掉，用户不知道为什么点不动）",
    20_000,
  );
  expect((await reason.innerText()).trim().length, "禁用原因不能是空文本").toBeGreaterThan(0);
});
