/**
 * live-recording.ts —— 浏览器真实采音（#466 步骤 7 的第一段）。
 *
 * 设计签核见 `phases/phase-01-run-a-project/design-deltas/realtime-asr/`
 * （人类 usamshen 于 2026-08-05 签核，commit `e6392322`）。
 *
 * ## 本文件只做采音，不做上传
 *
 * 转写走服务端代理的 WS 面（`WS /recording/sessions/:sessionId/asr-stream`），
 * 原因写在 contract.md：阿里云实时 ASR 的鉴权是 `Authorization: bearer {API_KEY}`，
 * **浏览器直连等于把 key 发给每一个访客**。所以这里产出的是标准化后的音频帧，
 * 由调用方交给那条 WS —— 本文件**不认识任何上游端点**，也不该认识。
 *
 * ## 为什么是 PCM16 / 16000Hz / 单声道
 *
 * 上游要求（contract.md §1）。`MediaRecorder` 给的是容器封装（webm/opus），
 * 不是裸 PCM，所以采音走 `AudioContext` + `ScriptProcessor`/`AudioWorklet` 取
 * Float32 采样，再自己降采样并量化成 16 位小端整数。
 *
 * ## 三种真实失败态必须可见（contract.md §5）
 *
 * 权限被拒 / 无麦克风设备 / 采音管线起不来 —— 各自有**具名**状态，
 * 调用方能据此渲染人话。**没有"未知错误"这个兜底项**：不认识的异常
 * 归到 `capture-failed` 并保留原始 message 供日志，但绝不静默。
 */

/** 上游要求的目标采样率（contract.md §1）。 */
export const TARGET_SAMPLE_RATE = 16_000;

export type RecordingFailure =
  /** 用户点了「拒绝」，或浏览器策略禁止 */
  | "permission-denied"
  /** 机器上没有可用的音频输入设备 */
  | "no-microphone"
  /** 拿到了流但采音管线没起来 */
  | "capture-failed";

export interface RecordingError {
  kind: RecordingFailure;
  /** 给人看的中文说明；调用方直接渲染，不需要再翻译一次 */
  message: string;
  /** 原始错误名，仅供日志；不进界面 */
  cause?: string;
}

export class LiveRecordingError extends Error {
  readonly kind: RecordingFailure;
  readonly cause?: string;
  constructor(detail: RecordingError) {
    super(detail.message);
    this.name = "LiveRecordingError";
    this.kind = detail.kind;
    this.cause = detail.cause;
  }
}

/**
 * 把 `getUserMedia` 抛出的 DOMException 映射成本模块的具名失败态。
 *
 * 浏览器之间名字不完全一致，所以按**名字**判定而不是按 message 文本 ——
 * message 是本地化的，拿它做判据等于把判定绑在语言设置上。
 */
export function classifyMediaError(error: unknown): RecordingError {
  const name = typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return {
      kind: "permission-denied",
      message: "麦克风权限被拒绝。请在浏览器地址栏的权限设置里允许本站使用麦克风后重试。",
      cause: name,
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return {
      kind: "no-microphone",
      message: "没有找到可用的麦克风设备。请接入麦克风或在系统声音设置里选择输入设备后重试。",
      cause: name,
    };
  }
  return {
    kind: "capture-failed",
    message: "麦克风已授权，但采音没有启动成功。请刷新页面重试；若持续出现请联系管理员。",
    cause: name || (error instanceof Error ? error.name : "unknown"),
  };
}

/**
 * 线性降采样 + 量化成 PCM16 小端。
 *
 * 刻意不做抗混叠滤波：上游是语音识别不是母带，且引入滤波会带来一份需要单独验证的
 * 信号处理代码。若日后识别质量证明需要，那是一次有依据的改动，不是现在拍脑袋加。
 */
export function toPcm16(samples: Float32Array, sourceRate: number, targetRate = TARGET_SAMPLE_RATE): Int16Array {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) {
    throw new LiveRecordingError({
      kind: "capture-failed",
      message: "采音设备没有报告有效的采样率，无法转码。",
      cause: `sourceRate=${sourceRate}`,
    });
  }
  const ratio = sourceRate / targetRate;
  const length = ratio <= 1 ? samples.length : Math.floor(samples.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const sample = samples[Math.min(samples.length - 1, Math.floor(i * ratio))] ?? 0;
    // 先夹到 [-1, 1] 再量化：超出范围的采样直接乘会绕回成反相的巨响
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

export interface CaptureHandle {
  /** 目标采样率下的裸 PCM16 帧；调用方转手交给 WS 面 */
  onFrame: (listener: (frame: Int16Array) => void) => void;
  stop: () => Promise<void>;
  readonly sourceSampleRate: number;
}

interface CaptureDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: () => AudioContext;
}

/**
 * 起一路真实采音。失败一律抛 `LiveRecordingError`，**绝不返回一个"看起来在录"的句柄**
 * —— 假装在录是这类功能最坏的失败方式。
 */
export async function startCapture(deps: CaptureDeps = {}): Promise<CaptureHandle> {
  const getUserMedia = deps.getUserMedia
    ?? ((constraints: MediaStreamConstraints) => {
      const media = globalThis.navigator?.mediaDevices;
      if (!media?.getUserMedia) {
        throw new LiveRecordingError({
          kind: "capture-failed",
          message: "当前浏览器不支持麦克风采音（navigator.mediaDevices 不可用）。",
          cause: "mediaDevices-unavailable",
        });
      }
      return media.getUserMedia(constraints);
    });

  let stream: MediaStream;
  try {
    stream = await getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    if (error instanceof LiveRecordingError) throw error;
    throw new LiveRecordingError(classifyMediaError(error));
  }

  // 拿到流但里面没有音轨 —— 少见但真实（虚拟设备/被系统静音的设备）
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new LiveRecordingError({
      kind: "no-microphone",
      message: "已获得权限，但设备没有提供任何音频轨道。请检查系统的输入设备设置。",
      cause: "no-audio-track",
    });
  }

  let context: AudioContext;
  try {
    context = deps.createAudioContext?.() ?? new AudioContext();
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop());
    throw new LiveRecordingError(classifyMediaError(error));
  }

  const listeners: Array<(frame: Int16Array) => void> = [];
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const frame = toPcm16(input, context.sampleRate);
    for (const listener of listeners) listener(frame);
  };
  source.connect(processor);
  processor.connect(context.destination);

  return {
    sourceSampleRate: context.sampleRate,
    onFrame: (listener) => { listeners.push(listener); },
    stop: async () => {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await context.close();
    },
  };
}
