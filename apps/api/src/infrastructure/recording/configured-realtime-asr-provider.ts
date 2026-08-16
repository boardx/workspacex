/**
 * issue #466 —— 唯一的 ASR 适配器：一条到「realtime 转写」上游的 WebSocket。
 *
 * ## 为什么只有一个适配器，而不是「阿里云一个 + 测试一个」
 *
 * 本仓的红线是「不许静默 mock fallback」。#435 的 `ConfiguredModelProvider` 已经
 * 给出过这个问题的答案，本文件逐条照抄那套结构性保证：
 *
 *   · **必须被显式选中。** 只认 `KERNEL_ASR_PROVIDER` 这一个名字，没有 list、
 *     没有 map、没有 "default"，因此**不存在**「悄悄退回到某个提供方」的路径。
 *   · **产品代码里只有这一个 `AsrProviderPort` 实现。** 被测的是**真实适配器**
 *     走**真实 WebSocket**，只是 e2e 里上游换成一个输出可预测的进程
 *     （`apps/api/scripts/loopback-asr-provider.ts`）。
 *   · **它缺席时没人兜底。** 不配置 ⇒ `AsrNotConfiguredError` ⇒ 浏览器收到
 *     `ASR_NOT_CONFIGURED` 并显示「未配置转写」，绝不会冒出一段编造的转录。
 *
 * ## 协议
 *
 * DashScope Qwen Realtime 的 OpenAI-compatible 形状（`input_audio_buffer.append` / `.commit` 上行，
 * `conversation.item.input_audio_transcription.text` / `.completed` 下行）——
 * 这正是人类 2026-08-05 指定的 `qwen3-asr-flash-realtime` 所暴露的形状
 * （`wss://…/api-ws/v1/realtime`，另需 `OpenAI-Beta: realtime=v1`）。
 * 选它而不是自创一套，是为了让「指向阿里云」是一次**配置变更**而不是一次改代码。
 *
 * ⚠ **模型名不在本文件里**（contract.md §3，`no-hardcoded-model-list.test.ts` 是活门控）。
 *   它从 `KERNEL_ASR_MODEL` 来。
 * ⚠ **API key 永不下发浏览器**，也不出现在任何响应体或日志里 —— 这正是这条面
 *   必须是服务端代理的全部理由。
 *
 * ## 2026-08-09 hotfix（#802）—— 上面这段协议描述曾经只是"应该长这样"的假设，
 * 从未拿真实的 `qwen3-asr-flash-realtime` 端点验证过，实际形状有三处不一样：
 *
 *   1. **模型必须在连接时以 `?model=` 查询参数传入**，不能只靠连接后的
 *      `session.update` 设置——不带它时 dashscope 用一个这个账号没有权限的默认
 *      模型初始化会话，连接会在处理任何客户端消息之前就被 `1007 Model not found`
 *      关闭。
 *   2. 消息类型是 **`session.update`**，不是 `transcription_session.update`
 *      （发错类型会被 `error` 帧原样拒绝，`type` 字段不认得这个值）。
 *   3. `input_audio_format` 只认字面量 **`"pcm"`**——`AsrAudioFormat.encoding`
 *      （`"pcm16le"`）描述的是我们自己线路上的字节格式，不是这个上游字段的取值
 *      词表，两者刻意不共享同一个字符串。采样率字段名是顶层 `sample_rate`，
 *      不是 `input_audio_sample_rate`。
 *
 * 这条 bug 完全静默了 7 天以上没有任何日志——见 `onClosed` 的说明。
 */
import { WebSocket } from "ws";
import {
  AsrNotConfiguredError,
  type AsrAudioFormat,
  type AsrProviderPort,
  type AsrSession,
  type AsrSessionHandlers,
} from "../../application/recording/asr-ports";

const DEFAULT_ASR_TURN_SILENCE_MS = 400;

interface ProviderConfig {
  readonly provider: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /**
   * PROP-CHAT-ASR-LATENCY-001（人类实测反馈：转录延迟大）——`session.update` 里的
   * `turn_detection.silence_duration_ms`（静音多久判一句话结束）。环境变量未配置时
   * 默认 400ms；有效正整数可覆盖。显式 null 只保留给内部测试/故障排查，表示不发送。
   */
  readonly turnDetectionSilenceMs?: number | null;
}

export function resolveTurnDetectionSilenceMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_ASR_TURN_SILENCE_MS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_ASR_TURN_SILENCE_MS;
}

/**
 * 组装期读一次，之后不再读 —— 与 `ConfiguredModelProvider` 同一个做法：
 * 运行中途改环境变量不该悄悄改变一台已经在跑的进程的行为。
 */
function readConfig(): ProviderConfig | null {
  const provider = process.env.KERNEL_ASR_PROVIDER;
  const baseUrl = process.env.KERNEL_ASR_BASE_URL;
  const apiKey = process.env.KERNEL_ASR_API_KEY;
  const model = process.env.KERNEL_ASR_MODEL;
  if (!provider || !baseUrl || !apiKey || !model) return null;
  const silenceRaw = process.env.KERNEL_ASR_TURN_SILENCE_MS;
  // 非法值回退安全默认值并留日志，不让一个 typo 把整条 ASR 面拖垮。
  if (silenceRaw !== undefined && silenceRaw.trim() !== "") {
    const parsed = Number(silenceRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.warn(`[asr] KERNEL_ASR_TURN_SILENCE_MS=${JSON.stringify(silenceRaw)} 不是正整数，使用默认值 ${DEFAULT_ASR_TURN_SILENCE_MS}ms`);
    }
  }
  const turnDetectionSilenceMs = resolveTurnDetectionSilenceMs(silenceRaw);
  return { provider, baseUrl, apiKey, model, turnDetectionSilenceMs };
}

/**
 * 上游故障 → 契约 `AsrStreamErrorReason` 的映射。
 *
 * ⚠ 契约里**没有** `UNKNOWN`。不认识的故障一律 `ASR_PROVIDER_UNAVAILABLE`，
 *   原因留在服务端日志。这不是偷懒，是拒绝给客户端编一个它无法处理的语义。
 */
const PROVIDER_UNAVAILABLE = "ASR_PROVIDER_UNAVAILABLE";
const AUDIO_FORMAT_REJECTED = "AUDIO_FORMAT_REJECTED";

type ParsedTranscriptEvent =
  | { readonly kind: "partial"; readonly text: string; readonly confidence: null }
  | { readonly kind: "final"; readonly text: string; readonly confidence: number | null };

/**
 * DashScope Qwen ASR 的高频中间结果不是 OpenAI 风格的 `delta`，而是一个当前句子的
 * 完整快照：`text` 是已确认前缀，`stash` 是仍可能修订的尾部。BoardX 的 interim
 * 协议同样是“替换当前临时段”，因此这里必须拼成快照后发送，不能把两者当增量追加。
 */
export function parseDashscopeTranscriptEvent(event: unknown): ParsedTranscriptEvent | null {
  if (typeof event !== "object" || event === null) return null;
  const frame = event as {
    type?: unknown;
    text?: unknown;
    stash?: unknown;
    transcript?: unknown;
    confidence?: unknown;
  };
  if (frame.type === "conversation.item.input_audio_transcription.text") {
    const text = typeof frame.text === "string" ? frame.text : "";
    const stash = typeof frame.stash === "string" ? frame.stash : "";
    return { kind: "partial", text: `${text}${stash}`, confidence: null };
  }
  if (frame.type === "conversation.item.input_audio_transcription.completed") {
    return {
      kind: "final",
      text: typeof frame.transcript === "string" ? frame.transcript : "",
      confidence: typeof frame.confidence === "number" ? frame.confidence : null,
    };
  }
  return null;
}

export class ConfiguredRealtimeAsrProvider implements AsrProviderPort {
  private readonly config: ProviderConfig | null;

  constructor(config: ProviderConfig | null = readConfig()) {
    this.config = config !== null && config.turnDetectionSilenceMs === undefined
      ? { ...config, turnDetectionSilenceMs: DEFAULT_ASR_TURN_SILENCE_MS }
      : config;
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  async open(handlers: AsrSessionHandlers, audio: AsrAudioFormat): Promise<AsrSession> {
    const config = this.config;
    if (config === null) {
      throw new AsrNotConfiguredError(
        "KERNEL_ASR_PROVIDER / KERNEL_ASR_BASE_URL / KERNEL_ASR_API_KEY / KERNEL_ASR_MODEL",
      );
    }

    // #802 —— 模型必须在连接时就以查询参数传入：dashscope 在收到任何客户端消息之前，
    // 就已经用这个参数（缺省时用一个这个账号未必有权限的默认模型）初始化了会话，
    // 之后再用 `session.update` 改模型已经太晚——连接可能已经因为默认模型不可用被关闭。
    const url = `${config.baseUrl}?model=${encodeURIComponent(config.model)}`;
    const socket = new WebSocket(url, {
      headers: {
        // 上游的鉴权。**这一行就是这条面必须是服务端代理的全部理由**：
        // 浏览器直连等于把它发给每一个访客。
        Authorization: `bearer ${config.apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve(); };
      const onError = (e: Error) => { cleanup(); reject(e); };
      const cleanup = () => {
        socket.off("open", onOpen);
        socket.off("error", onError);
      };
      socket.on("open", onOpen);
      socket.on("error", onError);
    });

    // #802 —— 会话参数确认：模型已经在连接 URL 里定了（见上），这里只是把音频格式
    // 告诉上游。上游不接受这个格式时它回 `error`，我们把它映射成
    // `AUDIO_FORMAT_REJECTED` —— 那是契约里有的码，界面能说人话。
    // `audio.encoding`（`"pcm16le"`）是我们自己线路上的字节格式描述符，不是
    // `input_audio_format` 的取值词表——这个字段只认字面量 `"pcm"`，字段名也是顶层
    // `sample_rate`，不是 `input_audio_sample_rate`（均已用真实端点验证，见本文件头注）。
    socket.send(JSON.stringify({
      type: "session.update",
      session: {
        input_audio_format: "pcm",
        sample_rate: audio.sampleRate,
        input_audio_transcription: { model: config.model },
        // PROP-CHAT-ASR-LATENCY-001 —— devapp 已验证该字段可用；未配置环境变量时使用
        // 400ms 默认值，避免回退到上游更慢的默认断句。显式 null 仅用于内部排障。
        ...(config.turnDetectionSilenceMs != null
          ? {
              turn_detection: {
                type: "server_vad",
                silence_duration_ms: config.turnDetectionSilenceMs,
              },
            }
          : {}),
      },
    }));

    let closed = false;
    let finalSeen = false;
    let finishResolve: (() => void) | null = null;
    // #802 —— the actual root cause the wrong protocol fields could hide behind for 7+
    // days undetected: `finish()`/`abort()` are the only CALLER-INITIATED ways this
    // socket is expected to close. Any other close (upstream rejected the model, upstream
    // crashed, network dropped) must be reported as a failure -- silently treating it the
    // same as a clean finish is exactly how a broken upstream protocol produced zero error
    // frames, zero log lines, and a composer stuck at "listening" forever until the user
    // gave up and clicked stop, at which point `finish()` no-ops on an already-closed
    // socket and the gateway happily sends `asr.finished` for a session that transcribed
    // nothing. `errorReported` avoids double-reporting when an explicit `error` frame (or
    // the `ws` `error` event) already told the caller why, right before the `close` event
    // that always follows it.
    let finishRequested = false;
    let errorReported = false;
    const reportError = (reason: typeof PROVIDER_UNAVAILABLE | typeof AUDIO_FORMAT_REJECTED, detail: string): void => {
      errorReported = true;
      handlers.onError(reason, detail);
    };

    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let event: { type?: unknown; error?: unknown };
      try {
        event = JSON.parse(String(raw)) as typeof event;
      } catch {
        reportError(PROVIDER_UNAVAILABLE, "upstream sent a frame that is not JSON");
        return;
      }
      const type = typeof event.type === "string" ? event.type : "";
      const transcript = parseDashscopeTranscriptEvent(event);
      if (transcript?.kind === "partial") {
        handlers.onPartial({ text: transcript.text, confidence: transcript.confidence });
        return;
      }
      if (transcript?.kind === "final") {
        finalSeen = true;
        handlers.onFinal({
          text: transcript.text,
          confidence: transcript.confidence,
        });
        if (finishResolve) { const r = finishResolve; finishResolve = null; r(); }
        return;
      }
      if (type === "error") {
        const message = JSON.stringify(event.error ?? {});
        const reason = /format|sample.?rate|encoding/i.test(message)
          ? AUDIO_FORMAT_REJECTED
          : PROVIDER_UNAVAILABLE;
        reportError(reason, message);
      }
    });

    socket.on("close", (code: number, reasonBuf: Buffer) => {
      closed = true;
      if (finishResolve) { const r = finishResolve; finishResolve = null; r(); }
      if (!finishRequested && !errorReported) {
        reportError(PROVIDER_UNAVAILABLE, `upstream closed unexpectedly (code=${code}): ${reasonBuf.toString() || "no reason given"}`);
      }
      handlers.onClosed();
    });
    socket.on("error", (e: Error) => {
      if (closed) return;
      reportError(PROVIDER_UNAVAILABLE, e.message);
    });

    return {
      pushAudio(frame) {
        if (closed || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: Buffer.from(frame).toString("base64"),
        }));
      },
      commit() {
        if (closed || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      },
      async finish() {
        finishRequested = true;
        if (closed || socket.readyState !== WebSocket.OPEN) return;
        finalSeen = false;
        socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        // 等最后一段 final 回来再关。直接关会丢掉用户说的最后一句话，
        // 而那种丢失在界面上长得像「录音没生效」。
        await new Promise<void>((resolve) => {
          finishResolve = resolve;
          setTimeout(() => {
            if (finishResolve) { finishResolve = null; resolve(); }
          }, FINISH_GRACE_MS);
        });
        if (!finalSeen && !closed) {
          reportError(PROVIDER_UNAVAILABLE, "upstream did not settle the final segment in time");
        }
        socket.close();
      },
      abort() {
        finishRequested = true;
        closed = true;
        socket.terminate();
      },
    };
  }
}

/**
 * 收尾等待上限。超过它就把「上游没在时限内给出最终结果」如实报出来，
 * **不是**当成「用户什么都没说」。
 */
const FINISH_GRACE_MS = Number(process.env.KERNEL_ASR_FINISH_GRACE_MS ?? 15_000);
