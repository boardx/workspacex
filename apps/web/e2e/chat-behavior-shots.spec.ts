import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * CLR **track B**（行为体验，对标 Claude Code）的**取证**脚本。
 *
 * ## 它解决的问题：评分员曾被登录卡死六小时
 *
 * `.harness/instructions/chat-ux-acceptance-criteria.md` 的打分纪律写着
 * 「必须用真实浏览器在 **devapp 或本地预览环境** 实际操作一遍，不能只看代码 diff」。
 *
 * 2026-08-09，评分员走的是 devapp，于是卡在登录页：**agent 被安全规则禁止代替人类
 * 把密码输入登录表单**，这条限制不因为账号是测试账号、或密码已在指令里给出而改变。
 * 结果 track B 六小时零产出——而它是 CLR 四条 track 里唯一完全空白的一条，
 * 直接压着总分（`CLR = min(R, mean(B, V-D, V-P))`）。
 *
 * 但判据允许「**本地预览环境**」，而本仓早就有一条**零人工输入的真登录链路**：
 * `with-test-isolation` 起一次性隔离栈 → playwright → 用 `chat-read-fixture` 的种子
 * 测试账号登录。`shots:chat-main` 一直在用它，`verify:chat-read` 也是。
 *
 * ⇒ **没有人需要输密码，agent 也不碰凭据**：测试账号是夹具里的种子数据，登录是自动化
 *   代码的一部分，跑在一次性隔离栈上，用完即毁。这与「agent 在 UI 里替人类输入密码」
 *   是两件不同的事——后者仍然不做。
 *
 * ## 这不是门控，是取证
 *
 * 本 spec **只产出证据，不做任何判定**。十项该得几分由 `rev-e2e` 看着这些证据判——
 * 让脚本自己断言「流式反馈达标」等于实现者给自己打分，正是 CLR 的 G3 要挡的东西。
 * 因此它不接 `verify:*`，由 `pnpm run shots:chat-behavior` 显式调用。
 *
 * ## 产物
 *
 * `.chat-behavior/`（可用 `CHAT_BEHAVIOR_OUT` 覆盖）下：
 *   · `b<N>-*.png`      每项判据对应的截图，文件名带项号，便于逐条对照
 *   · `b1-stream-*.png` 流式那项**在 run 进行中**连拍多张——终态截图结构上拍不到中间态，
 *                       这正是 V-P 的 P6 判 0 的原因（rev-uiux 2026-08-09）
 *   · `MANIFEST.md`     每张图对应哪一项、抓的时刻、页面上当时的可见文本摘要
 */

const OUT = resolve(process.env.CHAT_BEHAVIOR_OUT ?? ".chat-behavior");
const DESKTOP = { width: 1440, height: 900 };

/** 取证不是门控，给足超时——同 `chat-main-shots.spec.ts` 的理由（冷编译 + 字体重试）。 */
test.setTimeout(300_000);

interface Shot { file: string; item: string; at: string; note: string }
const manifest: Shot[] = [];

test("capture chat behaviour evidence for CLR track B", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });

  /** 取证要**尽力而为**：某一步拍不到，记一笔继续，不能让整轮证据一起丢。
   *  第一版没这么做，结果发消息那步卡住 300s 超时后浏览器关闭，
   *  连已经拍到的图都没写进 MANIFEST。 */
  const shoot = async (file: string, item: string, note: string) => {
    try {
      await page.screenshot({ path: `${OUT}/${file}`, timeout: 15_000 });
      manifest.push({ file, item, at: new Date().toISOString(), note });
    } catch (e) {
      manifest.push({ file: `(拍摄失败) ${file}`, item, at: new Date().toISOString(), note: `${note} —— 拍摄失败：${(e as Error).message.slice(0, 80)}` });
    }
  };

  /** 一步做不成就记一笔继续。返回是否成功，供后续步骤决定要不要往下走。 */
  const step = async (label: string, fn: () => Promise<void>): Promise<boolean> => {
    try { await fn(); return true; } catch (e) {
      manifest.push({ file: "—", item: `⚠ 取证受阻：${label}`, at: new Date().toISOString(), note: (e as Error).message.slice(0, 160) });
      return false;
    }
  };

  /* ── 登录：种子测试账号，零人工输入 ────────────────────────────────── */
  await page.setViewportSize(DESKTOP);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  /* ── 进入个人对话（不带 projectId，devapp 的默认落地屏）─────────────── */
  await page.goto("/chat");
  await page.getByTestId("chat-read-thread-list").waitFor({ state: "visible", timeout: 60_000 });
  await shoot("b10-entry.png", "第10项 整体连贯性", "进入 /chat 的首屏，用于检查有无假按钮/死链/孤岛组件");

  /* ── 新建一条会话，避免复用历史线程导致证据含糊 ───────────────────── */
  // 2026-08-14：#1179 把个人对话「新建」改成一键创建（`personal-chat-screen.tsx`
  // 直接 `handleCreate(null)`），不再是「折叠开关点开标题表单」——旧版在这里等
  // `chat-thread-create-form` 出现会永远超时。改成点了就等 URL 落地 `?thread=`。
  const createToggle = page.getByTestId("chat-thread-create");
  if (await createToggle.isVisible().catch(() => false)) {
    await createToggle.click();
    await page.waitForURL(/\/chat\?thread=/);
    // 新建后应自动选中并渲染出会话详情——等它，而不是盲等固定秒数
    await page.getByTestId("chat-thread-detail").waitFor({ state: "visible", timeout: 30_000 });
    await shoot("b10-new-thread.png", "第10项 整体连贯性 / 第9项 控制感", "新建会话并自动选中后的状态");
  }

  /* ── 选一个**能真正执行**的 agent（#876）───────────────────────────────
   * ⚠ 第一轮取证没做这步，默认落在夹具里**故意不可运行**的 catalogOnly agent 上
   *   （它只在 org 目录、不在编制，`chat-read-fixture.ts` 注释逐字写明），两次发送
   *   全 422、六项证据全废——且截图看起来像「chat 全面坏了」。评分员特意没按面值
   *   给分（#879），否则会把人力送去修一个没坏的东西。
   * 选 deepAgentId：走真实 `DeepAgentModelProvider` 代码路径（上游是 loopback
   *   假服务），是第 2/3 项「规划/工具调用可见」唯一能在本地取到证的路径。
   * 照 `chat-main-shots.spec.ts:184-185` 的先例。 */
  await step("选择可运行的 deep agent", async () => {
    await page.getByTestId("chat-agent-select").click({ timeout: 15_000 });
    await page.getByTestId(`chat-agent-select-option-${CHAT_READ_E2E.deepAgentId}`)
      .click({ timeout: 15_000 });
  });

  /* ── 发一条会触发工具调用的消息 ────────────────────────────────────── */
  const composer = page.getByTestId("chat-message-input");
  const send = page.getByTestId("chat-message-submit");
  const composerReady = await composer.isVisible().catch(() => false);

  if (composerReady) {
    await composer.fill("现在几点？请先说明你打算怎么做，再动手。");
    await shoot("b9-before-send.png", "第9项 控制感", "发送前的输入区状态（上下文行/附件/语音入口）");
    // ⚠ 显式短超时：默认会一直等到整个 test 的 300s 预算耗尽，那样连已拍到的证据都保不住
    const sent = await step("点击发送", () => send.click({ timeout: 20_000 }));
    if (!sent) {
      await shoot("b00-send-blocked.png", "取证受阻", "发送按钮点不动——后续 1/2/3/4/6/8 项无法取证");
    }

    /* ── 第1项 流式反馈 + 第2/3项 规划与工具调用可见：**在 run 进行中连拍** ──
     * ⚠ 这是本 spec 相对既有取证脚本的关键差异。`chat-main-shots.spec.ts` 等到终态
     *   才截图，于是**结构上不可能拍到中间态**——rev-uiux 正是因此把 P6（流式）判 0，
     *   并明确指出「不等于流式不存在，但按纪律无图不给分」。这里改为固定间隔连拍。 */
    for (let i = 1; i <= 6; i += 1) {
      await page.waitForTimeout(1500);
      // 同时记录两个关键锚点当时在不在——评分员据此区分「拍到了中间态」与「拍晚了」
      // ⚠ 必须给显式短超时：`textContent()` 在元素不存在时会**默认等 30 秒**，
      //   `.catch()` 只在等完之后才接住。6 轮 × 30s = 180s，直接把 300s 预算吃光——
      //   第一版就是这么超时的，而它看起来只是「读一下文本」。
      const seen = async (id: string) =>
        page.getByTestId(id).isVisible({ timeout: 1_000 }).catch(() => false);
      const streaming = await seen("chat-message-row-streaming");
      const planPanel = await seen("agent-plan-panel");
      // TOOLCHAIN-01：活体工具调用链现为折叠块（默认收起一行摘要），锚点改用容器 testid。
      const toolSteps = await seen("agent-tool-chain");
      const runStatus = await page.getByTestId("chat-live-agent-run-status")
        .textContent({ timeout: 1_000 }).catch(() => null);
      await shoot(
        `b1-stream-${String(i).padStart(2, "0")}.png`,
        "第1项 流式反馈 / 第2项 规划步骤 / 第3项 工具调用可见",
        `第 ${i * 1.5}s：streaming行=${streaming} 工具调用块=${toolSteps} 规划条=${planPanel} 状态="${(runStatus ?? "").trim().slice(0, 40)}"`,
      );
    }

    /* 终态：与上面的中间态对照，才能判断"是不是等全部生成完才一次性渲染" */
    await page.waitForTimeout(8000);
    await shoot("b4-final.png", "第4项 真实多步能力", "回复终态——判是否真的按步骤执行而非编一段像计划的文本");
    await shoot("b8-render.png", "第8项 消息呈现质量", "同一张终态图，用于判 markdown/代码块/图片渲染");

    /* ── 第6项 多轮上下文：追问一句不带背景的话 ─────────────────────── */
    await step("追问第二轮", async () => {
      await composer.fill("再详细一点");
      await send.click({ timeout: 20_000 });
    });
    await page.waitForTimeout(9000);
    await shoot("b6-multiturn.png", "第6项 多轮上下文", "追问「再详细一点」后的回复——判是否记得前一轮在说什么");
  } else {
    await shoot("b00-composer-missing.png", "取证受阻", "未找到 chat-message-input，后续各项无法取证");
  }

  /* ── 第5项 语音输入 ──────────────────────────────────────────────────
   * ⚠ 无头浏览器拿不到真实麦克风。这里只抓「点击麦克风后界面进入什么状态」，
   *   **能否真的把语音转成文字，本脚本证明不了**——评分员据此判 0 或标注"无法验证"，
   *   不要拿"有个正在听的提示"当作转录可用的证据。 */
  const mic = page.getByTestId("chat-mic-button");
  if (await mic.isVisible().catch(() => false)) {
    await step("点击麦克风", () => mic.click({ timeout: 15_000 }));
    await page.waitForTimeout(2500);
    await shoot("b5-mic.png", "第5项 语音输入", "⚠ 无头浏览器无真实麦克风：只证明点击后的界面反馈，不证明转录可用");
  }

  /* ── 第7项 错误处理透明度：留给评分员在界面上找失败态 ───────────────
   * 不人为制造失败——伪造一个错误拍出来的图，证明的是"我会造错误"，不是"产品如实展示错误"。 */
  await shoot("b7-error-surface.png", "第7项 错误处理透明度", "当前会话全貌，供评分员查找真实失败态的展示方式（本脚本不制造假错误）");

  writeFileSync(
    `${OUT}/MANIFEST.md`,
    [
      "# track B 取证清单",
      "",
      "由 `pnpm run shots:chat-behavior` 生成。**只有证据，没有判定**——",
      "十项该得几分由 `rev-e2e` 看图判，脚本自己断言等于实现者自评（CLR 的 G3 挡的就是这个）。",
      "",
      "| 文件 | 对应判据 | 抓取时刻 | 说明 |",
      "|---|---|---|---|",
      ...manifest.map((s) => `| \`${s.file}\` | ${s.item} | ${s.at} | ${s.note} |`),
      "",
      "## 本脚本证明不了的事（请勿据此给分）",
      "- **第5项语音输入**：无头浏览器无真实麦克风，只拍到界面反馈，不构成「转录可用」的证据",
      "- **第7项错误处理**：不制造假错误——伪造的失败截图证明的是「我会造错误」，不是产品行为",
      "- **第1/2/3/4/6项**：本轮走 deep-agent 的 **loopback 假上游**——能证明「界面把规划/工具调用/流式如实呈现」，**不能**证明真实模型的行为质量；后者仍需 devapp 取证",
    ].join("\n"),
    "utf8",
  );
});
