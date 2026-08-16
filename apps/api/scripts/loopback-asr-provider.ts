#!/usr/bin/env node
/**
 * #466 —— 全栈冒烟用的**确定性实时 ASR 上游**（OpenAI realtime 形状的 WS）。
 *
 * ## 这不是 mock fallback，区别很具体（与 `loopback-model-provider.ts` 逐条同型）
 *
 *   · 它必须被**显式选中**才会被用到。`ConfiguredRealtimeAsrProvider` 只认
 *     `KERNEL_ASR_PROVIDER` / `KERNEL_ASR_BASE_URL` 这一组配置，没有 list、没有 map、
 *     没有 "default"，因此**不存在**「悄悄退回到它」的路径。
 *   · 它不在产品代码里。`apps/api/src` 里仍然只有 `ConfiguredRealtimeAsrProvider`
 *     一个 `AsrProviderPort` 实现；被测的是**真实适配器**走**真实 WebSocket**，
 *     只是上游换成一个我们能预测其输出的服务器。
 *   · 它缺席时不会有人替它兜底。不起这个进程，WS 面以 `ASR_PROVIDER_UNAVAILABLE`
 *     诚实地失败；不配置它，以 `ASR_NOT_CONFIGURED` 诚实地失败。
 *     两种情况都**不会**冒出一段编造的转录。
 *
 * ## 为什么要回显「收到了多少字节音频」
 *
 * 转录文本里带上真实收到的 PCM 字节数，是**音频真的从浏览器流过来了**的证据。
 * 少了它，断言就只能判「有一条转录」，而那种断言在「前端自己合成了一段文字」
 * 的时候照样绿 —— 那正是本仓最忌讳的假绿。
 *
 * ⚠ 断言方拿的是 `LOOPBACK_ASR_TRANSCRIPT_PREFIX`，唯一事实源在
 *   `apps/web/e2e/fullstack-smoke-fixture.ts`，由 playwright config 同时下发给
 *   本进程与断言方。两头各写一份字面量的下场很具体：改了一头没改另一头，
 *   断言会**恒红**，而且红得像是「转录没落库」。
 *
 * ## #728 P8 —— `LOOPBACK_ASR_EMIT_DELTA`：新增能力，默认关闭
 *
 * `chat-read` 取证需要证明「转录过程中用户能看到实时文字更新」
 * （`chat-ux-acceptance-criteria.md` 第 5 项逐字要求「不是录完一段才整体填入」）。
 * 此前本进程只在 `input_audio_buffer.commit` 时回一次完整 `.completed`，没有任何
 * 官方 Qwen `.text` 快照事件——`ConfiguredRealtimeAsrProvider` 把
 * `conversation.item.input_audio_transcription.text` 的 `text + stash` 转成
 * `asr.partial` 转发给浏览器，前端把它作为当前 interim 替换显示。
 *
 * 这条能力**默认关闭**（`LOOPBACK_ASR_EMIT_DELTA` 未设或非 `"1"` 时行为与改动前
 * 逐字相同）——`fullstack-smoke.config.ts` 没有下发这个变量，它的
 * `core-loop.spec.ts` 步骤 7 断言「转录出现在 commit 之后」和「partial 在收尾后
 * 清空」两条都完全不受影响。只有 `chat-read` 这个 config 会显式打开它。是新增
 * 事件类型，不是改已有 completed 事件的形状，向后兼容。
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.LOOPBACK_ASR_PROVIDER_PORT ?? "");
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("LOOPBACK_ASR_PROVIDER_PORT must be a positive integer");
}
const TRANSCRIPT_PREFIX = process.env.LOOPBACK_ASR_TRANSCRIPT_PREFIX;
if (!TRANSCRIPT_PREFIX) throw new Error("LOOPBACK_ASR_TRANSCRIPT_PREFIX is required");
const EMIT_DELTA = process.env.LOOPBACK_ASR_EMIT_DELTA === "1";

const server = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  // #802 hotfix -- this loopback used to accept `transcription_session.update` and never
  // checked `?model=`, matching the SAME wrong assumptions `ConfiguredRealtimeAsrProvider`
  // had at the time -- so this smoke test stayed green while the real dashscope endpoint
  // rejected the exact same frames. Mirroring the real protocol here (verified directly
  // against the real endpoint, see that file's own header) is what makes this loopback
  // able to catch a protocol-shape regression instead of only proving "the adapter talks
  // to *a* WebSocket server", which it always did.
  const model = new URL(req.url ?? "", "http://loopback").searchParams.get("model");
  if (!model) {
    ws.send(JSON.stringify({ type: "error", error: { message: "missing required ?model= query param" } }));
    ws.close();
    return;
  }
  let bytes = 0;
  let sessionReady = false;

  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    // 适配器把音频 base64 进 JSON 帧（OpenAI realtime 的 `input_audio_buffer.append`），
    // 所以这里不该收到二进制帧。收到了就说明适配器的编码变了，如实报错而不是无视。
    if (isBinary) {
      ws.send(JSON.stringify({ type: "error", error: { message: "binary frame not expected" } }));
      return;
    }
    let event: { type?: string; audio?: string; session?: unknown };
    try {
      event = JSON.parse(String(raw)) as typeof event;
    } catch {
      ws.send(JSON.stringify({ type: "error", error: { message: "not json" } }));
      return;
    }

    if (event.type === "session.update") {
      sessionReady = true;
      ws.send(JSON.stringify({ type: "session.updated" }));
      return;
    }
    if (event.type === "input_audio_buffer.append") {
      if (!sessionReady) {
        ws.send(JSON.stringify({ type: "error", error: { message: "audio before session update" } }));
        return;
      }
      const chunkBytes = Buffer.from(String(event.audio ?? ""), "base64").byteLength;
      bytes += chunkBytes;
      // 每收到一块真实音频就回一次官方 Qwen `text` 快照，让「转录过程中文字在实时
      // 更新」这件事变得可截图（不是等 commit 才一次性回）。同样带上真实累计字节数，
      // 保持「回显收到了多少字节」这条反假绿纪律——`.completed` 那句的同一理由。
      if (EMIT_DELTA && chunkBytes > 0) {
        ws.send(JSON.stringify({
          type: "conversation.item.input_audio_transcription.text",
          text: `${TRANSCRIPT_PREFIX} ${bytes}`,
          stash: "…",
        }));
      }
      return;
    }
    if (event.type === "input_audio_buffer.commit") {
      // 一个字节都没收到 ⇒ **不编一段转录**。回一个空的 completed，
      // 由适配器/网关决定怎么处理。捏一段假文本出来正是这个进程绝不做的事。
      ws.send(JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: bytes === 0 ? "" : `${TRANSCRIPT_PREFIX} ${bytes}`,
        confidence: 0.97,
      }));
      bytes = 0;
      return;
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`loopback asr provider listening on ${port}\n`);
});
