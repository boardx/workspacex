/**
 * 路径矩阵 **C6 Office 产物**（`.harness/instructions/chat-path-coverage-matrix.md`）——
 * chat 里请求 docx / xlsx / pptx，产出**可下载且可重新打开**。
 *
 * ## 这条路径此前为什么是「部分」
 *
 * 矩阵原文：「`apps/api` 侧有 pptx real-stack；chat 侧无」。`apps/api` 那条
 * （`tests/chat/chat-skill-mount-produces-pptx-real-stack.test.ts`）是在 vitest 进程里
 * 直接驱动用例层的；**没有任何一条用例从真实浏览器的 `/chat` 发一句话、再把产出的
 * Office 文件下载回来打开**。这个文件补的就是那一段。
 *
 * ## 判据（三条，缺一不可）——刻意**不用**「文件大小 > 0」这类痕迹
 *
 * 本仓有案底（矩阵 C2 那条用「PNG 字节大小比值 < 0.15」判「内容相同」，阈值擦边、
 * 既抓不到想抓的又被噪声触发）。这里三条判据全部是行为：
 *
 * 1. **真的产出了这一轮点名的那个文件** —— 权威读
 *    `GET /chat/threads/:id/attachments`，文件名逐字等于这一轮正文里点的名字。
 *    名字带本轮随机后缀 ⇒ 上一轮的产物、别的用例的产物都不满足。
 * 2. **可下载 = 真的拿到了字节** —— `GET .../attachments/:id/content` 的响应体
 *    `body()`，长度必须等于列表里那条记录声明的 `bytes`。不是"下载按钮 enabled"，
 *    不是"有个 blob: URL"。
 * 3. **可重新打开 = 打开后的内容对** —— 把那串字节喂给 `@repo/skill-sandbox/ooxml`
 *    的 `inspectPptx` / `inspectDocx` / `inspectXlsx`：它们真的解 zip、解 XML、
 *    读文本节点，任何一步不成立就 throw。再断言读出来的文本里含**本轮的哨兵**。
 *    ⇒「回了一段随便什么二进制」「回了上一轮的产物」「回了另一种格式」三种失效
 *    全部会红。反证见文件末尾那一节。
 *
 * 第 3 条用的是仓库里**已有**的那套断言（`apps/api` 的 pptx real-stack 与
 * `verification.md` V1 用的是同一支），不新写第二份 zip 解析——「同一事实不得声明在
 * 两处」。
 *
 * ## 授权边界：**不碰真实模型、不碰真实 Office 工作流**
 *
 * 整条链跑在确定性替身上：`loopback-model-provider.ts` 按用户正文里点名的扩展名
 * 回一个 `run_script` 围栏，`loopback-skill-sandbox-behavior.ts` 用 `docx` /
 * `exceljs` / `pptxgenjs` **本体**生成真实合法的字节。替身替的是「模型这一轮决定
 * 写哪个文件」与「沙箱执行脚本」两件事；**产物字节是真的**，落库、鉴权、下载、
 * 解析四段全部是产品代码。
 *
 * ## 为什么不需要新的 testid
 *
 * 三条判据全部走权威 HTTP 读，不看渲染帧——产物落库与产物渲染是两个时刻，混着等
 * 会把"渲染慢"误判成"没产出"（矩阵 F7 三跑的教训）。UI 侧「材料」页签那条链路
 * 已由 `chat-attachment-preview-download.spec.ts` 覆盖（同一张
 * `chat_message_attachments` 表、同一个预览弹窗），本文件不重复断言它。
 */
import { expect, test } from "@playwright/test";

test.setTimeout(240_000);
/*
 * ⚠ **相对路径导入，不是 `@repo/skill-sandbox/ooxml`**（本 PR 实测踩过一次）。
 * 把 `@repo/skill-sandbox` 加进 `apps/web` 的 devDependencies 会让 pnpm 重新解析
 * `@axe-core/playwright` 的 peer `playwright-core`：`1.62.0` → `1.63.0-alpha-2026-08-31`，
 * 于是 `axe-*.spec.ts` / `chat-task-workbench-a11y.spec.ts` 全线
 * `TS2741: Property 'ariaSnapshotJSON' is missing`，`web#typecheck` 直接红。
 * `ooxml.ts` 是零运行时依赖的纯 TS（只用 `node:zlib`），相对导入不需要那条 workspace 边，
 * 也就不会动 lockfile 的解析结果。
 *
 * 仍然是**同一支**断言（同一个文件），不是抄一份第二实现——「同一事实不得声明在两处」。
 */
import { inspectDocx, inspectPptx, inspectXlsx } from "../../skill-sandbox/src/ooxml";
import {
  login,
  openFreshEchoAgentThread,
  sendInV2AndAwaitStoredReply,
  sessionHeaders,
} from "./support/chat-path-coverage";

interface ThreadAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mime: string;
  readonly bytes: number;
}

const OFFICE_MIME = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

/**
 * 等这一轮**点名的那个文件**真的落进本线程的附件表。
 *
 * ⚠ 判据同时具备矩阵那两条性质（C5 为此红了三跑）：文件名里带本轮随机后缀 ⇒
 * **只有本轮**才满足；扩展名是被测格式 ⇒ **只有被测分支**才满足。少一个，这一步
 * 就会被别的轮次/别的用例的产物提前满足，红被推到后面、诊断失声。
 */
async function awaitProducedAttachment(
  page: import("@playwright/test").Page,
  threadId: string,
  fileName: string,
): Promise<ThreadAttachment> {
  const list = async (): Promise<readonly ThreadAttachment[]> => {
    const response = await page.request.get(`/chat/threads/${threadId}/attachments`, {
      headers: await sessionHeaders(page),
    });
    expect(response.ok(), `列附件失败：HTTP ${response.status()}`).toBe(true);
    return (await response.json() as { items: ThreadAttachment[] }).items;
  };
  try {
    await expect
      .poll(async () => (await list()).some((item) => item.filename === fileName), {
        timeout: 120_000,
        intervals: [500, 1_000, 2_000],
      })
      .toBe(true);
  } catch (failure) {
    /*
     * 「红 ≠ 跑过」：等不到时，「这一轮 run 没产出任何文件」与「产出了但名字不是这一轮
     * 点的那个」是两个完全不同的结论，从一条超时里分不出来。把这条线程**真实落库的
     * 全部附件**摘进失败信息，让下一次读红的人直接拿到答案。判据不放宽。
     */
    const items = await list();
    const detail = items.length === 0
      ? "这条线程一个附件都没有——这一轮 run 没有产出文件（脚本围栏没命中、沙箱没被调用、或 run 失败了）"
      : items.map((item) => `· ${item.filename}（${item.mime}，${String(item.bytes)} 字节）`).join("\n");
    throw new Error(
      `${failure instanceof Error ? failure.message : String(failure)}\n\n`
      + `【诊断】期待线程 ${threadId} 落一个名为「${fileName}」的产物，实际落库的附件：\n${detail}`,
    );
  }
  return (await list()).find((item) => item.filename === fileName)!;
}

/** 真的把字节拉回来——「可下载」的唯一读法。 */
async function downloadBytes(
  page: import("@playwright/test").Page,
  threadId: string,
  attachment: ThreadAttachment,
): Promise<Buffer> {
  const response = await page.request.get(
    `/chat/threads/${threadId}/attachments/${attachment.id}/content`,
    { headers: await sessionHeaders(page) },
  );
  expect(response.ok(), `下载产物失败：HTTP ${response.status()}`).toBe(true);
  const bytes = Buffer.from(await response.body());
  expect(
    bytes.length,
    `下载回来的字节数（${String(bytes.length)}）必须等于附件记录声明的 ${String(attachment.bytes)}——`
    + "对不上说明拿到的不是这份产物的完整字节",
  ).toBe(attachment.bytes);
  return bytes;
}

/**
 * 三种格式的正文完全同形，只有格式名不同——所以正文只写一次。
 *
 * ⚠ 但**三条 `test()` 的标题必须是各自写死的双引号字面量**，不是模板串循环出来的：
 * `.harness/scripts/lint-chat-path-coverage.mjs` 那道门认的是
 * `/test(?:\.fixme)?\(\s*"@path:([A-F]\d+)/`——模板串它抓不到，spec 与矩阵之间的机械
 * 联系就断了（本文件第一版正是这么红的）。
 */
async function assertOfficeArtifactRoundTrip(
  page: import("@playwright/test").Page,
  format: "pptx" | "docx" | "xlsx",
): Promise<void> {
  await login(page);
  const threadId = await openFreshEchoAgentThread(page);

  // 本轮唯一标识。文件名与哨兵共用它 ⇒ 上一轮/别的用例的产物都不可能满足判据。
  const nonce = `${String(Date.now() % 100_000)}-${String(Math.floor(Math.random() * 10_000))}`;
  const sentinel = `C6-OFFICE-${format.toUpperCase()}-${nonce}`;
  const fileName = `c6-${format}-${nonce}.${format}`;
  const ask = `请出一份 ${fileName}，正文里写上代号 ${sentinel}`;

  // 等的是**落库**的回复，不是渲染帧；等待串同时要求「只有被测分支满足」
  //（`run_script` 围栏）与「只有本轮满足」（本轮哨兵）。
  await sendInV2AndAwaitStoredReply(page, threadId, ask, ["```run_script", sentinel]);

  const attachment = await awaitProducedAttachment(page, threadId, fileName);
  expect(
    attachment.mime,
    `产物 mime 必须是 ${format} 的那一个——错了说明落库时的类型判定与请求的格式脱节`,
  ).toBe(OFFICE_MIME[format]);

  const bytes = await downloadBytes(page, threadId, attachment);

  // 「可重新打开」：真的解 zip、解 XML、读文本节点。任何一步不成立 inspect* 会 throw，
  // 失败信息里带的是它自己那句具体的话（"not a zip"/"no ppt/slides/…"/"…main+xml"），
  // 而不是一个笼统的 expect 失败——这正是「失败点可读」那条要求。
  const texts = format === "pptx"
    ? inspectPptx(bytes).textRuns
    : format === "docx"
    ? inspectDocx(bytes).textRuns
    : inspectXlsx(bytes).sharedStrings;

  expect(
    texts.some((one) => one.includes(sentinel)),
    `打开产物后必须读到本轮哨兵 ${sentinel}；实际读到的文本节点：${JSON.stringify(texts)}`
    + "——读不到说明拿到的是上一轮的产物、别人的产物，或者内容与这次请求无关",
  ).toBe(true);
}

test("@path:C6 pptx：产出可下载，且下载回来的字节真的能打开、内容是这一轮要的", async ({ page }) => {
  await assertOfficeArtifactRoundTrip(page, "pptx");
});

test("@path:C6 docx：产出可下载，且下载回来的字节真的能打开、内容是这一轮要的", async ({ page }) => {
  await assertOfficeArtifactRoundTrip(page, "docx");
});

test("@path:C6 xlsx：产出可下载，且下载回来的字节真的能打开、内容是这一轮要的", async ({ page }) => {
  await assertOfficeArtifactRoundTrip(page, "xlsx");
});

/**
 * ## 反证（这条 spec 不是空转的证据）
 *
 * 见本 PR 正文与 issue 评论里贴的红行。三条判据各自的破坏方式与预期红：
 *
 * | 破坏 | 预期红在哪一条 |
 * |---|---|
 * | `loopback-skill-sandbox-behavior.ts` 的 docx/xlsx 分支删掉（回落到 pptx 兜底） | 判据 1：附件名是 `deck.pptx` 不是本轮点名的 `c6-docx-<nonce>.docx`，诊断打印真实落库附件 |
 * | 沙箱回 `__LOOPBACK_EMPTY_FILE__` 那档（0 字节） | 判据 3：`inspectPptx` throw `corrupt zip: no end-of-central-directory record found` |
 * | 把 docx 分支产出的字节换成 pptx | 判据 3：`inspectDocx` throw `not a Word document: [Content_Types].xml does not declare wordprocessingml.document.main+xml` |
 * | 模型替身不把用户正文嵌进脚本（回固定文案） | 判据 3 的哨兵断言：读到的是常量文本，失败信息里原样打印 |
 */
