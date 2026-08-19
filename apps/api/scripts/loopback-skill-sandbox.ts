/**
 * 沙箱的 loopback 替身 —— 让门控在没有 docker 的环境里也能确定性地跑完
 * 「试跑 → 执行 → 产物」这条链（同 `loopback-model-provider.ts` 的纪律）。
 * design delta `skill-sandbox-execution`，F962 / #1583。
 *
 * ## ⚠ 它替身的是「执行」，**不是**「隔离」
 *
 * 这一点必须说死，否则它会变成一个假绿的来源：
 *
 * - 本替身**不提供任何隔离**。它按脚本内容返回预置结果，压根不执行代码。
 * - 因此 `verification.md` 的 **V2-a / V2-b 绝不能**用它跑 —— 那两条测的是
 *   真进程权限与真容器网络，只能在 `apps/skill-sandbox` 的真沙箱/真容器上跑
 *   （`tests/execute-script-isolation.test.ts`、`tests/container-network-isolation.test.ts`）。
 * - 它的用途只有一个：让**上层**（提交 → 轮询 → 回喂重试 → 产物落 ObjectStore）
 *   在不依赖真实模型与真实 docker 的前提下可确定性验证。
 *
 * ## 行为由脚本内容里的指令标记决定（确定性，不靠随机/计时）
 *
 * | 脚本里包含 | 行为 |
 * |---|---|
 * | `__LOOPBACK_FAIL_ONCE__` | 第 1 次非零退出并回一段真实形状的 stderr，第 2 次成功 —— V3 用 |
 * | `__LOOPBACK_ALWAYS_FAIL__` | 每次都非零退出 —— V4 的 `SCRIPT_FAILED_AFTER_RETRIES` 用 |
 * | `__LOOPBACK_TIMEOUT__` | 回 `timedOut: true` —— V4 的 `SANDBOX_TIMEOUT` 用 |
 * | `__LOOPBACK_EMPTY_FILE__` | 成功但回一个 0 字节文件 —— **V1-CP 反证用**，上层必须因此变红 |
 * | 其它 | 成功，回一个**真实合法**的最小 .pptx |
 *
 * ⚠ 「成功」那一档回的是**真的 OOXML**（用 pptxgenjs 在本进程内生成），不是一段假字节：
 *   否则上层的 V1 断言（解 zip、验 Content_Types、解 slideN.xml）会因为替身太假而红，
 *   于是有人就会去放宽 V1 —— 那正是本仓九次「全绿但空转」的成因。
 *   `SANDBOX_UNAVAILABLE` **不在**这张表里：那一档的正确造法是把地址指向一个没人监听的
 *   端口，而不是让替身"假装自己不可用"——后者测不到真实的连接失败路径。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.LOOPBACK_SKILL_SANDBOX_PORT ?? "8791");

/** 记住每个脚本被执行过几次，`__LOOPBACK_FAIL_ONCE__` 靠它区分第 1 次与第 2 次。 */
const attemptsBySignature = new Map<string, number>();

const REAL_STDERR_SHAPE =
  "TypeError: pres.ShapeType is not a function\n" +
  "    at Object.<anonymous> (/tmp/work/script.js:7:22)\n" +
  "    at Module._compile (node:internal/modules/cjs/loader:1546:14)";

interface SandboxFile {
  readonly name: string;
  readonly contentBase64: string;
  readonly sizeBytes: number;
}

/**
 * 生成一个真实合法的最小 .pptx。用 pptxgenjs 本体（`@repo/skill-sandbox` 的依赖），
 * 不手搓字节 —— 手搓的东西迟早与真实产物形态漂移，而 V1 断言的正是真实形态。
 */
async function realDeck(slideTexts: readonly string[]): Promise<SandboxFile> {
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
  return { name: "deck.pptx", contentBase64: out.toString("base64"), sizeBytes: out.length };
}

function respond(script: string): Promise<Record<string, unknown>> {
  const base = { stdout: "", stderr: "", files: [] as SandboxFile[], timedOut: false, durationMs: 12 };

  if (script.includes("__LOOPBACK_TIMEOUT__")) {
    return Promise.resolve({ ...base, exitCode: null, timedOut: true, durationMs: 30_000 });
  }
  if (script.includes("__LOOPBACK_ALWAYS_FAIL__")) {
    return Promise.resolve({ ...base, exitCode: 1, stderr: REAL_STDERR_SHAPE });
  }
  if (script.includes("__LOOPBACK_FAIL_ONCE__")) {
    const seen = (attemptsBySignature.get("fail_once") ?? 0) + 1;
    attemptsBySignature.set("fail_once", seen);
    if (seen === 1) return Promise.resolve({ ...base, exitCode: 1, stderr: REAL_STDERR_SHAPE });
  }
  if (script.includes("__LOOPBACK_EMPTY_FILE__")) {
    // V1-CP：成功退出但产物是 0 字节。上层的 OOXML 断言必须因此变红。
    return Promise.resolve({
      ...base,
      exitCode: 0,
      files: [{ name: "deck.pptx", contentBase64: "", sizeBytes: 0 }],
    });
  }

  // 从脚本里捞出 addText 的字面量当幻灯片文本，让产物内容与请求相关，
  // 而不是永远回同一个常量 deck（那样"内容与请求对应"这条断言就测不到东西）。
  const texts = [...script.matchAll(/addText\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!);
  return realDeck(texts.length > 0 ? texts : ["Loopback deck"]).then((file) => ({
    ...base,
    exitCode: 0,
    stdout: "WROTE_DECK\n",
    files: [file],
  }));
}

createServer((req, res) => {
  if (req.method === "GET" && (req.url ?? "").startsWith("/healthz")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, loopback: true }));
    return;
  }
  if (req.method !== "POST" || !(req.url ?? "").startsWith("/run")) {
    res.writeHead(404).end();
    return;
  }
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
}).listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`loopback-skill-sandbox listening on 127.0.0.1:${String(PORT)}\n`);
});
