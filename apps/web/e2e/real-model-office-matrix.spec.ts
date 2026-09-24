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

/*
 * ⚠ 浏览器侧的 API 路径**不能写死 `/api`**（2026-09-24 已经在 pdf-smoke 上栽过一次，
 * 这里又栽了第二次，所以这段注释写在这儿）：
 *   · devapp lane 打公网入口，反代把 `/api/*` 转给后端 ⇒ `/api/chat/...`
 *   · 本地 lane 走 Next 的同源改写 ⇒ `/__fullstack_api/chat/...`
 * 前缀的唯一事实源是 `NEXT_PUBLIC_API_PATH_PREFIX`（config 里算一次、赋回 process.env，
 * 两边共用）。写死哪一边都会让另一边拿回 404 的 HTML。
 */
const API_PREFIX = (process.env.NEXT_PUBLIC_API_PATH_PREFIX ?? "").replace(/\/$/, "");
const apiPath = (path: string): string => (API_PREFIX === "" ? `/api${path}` : `${API_PREFIX}${path}`);

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

  const sentAt = Date.now();
  let sawRunning = false;
  while (Date.now() - sentAt < TASK_BUDGET_MS) {
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

  const listed = await page.request.get(apiPath(`/chat/threads/${threadId!}/attachments`));
  expect(listed.ok(), `列产物失败 HTTP ${String(listed.status())}`).toBe(true);
  const items = ((await listed.json()) as { items?: Attachment[] }).items ?? [];
  const wanted = `${mark}.${ext}`;
  const produced = items.find((i) => i.filename === wanted)
    ?? items.find((i) => i.filename.endsWith(`.${ext}`));
  expect(produced, `没有产出 .${ext}（现有：${items.map((i) => i.filename).join(",") || "空"}）`).toBeDefined();

  const bytes = await page.request.get(apiPath(`/chat/threads/${threadId!}/attachments/${produced!.id}/content`));
  const body = await bytes.body();
  expect(body.length, "下载到的字节数与登记的不一致").toBe(produced!.bytes);
  const head = body.subarray(0, 8).toString("latin1");
  expect(head.startsWith(MAGIC[ext]), `字节头不是 ${ext}：「${head.replace(/[^\x20-\x7e]/g, ".")}」`).toBe(true);
  return `${produced!.filename} ${String(body.length)}B`;
}

test("真实模型：十种计划任务全部产出可打开的 Office 文件", async ({ page }) => {
  test.setTimeout(TASK_BUDGET_MS * TASKS.length + 600_000);
  await login(page);

  for (const task of TASKS) {
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
      rows.push({
        name: task.name, ext: task.ext, ok: false, ms: Date.now() - started,
        detail: (error instanceof Error ? error.message : String(error)).split("\n")[0]?.slice(0, 180) ?? "",
      });
    }
  }

  const ok = rows.filter((r) => r.ok).length;
  const lines = [
    "# 真实模型 × 十种计划任务 × Office 产出",
    "",
    `**${String(ok)} / ${String(rows.length)}（${String(Math.round((ok / rows.length) * 100))}%）**`,
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
