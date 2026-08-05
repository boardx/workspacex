/**
 * issue #466 —— 实时 ASR 提供方的端口（application 层，Nest-free）。
 *
 * 签核见 `phases/phase-01-run-a-project/design-deltas/realtime-asr/design-signoff.md`。
 *
 * ## 这个端口刻意很小
 *
 * 它只描述「推音频进去、拿文本出来」。**它不认识 `ingestSegment`，也不认识数据库** ——
 * 落库是 WS 面（`interface/ws/asr-stream.gateway.ts`）在收到 `final` 之后做的事，
 * 走 `interface/recording/segment-ingestion.ts` 那一条唯一写路径。
 * 如果这个端口自己会落库，就等于「谁写库」这件事在两处成立，
 * 而 contract.md §2 逐字禁止第二条写路径。
 *
 * ## 未配置不是「返回空」
 *
 * `open()` 在没有配置提供方时抛 `AsrNotConfiguredError`，由边界翻译成
 * `ASR_NOT_CONFIGURED` 并在界面上说人话。**不静默失败，也不偷偷回退到别的提供方**
 * （contract.md §3）。这与 `ConfiguredModelProvider` 的 `MODEL_PROVIDER_NOT_CONFIGURED`
 * 是同一条纪律：缺席的依赖必须以缺席的样子被看见。
 */

/** 上游认得的音频格式。契约 `recording.ASR_AUDIO_FORMAT` 是唯一事实源。 */
export interface AsrAudioFormat {
  readonly sampleRate: number;
  readonly channels: number;
  readonly encoding: string;
}

/**
 * 一段上游识别结果。
 *
 * ⚠ `confidence` 是**上游给的**，不是这里编的。上游不给时为 `null`，
 *   由 `TranscriptionPolicy` 决定「没有置信度算不算低置信度」——
 *   在这里填一个 `1.0` 等于替策略层做了一个没人签核过的决定。
 */
export interface AsrTranscript {
  readonly text: string;
  readonly confidence: number | null;
}

export interface AsrSessionHandlers {
  /** 中间结果。**不落库**（contract.md §1）。 */
  readonly onPartial: (transcript: AsrTranscript) => void;
  /** 最终结果。由调用方落库后才回给浏览器。 */
  readonly onFinal: (transcript: AsrTranscript) => void;
  /**
   * 上游故障。`reason` 只允许是契约 `AsrStreamErrorReason` 的成员；
   * 不认识的上游故障由适配器映射成 `ASR_PROVIDER_UNAVAILABLE`，
   * **不向上编造新语义**（契约里没有 `UNKNOWN` 这一项，是刻意的）。
   */
  readonly onError: (reason: string, detail: string) => void;
  /** 上游正常收尾。 */
  readonly onClosed: () => void;
}

export interface AsrSession {
  /** 推一帧 PCM16 上去。 */
  pushAudio(frame: Uint8Array): void;
  /** 手动切段。 */
  commit(): void;
  /** 正常收尾：冲掉缓冲、等最后一段 final、关连接。 */
  finish(): Promise<void>;
  /** 异常收尾：立刻断开，不等任何结果。 */
  abort(): void;
}

export interface AsrProviderPort {
  /** 提供方是否已配置。未配置时 `open()` 会抛，界面据此显示「未配置转写」。 */
  isConfigured(): boolean;
  open(handlers: AsrSessionHandlers, audio: AsrAudioFormat): Promise<AsrSession>;
}

export class AsrNotConfiguredError extends Error {
  /**
   * 缺了哪几个配置项。**独立字段，不是 `message`** —— `lint-error-leak.mjs` 对
   * 接口层读 `err.message` 一律判泄漏，而那条门是对的：`message` 在这个仓里
   * 惯常带着 SQL 片段与表名，边界层没法逐个甄别哪一个「其实是安全的」。
   * 所以安全可外传的部分在这里有自己的名字，边界层读它，不读 `message`。
   */
  readonly configHint: string;

  constructor(configHint: string) {
    super(`asr_not_configured: ${configHint}`);
    this.name = "AsrNotConfiguredError";
    this.configHint = configHint;
  }
}

export const ASR_PROVIDER = Symbol("ASR_PROVIDER");
