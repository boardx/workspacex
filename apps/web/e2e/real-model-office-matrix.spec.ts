/**
 * **真实模型 × 10 个真任务 × 四种 Office 格式**（2026-09-25 人类交办）。
 *
 * 原话：「要使用真的浏览器 + 真的模型 + 真的任务 + 使用 office 的生成，pdf、excel、
 * ppt、word 生成测试来验收，测试 10 种不同的计划任务，每轮测试必须要 100% 完成才算完」。
 *
 * ## 与既有两份的分工
 *
 * · `real-model-pdf-smoke.spec.ts`：**一条** prompt 的深度体检（八条断言，含审批弹窗、
 *   气泡重复、SSE 掐断、页面异常）。它回答「这一次跑的过程健不健康」。
 * · `deepagent-plan-execute-reliability.spec.ts`：确定性替身上的成功率矩阵。
 *   它回答「上游确定时我们这条链稳不稳」。
 * · **本文件**：真实模型下**十种不同计划任务**的产出成功率。
 *   它回答人类真正在问的那件事——「让它干十件事，几件真的干成了」。
 *
 * ## 效率：一次起栈、一个浏览器会话跑完十件
 *
 * 起栈（docker + 种子 + API + next build）是最大的固定成本，每个任务起一次会把
 * 40 分钟的事拖成 3 小时。所以这里**登录一次**，之后每个任务只开一条新线程。
 * 一个任务失败**不中断**整张表——否则拿到的是「第一个失败」而不是「成功率」。
 *
 * ## 判据：按字节判，不按模型措辞判
 *
 * 每个任务三件事全部成立才算完成：
 *   ① 产物真的落库（权威读 `GET /chat/threads/:id/attachments`，文件名扩展名对得上）
 *   ② 真的下载得到字节，且长度等于登记的 bytes
 *   ③ 字节头是那个格式（PDF 是 `%PDF-`；OOXML 三兄弟是 zip 的 `PK`）
 * 「模型说它做好了」一律不算——本仓有案底（#2786 那次就是模型声称产出了文件）。
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { REAL_MODEL_SKIP_REASON, REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
/*
 * ⚠ 浏览器侧打后端**不自己写**：路径前缀与会话令牌两件事我在三轮真机跑里各错过一次
 * （404 → 401 → …），单一事实源在 `support/real-model-api.ts`，那里有完整的三次教训。
 */
import { authedBytes, authedJson } from "./support/real-model-api";

test.skip(REAL_MODEL_SKIP_REASON !== null, REAL_MODEL_SKIP_REASON ?? "");

const OUT = join(process.cwd(), "../../evidence/local-desktop/chat-quality/real-model-office-matrix.md");
/** 单个任务的等待上限。真实模型一次 Office 生成实测 400–500s，给足余量。 */
const TASK_BUDGET_MS = Number(process.env.REAL_MODEL_TASK_BUDGET_MS ?? "600000");

interface Task {
  readonly name: string;
  readonly ext: "pdf" | "docx" | "xlsx" | "pptx";
  readonly prompt: (mark: string) => string;
}

/** 十种**不同形状**的计划任务——不是同一句话换四个扩展名。 */
const TASKS: readonly Task[] = [
  { name: "① 研究→PPT（人类原例）", ext: "pptx",
    prompt: (m) => `深度研究中国的教育和人工智能会如何融合，然后生成一个名为 ${m}.pptx 的文件来介绍研究内容和总结，文件里要出现 ${m}` },
  { name: "② 周报→Word", ext: "docx",
    prompt: (m) => `写一份本周项目周报，包含进展、风险、下周计划三节，生成名为 ${m}.docx 的文件，文件里要出现 ${m}` },
  { name: "③ 预算表→Excel", ext: "xlsx",
    prompt: (m) => `做一张三个季度的部门预算表，含人力、市场、研发三行与合计，生成名为 ${m}.xlsx 的文件，文件里要出现 ${m}` },
  { name: "④ 说明书→PDF", ext: "pdf",
    prompt: (m) => `写一份产品使用说明，包含安装、使用、常见问题三部分，生成名为 ${m}.pdf 的文件，文件里要出现 ${m}` },
  { name: "⑤ 先提纲后成稿→PPT", ext: "pptx",
    prompt: (m) => `先列出一个关于远程办公效率的演讲提纲，再据此生成名为 ${m}.pptx 的文件，文件里要出现 ${m}` },
  { name: "⑥ 长文档（≥5 节）→Word", ext: "docx",
    prompt: (m) => `写一份至少五个章节的新员工入职手册，生成名为 ${m}.docx 的文件，文件里要出现 ${m}` },
  { name: "⑦ 多表页→Excel", ext: "xlsx",
    prompt: (m) => `做一个包含「收入」和「支出」两个工作表的年度账目，生成名为 ${m}.xlsx 的文件，文件里要出现 ${m}` },
  { name: "⑧ 含数据表的报告→PDF", ext: "pdf",
    prompt: (m) => `写一份含一张数据表格的季度经营分析，生成名为 ${m}.pdf 的文件，文件里要出现 ${m}` },
  { name: "⑨ 限定页数→PPT", ext: "pptx",
    prompt: (m) => `做一个正好 6 页的产品介绍演示文稿，生成名为 ${m}.pptx 的文件，文件里要出现 ${m}` },
  { name: "⑩ 先算后讲（跨格式）→PPT", ext: "pptx",
    prompt: (m) => `先算一下某公司三年营收从 100 万增长到 400 万的年均增长率，再把结论做成名为 ${m}.pptx 的文件，文件里要出现 ${m}` },
];

const MAGIC: Record<Task["ext"], string> = { pdf: "%PDF-", docx: "PK", xlsx: "PK", pptx: "PK" };

interface Row {
  readonly name: string; readonly ext: string; readonly ok: boolean;
  readonly ms: number; readonly detail: string;
}
const rows: Row[] = [];

async function login(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.evaluate(() => { window.localStorage.clear(); }).catch(() => {});
  await page.goto("/login");
  await page.getByTestId("login-email").fill(REAL_MODEL_SMOKE.email);
  await page.getByTestId("login-password").fill(REAL_MODEL_SMOKE.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 60_000 });
}

/** 发一句话并等这一轮落定。返回是否**真的跑起来过**——没跑起来与跑完是两件事。 */
async function sendAndSettle(page: Page, prompt: string): Promise<string> {
  await page.goto("/chat");
  const composer = page.getByTestId("copilotkit-v2-input");
  await expect(composer).toBeVisible({ timeout: 120_000 });
  await composer.fill(prompt);
  const send = page.getByTestId("copilotkit-v2-send");
  await send.click();

  /**
   * 原生 deep-agent 链路会先问一遍「我理解的任务是这样，对吗」（`confirm_task_intent`，
   * `DEEP_AGENT_HITL_CLARIFICATION` 非 `off` 时挂载——生产多用户部署的默认形状，
   * `apps/deep-agent-service/src/deep_agent_service/tools.py` 的头注）。
   *
   * 2026-09-25 实测：这一步落到 `GET /threads/:id` 的 `status: "interrupted"`，
   * 是图**正确地**停在等人裁决，不是失败（`deep-agent-model-provider.ts` 的
   * `readInterruptedCompletion` 分支逐字这么说）。但 `data-send-state` 在这个状态下
   * 停在 `"running"` 不再变——这条轮询循环只看这一个属性，于是把「正确地在等确认」
   * 误判成「跑满预算的超时」。legacy call_skill 路径不挂这个工具，从没暴露过这个
   * 判据缺口；十任务矩阵里五个"超时"实测全部卡在这一步（真实模型十任务 Office
   * 矩阵证据包 `62-deep-agent.log`：`confirm_task_intent` 之后 `interrupted`，
   * 此后再没有任何新请求，直到测试自己的预算耗尽）。
   *
   * 修法与 `real-model-pdf-smoke.spec.ts` 逐字同一条纪律：出现就点确认——这正是
   * 真实用户会做的事，不是给判据开后门。
   */
  const confirmIntentContinue = page.getByTestId("agent-interrupt-confirm-intent-continue");
  /**
   * 第二道人在环门：`write_todos`（计划确认，issue #3132/B7）。跟 `confirm_task_intent`
   * 不是同一个工具，落在同一个 `interrupted` 状态里，前端也是完全不同的组件
   * （`plan-confirm-gate.tsx`，不是 `confirm-intent-card.tsx`）。2026-09-25 实测：
   * 单独隔离跑复杂任务时直连 deep-agent-service 的 `/threads/:id/state` 现场抓到
   * 卡在 `write_todos` 这一步——只处理了 `confirm_task_intent` 那一道门还不够，
   * 十任务矩阵里那三个多步骤任务（先做研究/先列提纲/先算后讲）仍然全部超时。
   */
  const planConfirmRun = page.getByTestId("chat-task-workbench-plan-confirm-run");
  // 每一轮 task 各自的一次性开关——写成局部变量而不是复用上一个 task 遗留的状态，
  // 避免一次点击卡住之后在同一个 task 里反复重试、把一次可恢复的慢渲染拖成死循环。
  let confirmedOnce = false;
  let planConfirmedOnce = false;

  const sentAt = Date.now();
  let sawRunning = false;
  while (Date.now() - sentAt < TASK_BUDGET_MS) {
    // `.count()` 是快照，不像 `.isVisible()` 那样在校验与点击之间还留一段可能被
    // 对面重渲染改变的窗口——2026-09-25 头一版用 `isVisible()` 后立刻 `click()`，
    // 卡片在两步之间被重渲染掉，`click()` 卡满 60s 超时，还连累了同一个共享 `page`
    // 后面几个 task 全部 `toBeVisible` 失败。这里改成：数到恰好一次就点，点不动
    // （5s 内没完成）就放弃这一次，交给下一轮循环重新判断，绝不让一次点击卡住
    // 整条循环、更不能卡到拖垮后面的 task。
    if (!confirmedOnce && (await confirmIntentContinue.count()) > 0) {
      confirmedOnce = true;
      await confirmIntentContinue.click({ timeout: 5_000 }).catch(() => { confirmedOnce = false; });
      await page.waitForTimeout(1_000);
      continue;
    }
    if (!planConfirmedOnce && (await planConfirmRun.count()) > 0) {
      planConfirmedOnce = true;
      await planConfirmRun.click({ timeout: 5_000 }).catch(() => { planConfirmedOnce = false; });
      await page.waitForTimeout(1_000);
      continue;
    }
    const state = await send.getAttribute("data-send-state").catch(() => null);
    if (state === "running") sawRunning = true;
    else if (sawRunning) return "landed";
    else if (Date.now() - sentAt > 120_000) {
      // 两分钟没进 running：这次 run 压根没起来。如实记，不要等满预算把
      // 「没起来」伪装成「超时」——两种失败的排查方向完全不同（同 pdf-smoke 的既有纪律）。
      return "never-started";
    }
    await page.waitForTimeout(2_000);
  }
  return "timeout";
}

interface Attachment { readonly id: string; readonly filename: string; readonly bytes: number }

async function verifyProduced(page: Page, mark: string, ext: Task["ext"]): Promise<string> {
  const threadId = /\/chat\/([^/?#]+)/.exec(page.url())?.[1];
  expect(threadId, "落定后 URL 上没有 threadId，拿不到权威产物列表").toBeTruthy();

  const listed = await authedJson(page, `/chat/threads/${threadId!}/attachments`);
  expect(listed.ok, `列产物失败 HTTP ${String(listed.status)}`).toBe(true);
  const items = ((listed.json as { items?: Attachment[] }).items) ?? [];
  const wanted = `${mark}.${ext}`;
  const produced = items.find((i) => i.filename === wanted)
    ?? items.find((i) => i.filename.endsWith(`.${ext}`));
  expect(produced, `没有产出 .${ext}（现有：${items.map((i) => i.filename).join(",") || "空"}）`).toBeDefined();

  const body = await authedBytes(page, `/chat/threads/${threadId!}/attachments/${produced!.id}/content`);
  expect(body.length, "下载到的字节数与登记的不一致").toBe(produced!.bytes);
  const head = body.subarray(0, 8).toString("latin1");
  expect(head.startsWith(MAGIC[ext]), `字节头不是 ${ext}：「${head.replace(/[^\x20-\x7e]/g, ".")}」`).toBe(true);
  return `${produced!.filename} ${String(body.length)}B`;
}

test("真实模型：十种计划任务全部产出可打开的 Office 文件", async ({ page }) => {
  /*
   * 诊断期可以只跑前 N 个（`REAL_MODEL_TASK_LIMIT=4`，四种格式各一条）。
   * 整轮十件要 40+ 分钟，定位阶段每改一次判据就等 40 分钟是纯浪费。
   * ⚠ **验收必须跑满十件**——限量只用于定位，报告里会如实写明这一轮跑了几件。
   */
  const limit = Number(process.env.REAL_MODEL_TASK_LIMIT ?? String(TASKS.length));
  const running = TASKS.slice(0, Math.max(1, Math.min(limit, TASKS.length)));
  test.setTimeout(TASK_BUDGET_MS * running.length + 600_000);
  await login(page);

  for (const task of running) {
    const started = Date.now();
    const mark = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    try {
      const landing = await sendAndSettle(page, task.prompt(mark));
      if (landing !== "landed") throw new Error(`这一轮${landing === "timeout" ? "超时未落定" : "压根没跑起来"}`);
      /*
       * 真实模型生成 Office 实测 400–500s。远快于此**不是好消息**：
       * 多半是模型没真的执行脚本就收尾了。把这件事写进详情，
       * 否则「16 秒失败」和「500 秒失败」在表里长得一样，而它们的成因完全不同。
       */
      const detail = await verifyProduced(page, mark, task.ext);
      rows.push({ name: task.name, ext: task.ext, ok: true, ms: Date.now() - started, detail });
    } catch (error) {
      /*
       * ⚠ 失败时必须把**屏幕上的真实报错**收进来。
       *
       * 第一轮只记了断言消息（「没有产出 .pptx」），于是十行长得一模一样，
       * 一条都不能拿来定位。真实 stderr 在界面上（失败文案里那段折叠的代码块），
       * 而脱敏后的服务端日志把 detail 洗成了 msg 本身，拿不到。
       * 取不到就取不到，如实留空——不编。
       */
      /*
       * ⚠ 真实 stderr 在**折叠的代码块**里，必须先点开。
       * 上一版直接读 `main` 的 innerText，抓到的是折叠块的外壳
       * （「code · 25 行 复制 显示代码」）加后面的界面文字——十行报错长得一模一样，
       * 一条都不能拿来定位。判据抓错层，比没抓更浪费时间。
       */
      const onScreen = await page.locator("main").innerText().catch(() => "");
      for (const toggle of await page.getByText("显示代码", { exact: true }).all()) {
        await toggle.click().catch(() => {});
      }
      /*
       * ⚠ 页面上的 `<pre>` 有**两类**：模型生成的脚本，和沙箱返回的 stderr。
       * 上一版取「最长的几段」，抓到的全是脚本（`require('pptxgenjs')` …）——
       * 那说明模型其实写对了，但对定位执行失败毫无用处。
       * 这里只取**看起来像报错**的那几段：带 Error / 栈帧 / 退出码的。
       */
      /*
       * ⚠ 先分清**环境**与**产品**。2026-09-25 有一轮四个任务全部 2 秒失败、
       * 报告里写的是「没有产出 .pptx」——而真相是 `ENOTFOUND`，模型压根连不上。
       * 两者在表里长得一模一样，会把一次网络抖动记成产品缺陷。
       * 屏幕上出现模型/传输失败的字样时，这一行标成「环境」，不计进产品成功率的分子分母讨论。
       */
      const envFailure = /模型调用失败|连不上|ENOTFOUND|transport|服务未配置或不可用/.test(onScreen);
      const blocks = await page.locator("main pre").allTextContents().catch(() => []);
      const stderr = blocks
        .map((b) => b.trim())
        .filter((b) => /Error|error:|Cannot find|MODULE_NOT_FOUND|at Object|at Module|Traceback|exit code/i.test(b))
        .join(" ⏎ ");
      rows.push({
        name: task.name, ext: task.ext, ok: false, ms: Date.now() - started,
        detail: `${envFailure ? "⚠ 环境（模型不可达/未配置）：" : ""}`
          + `${(error instanceof Error ? error.message : String(error)).split("\n")[0]?.slice(0, 120) ?? ""}`
          + (stderr === "" ? "" : `；沙箱报错：${stderr.replace(/\s+/g, " ").slice(0, 260)}`),
      });
    }
  }

  const ok = rows.filter((r) => r.ok).length;
  const lines = [
    "# 真实模型 × 十种计划任务 × Office 产出",
    "",
    `**${String(ok)} / ${String(rows.length)}（${String(Math.round((ok / rows.length) * 100))}%）**`
      + (rows.length < TASKS.length ? `　⚠ 本轮只跑了前 ${String(rows.length)} 件（诊断模式），验收要跑满 ${String(TASKS.length)} 件` : ""),
    "",
    "判据：产物真的落库 + 真的下载到字节 + 字节头是那个格式。模型说做好了不算。",
    "",
    "| 任务 | 格式 | 结果 | 耗时 | 详情 |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.name} | ${r.ext} | ${r.ok ? "✅" : "❌"} | ${String(Math.round(r.ms / 1000))}s | ${r.detail} |`),
  ];
  const report = lines.join("\n");
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${report}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(`\n${report}\n`);

  expect(rows.filter((r) => !r.ok).map((r) => `${r.name}：${r.detail}`), "有任务没产出可打开的文件").toEqual([]);
});
