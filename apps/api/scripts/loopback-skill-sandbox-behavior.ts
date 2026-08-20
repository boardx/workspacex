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
 * | 其它 | 成功，回一个**真实合法**的最小 .pptx（pptxgenjs 本体生成，不是假字节） |
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
