/**
 * 沙箱 loopback 替身的**行为本体**（从 `loopback-skill-sandbox.ts` 抽出，#1652）。
 *
 * ## 为什么要抽这一层出来
 *
 * `loopback-skill-sandbox.ts` 是一支「import 即监听」的进程入口。真栈门控
 * （`tests/chat/chat-skill-mount-produces-pptx-real-stack.test.ts`）需要在 vitest 进程里
 * 起一个**同样行为**的服务器并拿到它的实际端口与调用计数——它不能 import 一支
 * 一被加载就占用固定端口的脚本，而**照抄一份替身逻辑**会立刻制造第二份事实源：
 * 哪天有人改了 `__LOOPBACK_FAIL_ONCE__` 的语义，两份里只有一份会跟着改，
 * 门控就会在一个已经不存在的协议上继续绿。本仓已因「同一事实声明在两处」栽过五次。
 *
 * ⇒ 行为放这里，进程入口只负责 `listen`，真栈测试只负责 `startLoopbackSkillSandbox(0)`。
 *
 * ## ⚠ 它替身的是「执行」，**不是**「隔离」
 *
 * 见 `loopback-skill-sandbox.ts` 头注（那条纪律没有搬家，只是不再与 listen 代码耦合）：
 * 本替身不执行代码、不提供任何隔离，`verification.md` 的 V2-a / V2-b 绝不能用它跑。
 *
 * ## 行为由脚本内容里的指令标记决定（确定性，不靠随机/计时）
 *
 * | 脚本里包含 | 行为 |
 * |---|---|
 * | `__LOOPBACK_FAIL_ONCE__` | 第 1 次非零退出并回一段真实形状的 stderr，第 2 次成功 |
 * | `__LOOPBACK_ALWAYS_FAIL__` | 每次都非零退出 |
 * | `__LOOPBACK_TIMEOUT__` | 回 `timedOut: true` |
 * | `__LOOPBACK_EMPTY_FILE__` | 成功但回一个 0 字节文件 —— **T1-CP 反证用** |
 * | 脚本里出现 `<名字>.docx` | 成功，回一个**真实合法**的 .docx（`docx` 本体生成，不是假字节） |
 * | 脚本里出现 `<名字>.xlsx` | 成功，回一个**真实合法**的 .xlsx（`exceljs` 本体生成，不是假字节） |
 * | 其它 | 成功，回一个**真实合法**的最小 .pptx（pptxgenjs 本体生成，不是假字节） |
 *
 * ## docx / xlsx 两档是路径矩阵 C6 补的（chat 侧 Office 产物）
 *
 * 在此之前**只有 pptx 一档**：一个请求 .docx 的脚本照样回 `deck.pptx`
 * （`platform-owned-skills-real-stack.test.ts` 自己的头注就为此警告过）。于是 chat 侧
 * 「请求 docx / xlsx」这条路径在本车道里**根本无法被证伪**——产物名字与请求无关，
 * 断言只能退化成"有个文件"。两档都用**真实的库本体**生成（`docx` / `exceljs`，
 * `apps/api` 与 `apps/skill-sandbox` 早已依赖），不手搓字节：手搓的东西迟早与真实产物
 * 形态漂移，而上层断言（`@repo/skill-sandbox/ooxml` 的 `inspectDocx`/`inspectXlsx`）
 * 断的正是真实形态——真的解 zip、解 XML、读文本节点。
 *
 * ⚠ **正文文本从脚本里捞**，与 pptx 那档同一条纪律（"内容与请求对应"）：docx 捞
 * `new Paragraph('…')`，xlsx 捞 `addRow(['…'])`。捞不到就用兜底常量——那种情况下
 * 上层"产物内容含本轮哨兵"的断言会如实变红，而不是被一个恒定产物蒙混过去。
 *
 * `SANDBOX_UNAVAILABLE` **不在**这张表里：那一档的正确造法是把地址指向一个没人监听的
 * 端口，而不是让替身"假装自己不可用"——后者测不到真实的连接失败路径。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** 一次失败的 stderr 形状照抄真实 node 栈回溯——回喂给模型的东西必须像真的。 */
export const LOOPBACK_REAL_STDERR =
  "TypeError: pres.ShapeType is not a function\n" +
  "    at Object.<anonymous> (/tmp/work/script.js:7:22)\n" +
  "    at Module._compile (node:internal/modules/cjs/loader:1546:14)";

export interface LoopbackSandboxFile {
  readonly name: string;
  readonly contentBase64: string;
  readonly sizeBytes: number;
}

/**
 * 生成一个真实合法的最小 .pptx。用 pptxgenjs 本体（`@repo/skill-sandbox` 的依赖），
 * 不手搓字节 —— 手搓的东西迟早与真实产物形态漂移，而 OOXML 断言的正是真实形态。
 */
async function realDeck(
  slideTexts: readonly string[],
  fileName: string,
): Promise<LoopbackSandboxFile> {
  const { default: PptxGenJS } = (await import("pptxgenjs")) as {
    default: new () => {
      layout: string;
      addSlide: () => { addText: (t: string, o: Record<string, unknown>) => void };
      write: (o: { outputType: string }) => Promise<unknown>;
    };
  };
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  for (const text of slideTexts) {
    pres.addSlide().addText(text, { x: 0.5, y: 0.5, fontSize: 28, bold: true });
  }
  const out = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
  return { name: fileName, contentBase64: out.toString("base64"), sizeBytes: out.length };
}

/**
 * 生成一个真实合法的 .docx。用 `docx` 本体（`apps/api` / `@repo/skill-sandbox` 的依赖），
 * 不手搓字节 —— 理由同 `realDeck`。
 */
async function realDoc(paragraphs: readonly string[], fileName: string): Promise<LoopbackSandboxFile> {
  const { Document, Packer, Paragraph } = (await import("docx")) as typeof import("docx");
  const doc = new Document({
    sections: [{ children: paragraphs.map((text) => new Paragraph(text)) }],
  });
  const out = await Packer.toBuffer(doc);
  return { name: fileName, contentBase64: Buffer.from(out).toString("base64"), sizeBytes: out.length };
}

/**
 * 生成一个真实合法的 .xlsx。用 `exceljs` 本体，不手搓字节 —— 理由同 `realDeck`。
 *
 * ⚠ 每个单元格写的是**字符串**：`inspectXlsx` 读的是 `xl/sharedStrings.xml`，而 exceljs
 * 只把字符串放进共享字符串表。写成数字会让上层"产物内容含本轮哨兵"那条断言看不到东西。
 */
async function realSheet(rows: readonly string[], fileName: string): Promise<LoopbackSandboxFile> {
  // exceljs 是 CJS：`import()` 下 `Workbook` 在 `.default` 上，不在命名空间对象上。
  // 直接 `new mod.Workbook()` 会 `TypeError: ExcelJS.Workbook is not a constructor`
  //（2026-09-09 本地实测），所以两处都取一次。
  type ExcelNamespace = { Workbook: new () => {
    addWorksheet: (name: string) => { addRow: (values: readonly string[]) => unknown };
    xlsx: { writeBuffer: () => Promise<ArrayBuffer> };
  } };
  const imported = (await import("exceljs")) as unknown as ExcelNamespace & { default?: ExcelNamespace };
  const ExcelJS = imported.default ?? imported;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  for (const row of rows) sheet.addRow([row]);
  const out = Buffer.from(await workbook.xlsx.writeBuffer());
  return { name: fileName, contentBase64: out.toString("base64"), sizeBytes: out.length };
}

/** A small, structurally valid PDF for upper-layer persistence and download assertions. */
function realPdf(fileName: string): LoopbackSandboxFile {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 56 >>\nstream\nBT /F1 16 Tf 72 720 Td (WorkspaceX Agent report) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const out = Buffer.from(body, "utf8");
  return { name: fileName, contentBase64: out.toString("base64"), sizeBytes: out.length };
}

/**
 * 造一个**自带状态**的响应器。
 *
 * ⚠ 状态（`__LOOPBACK_FAIL_ONCE__` 的计次）绑在响应器实例上，不是模块级单例：
 *   同一个 vitest 文件里两条用例各起一台服务器时，模块级计数会让第二条用例
 *   看到第一条留下的次数，于是"第一次失败、第二次成功"变成"直接成功"——
 *   一条本该证明重试真的发生的断言就此变成永远绿。
 */
export function createLoopbackSandboxResponder(): (script: string) => Promise<Record<string, unknown>> {
  const attemptsBySignature = new Map<string, number>();

  return function respond(script: string): Promise<Record<string, unknown>> {
    const base = {
      stdout: "", stderr: "", files: [] as LoopbackSandboxFile[], timedOut: false, durationMs: 12,
    };

    if (script.includes("__LOOPBACK_TIMEOUT__")) {
      return Promise.resolve({ ...base, exitCode: null, timedOut: true, durationMs: 30_000 });
    }
    if (script.includes("__LOOPBACK_ALWAYS_FAIL__")) {
      return Promise.resolve({ ...base, exitCode: 1, stderr: LOOPBACK_REAL_STDERR });
    }
    if (script.includes("__LOOPBACK_FAIL_ONCE__")) {
      const seen = (attemptsBySignature.get("fail_once") ?? 0) + 1;
      attemptsBySignature.set("fail_once", seen);
      if (seen === 1) return Promise.resolve({ ...base, exitCode: 1, stderr: LOOPBACK_REAL_STDERR });
    }
    if (script.includes("__LOOPBACK_EMPTY_FILE__")) {
      // T1-CP：成功退出但产物是 0 字节。上层的 OOXML 断言必须因此变红。
      return Promise.resolve({
        ...base,
        exitCode: 0,
        files: [{ name: "deck.pptx", contentBase64: "", sizeBytes: 0 }],
      });
    }

    const pdfName = /([\w.\-\u3400-\u9fff]+\.pdf)/u.exec(script)?.[1];
    if (pdfName) return Promise.resolve({ ...base, exitCode: 0, stdout: "WROTE_PDF\n", files: [realPdf(pdfName)] });

    // 路径矩阵 C6 —— docx / xlsx 两档排在 pptx 兜底**之前**，否则永远到不了（兜底无条件命中）。
    // 三档互斥：脚本里只会出现一种产物扩展名（模型侧 `trialRunScriptReply` 一次只写一个文件）。
    const docxName = /([\w.\-\u3400-\u9fff]+\.docx)/u.exec(script)?.[1];
    if (docxName) {
      const paragraphs = [...script.matchAll(/new Paragraph\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!);
      return realDoc(paragraphs.length > 0 ? paragraphs : ["Loopback document"], docxName)
        .then((file) => ({ ...base, exitCode: 0, stdout: "WROTE_DOC\n", files: [file] }));
    }
    // ⚠ xlsx 这条多一个否定前瞻 `(?![\w.])`：exceljs 的写盘 API 本身就叫 `workbook.xlsx.
    // writeBuffer()`，不加前瞻会把 `wb.xlsx` 当成文件名（2026-09-09 本地实测确实抓成了
    // `wb.xlsx`）。产物名字抓错 = 上层"名字来自这一轮脚本"的断言测的是别的东西。
    const xlsxName = /([\w.\-\u3400-\u9fff]+\.xlsx)(?![\w.])/u.exec(script)?.[1];
    if (xlsxName) {
      const rows = [...script.matchAll(/addRow\(\s*\[\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!);
      return realSheet(rows.length > 0 ? rows : ["Loopback workbook"], xlsxName)
        .then((file) => ({ ...base, exitCode: 0, stdout: "WROTE_SHEET\n", files: [file] }));
    }

    // 从脚本里捞出 addText 的字面量当幻灯片文本，让产物内容与请求相关，
    // 而不是永远回同一个常量 deck（那样"内容与请求对应"这条断言就测不到东西）。
    const texts = [...script.matchAll(/addText\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!);
    // 文件名同理：脚本里写了 `xxx.pptx` 就用它。产物键 `agent-run-outputs/<runId>/<name>`
    // 里的 `<name>` 是不是真的来自这一轮的脚本，只有名字会变才测得出来。
    const named = /([\w.-]+\.pptx)/.exec(script);
    return realDeck(texts.length > 0 ? texts : ["Loopback deck"], named?.[1] ?? "deck.pptx")
      .then((file) => ({ ...base, exitCode: 0, stdout: "WROTE_DECK\n", files: [file] }));
  };
}

export interface LoopbackSandboxHandle {
  /** 实际监听端口（传 0 时由内核分配）。 */
  readonly port: number;
  /** `POST /run` 收到的**总次数**。T3「沙箱一次都不被调用」直接断言这个数。 */
  runCount(): number;
  close(): Promise<void>;
}

/** 起一台监听在 `127.0.0.1` 的 loopback 沙箱。`port === 0` ⇒ 由内核挑一个空闲端口。 */
export async function startLoopbackSkillSandbox(port: number): Promise<LoopbackSandboxHandle> {
  const respond = createLoopbackSandboxResponder();
  let runCount = 0;
  const server: Server = createServer((req, res) => {
    if (req.method === "GET" && (req.url ?? "").startsWith("/healthz")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, loopback: true }));
      return;
    }
    if (req.method !== "POST" || !(req.url ?? "").startsWith("/run")) {
      res.writeHead(404).end();
      return;
    }
    runCount += 1;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        try {
          const { script } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { script: string };
          const body = await respond(script);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        } catch (e) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : "loopback failure" }));
        }
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = (server.address() as AddressInfo).port;
  return {
    port: actual,
    runCount: () => runCount,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
