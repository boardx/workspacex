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

    /* ── 首轮评分点名的取证缺口①：工具块展开态（收起态已有 b1/b4 覆盖）── */
    await step("展开工具调用块", async () => {
      const toggle = page.getByTestId("agent-tool-chain-toggle").last();
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click({ timeout: 10_000 });
        await page.waitForTimeout(400);
        await shoot("b3-tool-expanded.png", "第3项 工具调用可见", "工具块展开态：逐条参数/结果/终态——首轮评分因全程折叠无法判参数可见性");
      }
    });

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
    // ⚠ 必须再点一次把录音停掉：不停的话 loopback ASR 会持续把转录写进输入框，
    //   把后面 markdown / 多步 / 失败三个场景刚 fill 的取证消息覆盖掉（本轮实测：
    //   三个场景全部受阻，composer 里躺着 [loopback-asr] 转录文本）。
    await step("停止麦克风录音", () => mic.click({ timeout: 15_000 }));
    await page.waitForTimeout(800);
  }

  /* ── 首轮评分点名的取证缺口②：markdown 呈现（替身对触发词回 markdown 正文，
   *    渲染路径是真实生产代码；这是给渲染器喂已知输入，不是伪造输出）── */
  const composer2 = page.getByTestId("chat-message-input");
  if (await composer2.isVisible().catch(() => false)) {
    await step("发 markdown 取证消息", async () => {
      await composer2.fill(CHAT_READ_E2E.deepAgentMarkdownTrigger);
      await page.getByTestId("chat-message-submit").click({ timeout: 20_000 });
    });
    await page.waitForTimeout(9000);
    await shoot("b8-markdown.png", "第8项 消息呈现质量", "markdown 回复终态：标题/列表/代码块/行内 code 的真实渲染");

    /* ── 第4项 真实多步能力：多步依赖链取证 ───────────────────────────────
     * 两轮评分都因「只有单个工具调用块、看不到调用→看结果→下一步的链条」无法给分。
     * 替身对这句触发词回 write_todos → search_documents → read_document 的剧本，
     * 第二个工具的 args.path（A.md）逐字来自第一个工具的结果——链条本身就是证据。
     * 展开写法照上面 b3-tool-expanded。 */
    // 发送前先数一次折叠头数量——发送后 `.last()` 必须等这个数字真的涨了才可信，
    // 否则消息行还没挂载，`.last()` 会取到上一条消息的折叠头（陈旧内容，2026-08-24
    // 第一轮取证实测踩过：b742-1 系列曾经拍到的是第一条消息已终态的 lookup_time 块）。
    const toggleCountBeforeMultistep = await page.getByTestId("agent-tool-chain-toggle").count();
    await step("发多步取证消息", async () => {
      await composer2.fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
      await page.getByTestId("chat-message-submit").click({ timeout: 20_000 });
    });

    /* ── #742 Gap 1 取证：run 进行中态可见 ──────────────────────────────
     * loopback 上游（见 `loopback-deep-agent-provider.ts` 的
     * `MULTISTEP_MIN_STATUS_POLLS`）把这条多步剧本的终态推迟到至少 6 次状态轮询、
     * 每个工具调用先只有"宣布"半、停留至少一轮，让真实的 `in_progress` 账本行有一个
     * 能被前端真的轮询到、真的渲染出来的窗口。展开工具链，边等边拍，抓「进行中」徽标
     * 与脉动图标——不是等终态后拍一张再假装它曾经在场。 */
    await step("等新消息的折叠头真的挂载、再展开（趁 run 还在进行中）", async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await page.getByTestId("agent-tool-chain-toggle").count() > toggleCountBeforeMultistep) break;
        await page.waitForTimeout(500);
      }
      const toggle = page.getByTestId("agent-tool-chain-toggle").last();
      if (await toggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await toggle.click({ timeout: 10_000 });
      }
    });
    for (let i = 1; i <= 4; i += 1) {
      await page.waitForTimeout(1500);
      const inProgressBadge = await page.getByTestId("agent-tool-chain-in-progress-badge")
        .isVisible({ timeout: 1_000 }).catch(() => false);
      await shoot(
        `b742-1-in-progress-${String(i).padStart(2, "0")}.png`,
        "#742 Gap 1 进行中态可见",
        `第 ${i * 1.5}s：折叠头「进行中」徽标可见=${inProgressBadge}——工具调用开始时就有真实记账（in_progress），不是只有终态才出现在 steps 里`,
      );
    }
    /* 多步剧本被 `MULTISTEP_MIN_STATUS_POLLS` 故意拖慢（见上面 Gap 1 取证的注释）。
     * ⚠ 目标信号选的是 search_documents 的终态卡片，不是链条最后一次的 read_document：
     * read_document 一落终态，run 几乎在同一拍就转终态、写回、前端从"活体 run 视图"
     * 切到持久消息视图（`agent-tool-chain-*` 一系列 testid 随之从 DOM 消失，见
     * `agent-tool-chain.tsx` 头注"它替换了什么"一节——持久消息走的是另一套 `ToolCalls`
     * 组件），窗口窄到几乎拍不到。search_documents 终态之后 read_document 还要再等
     * 至少一轮才被回答，这段间隙才是稳定拍得到"至少两个工具定制卡片同屏"的窗口。
     * 运行中的 run 偶尔会因 UI 重渲染把折叠块重新收起，所以每轮都重新点开再检查。 */
    await step("等多步链路跑到 search_documents 落终态（而不是猜一个固定时长）", async () => {
      const searchCard = page.getByTestId("agent-tool-chain-search-documents-card");
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (await searchCard.isVisible({ timeout: 500 }).catch(() => false)) return;
        const toggle = page.getByTestId("agent-tool-chain-toggle").last();
        if (await toggle.isVisible({ timeout: 500 }).catch(() => false)
          && await toggle.getAttribute("aria-expanded").catch(() => null) === "false") {
          await toggle.click({ timeout: 5_000 }).catch(() => {});
        }
        await page.waitForTimeout(1000);
      }
    });
    await shoot("b4-multistep-expanded.png", "第4项 真实多步能力", "展开态显示工具调用的入参/结果链条：write_todos → search_documents(query) → read_document(path=A.md，path 逐字来自搜索结果，此刻可能仍是进行中)");

    /* ── #742 Gap 4 取证：至少两个工具的定制渲染可见 ──────────────────────
     * write_todos 渲成计划条目列表、search_documents 渲成文档条目列表——不是
     * 「参数 JSON + 结果 JSON」的通用文本卡片。read_document 此刻大概率仍是
     * in_progress（上一步特意等在这个窗口，见其注释），readOk 记 false 是这一刻的
     * 真实状态，不是它没做——它的展开态卡片与 write_todos/search_documents 是同一份
     * 组件代码（`ToolChainStepBody` 的 switch 分支），单测（`agent-tool-chain.test.tsx`
     * 「read_document：文件名与正文预览分开展示」）已经真实断言过它的渲染。 */
    await step("截取 per-tool 定制卡片", async () => {
      const todosCard = page.getByTestId("agent-tool-chain-write-todos-list");
      const searchCard = page.getByTestId("agent-tool-chain-search-documents-card");
      const readCard = page.getByTestId("agent-tool-chain-read-document-card");
      const todosOk = await todosCard.isVisible({ timeout: 3_000 }).catch(() => false);
      const searchOk = await searchCard.isVisible({ timeout: 3_000 }).catch(() => false);
      const readOk = await readCard.isVisible({ timeout: 3_000 }).catch(() => false);
      await shoot(
        "b742-2-per-tool-cards.png",
        "#742 Gap 4 按工具定制渲染",
        `write_todos 列表=${todosOk} search_documents 文档列表=${searchOk} read_document 卡片=${readOk}——各自贴合真实数据形状，不共用同一张通用卡片`,
      );
    });

    /* ── 取证缺口③：真实失败态。FAILURE_TRIGGER 是 loopback 既有的真实失败通路
     *    （上游 run 真的以 error 终态返回，api 侧走真实失败处理与写回）——
     *    这与「伪造一张错误截图」不同：失败链路每一层都是生产代码在跑。 */
    await step("触发真实失败", async () => {
      await composer2.fill(CHAT_READ_E2E.deepAgentFailureTrigger);
      await page.getByTestId("chat-message-submit").click({ timeout: 20_000 });
    });
    await page.waitForTimeout(12_000);
    await shoot("b7-error-real.png", "第7项 错误处理透明度", "上游 error 终态后的真实失败呈现：错误文案/状态条/可恢复入口");

    /* ── UX-9 D4 前端接入取证（gap 清单第 3 条，「Edit, then continue」HITL 模式）──
     * 替身对 deepAgentApprovalTrigger 让 run 真的走到 awaiting_approval（DA-07b），
     * 这里走「编辑参数 → 修改 JSON → 编辑并批准」这条此前从未有前端入口的路径，
     * 拍下编辑态表单可见、编辑后提交、审批面板转终态三张证据。 */
    await step("触发人工审批", async () => {
      await composer2.fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
      await page.getByTestId("chat-message-submit").click({ timeout: 20_000 });
    });
    const approvalPanelShown = await step("等待审批面板出现", async () => {
      await page.getByTestId("agent-approval-panel").waitFor({ state: "visible", timeout: 20_000 });
    });
    if (approvalPanelShown) {
      await shoot("b-hitl-1-awaiting-approval.png", "HITL edit：待批态", "run 停在 awaiting_approval，审批面板显示待批工具与只读参数摘要");

      await step("点击「编辑参数」进入编辑态", async () => {
        await page.getByTestId("agent-approval-start-edit").click({ timeout: 10_000 });
      });
      await shoot("b-hitl-2-edit-form.png", "HITL edit：编辑态表单可见", "文本域可编辑，播种自待批参数摘要——证明编辑态表单真的渲染出来，不是只读 pre 的替身");

      await step("编辑 JSON 参数后提交", async () => {
        const textarea = page.getByTestId("agent-approval-edit-textarea");
        await textarea.fill('{"to":"ops@example.test","subject":"取证：已编辑","body":"人工编辑后的正文——用于核对提交的是改后的值"}');
        await shoot("b-hitl-3-edited-json.png", "HITL edit：已编辑的 JSON", "提交前的编辑态截图，肉眼核对文本域内容确实被改过");
        await page.getByTestId("agent-approval-edit-submit").click({ timeout: 10_000 });
      });

      await step("等待审批面板消失（run 回到 queued/running）", async () => {
        await page.getByTestId("agent-approval-panel").waitFor({ state: "hidden", timeout: 20_000 });
      });
      await page.waitForTimeout(6_000);
      await shoot("b-hitl-4-after-edit-approve.png", "HITL edit：编辑并批准后的终态", "审批面板已收起，run 按编辑后的参数继续执行——终稿应能看到编辑后的值（见 MANIFEST 说明）");
    } else {
      await shoot("b-hitl-0-panel-missing.png", "HITL edit：取证受阻", "审批面板未出现——awaiting_approval 链路可能未生效");
    }
  }

  await shoot("b7-error-surface.png", "第7项 错误处理透明度", "当前会话全貌（含上方真实失败态的上下文）");

  /* ── UIUX 对标 CopilotKit gap #2（issue #712）——追问建议真实性取证 ──────────────
   * `computeFollowUpSuggestions` 此前是纯前端确定性规则（头注原话「这不是 AI 推荐」）。
   * 现在优先请求 `POST /chat/threads/:threadId/followup-suggestions`，真实模型调用
   * （走 `agentId` 这个**非 deep-agent** 的 `ConfiguredModelProvider` 代码路径，见
   * `apps/api/scripts/loopback-model-provider.ts` 的 `isFollowUpSuggestionsRequest`
   * 分支——回显的是它在 history 里真的看到的那一轮对话正文，不是套壳文案）。
   *
   * 两条独立的新线程、两条完全不相关的消息，各自截一张 chip 图——如果两张图上的
   * 建议文案不同，就证明了「建议内容随对话内容变化」，不是恒定的「能否再详细说明一下？」。
   */
  const gap2Topics = [
    { message: "我们下季度的能耗预算应该怎么定？", shot: "b6-followup-topic-a.png" },
    { message: "招聘计划里生产计划员的候选人有哪些？", shot: "b6-followup-topic-b.png" },
  ];
  for (const topic of gap2Topics) {
    await step(`gap#2 追问建议取证：${topic.message}`, async () => {
      await page.goto("/chat");
      await page.getByTestId("chat-thread-create").click({ timeout: 15_000 });
      await page.waitForURL(/\/chat\?thread=/);
      await page.getByTestId("chat-thread-detail").waitFor({ state: "visible", timeout: 30_000 });
      await page.getByTestId("chat-agent-select").click({ timeout: 15_000 });
      await page.getByTestId(`chat-agent-select-option-${CHAT_READ_E2E.agentId}`).click({ timeout: 15_000 });
      await page.getByTestId("chat-message-input").fill(topic.message);
      await page.getByTestId("chat-message-submit").click({ timeout: 20_000 });
      // 等到 agent 回复终态落位（触发 `computeFollowUpSuggestions` 的判据：最新一条来自
      // agent），再等真实建议请求这一轮往返——比确定性规则慢，但比消息发送本身快得多。
      await page.getByTestId("chat-followup-suggestions").waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(4_000);
    });
    await shoot(topic.shot, "追问建议真实性（issue #712 / CopilotKit gap #2）", `发「${topic.message}」后 composer 下方的建议 chip——与另一条消息对照，判内容是否随对话变化`);
  }

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
