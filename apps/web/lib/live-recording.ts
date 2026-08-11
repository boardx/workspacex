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

/**
 * ⚠ 刻意**不叫** `RecordingError`：契约 `packages/contracts/src/recording.ts:104`
 *   已经有一个同名的**错误码枚举**（`z.enum([...])`）。两者是不同的东西 ——
 *   那个是「服务端回哪个码」，这个是「界面上显示什么」——
 *   但重名会被 `lint-contract-source` 判成「前端重定义契约类型」（V10），
 *   而那条门是对的：同名不同义比同名同义更容易骗到人。
 */
export interface LiveRecordingErrorDetail {
  kind: RecordingFailure;
  /** 给人看的中文说明；调用方直接渲染，不需要再翻译一次 */
  message: string;
  /** 原始错误名，仅供日志；不进界面 */
  cause?: string;
}

export class LiveRecordingError extends Error {
  readonly kind: RecordingFailure;
  readonly cause?: string;
  constructor(detail: LiveRecordingErrorDetail) {
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
export function classifyMediaError(error: unknown): LiveRecordingErrorDetail {
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
  /**
   * 指定输入设备（麦克风）的 `deviceId`（contract.md §7.1）。
   *
   * 非空时给 `getUserMedia` 加 `audio.deviceId: { exact }`；**为空/未传时行为与
   * 未接本增补前逐字相同**（系统默认设备）——这是会话录音路径不受影响的保证。
   * 用 `exact` 而非软偏好：用户选了某设备却被浏览器悄悄换成默认，比"设备不可用直接
   * 报错"更坏，后者由既有 `no-microphone` / `capture-failed` 具名失败态兜住。
   */
  deviceId?: string;
}

/** 一个可选作输入源的麦克风设备（contract.md §7.1）。 */
export interface AudioInputDevice {
  readonly deviceId: string;
  /**
   * 设备名。**只有在已授权麦克风后才可读**（浏览器隐私约束）；未授权时为空串。
   * 空串是**真实状态**，调用方据此显示占位，绝不编造设备名。
   */
  readonly label: string;
}

/**
 * 列出可用的音频输入设备（contract.md §7.1）。
 *
 * 只读:**不**主动申请麦克风权限——拿设备名要授权，但"用户还没点录音就弹权限"
 * 是更糟的体验。因此未授权时这里如实返回 label 为空串的设备，UI 显示占位；
 * 真正的授权发生在用户点开始录音那一刻（`startCapture` → `getUserMedia`），
 * 之后 `devicechange` 会带着可读的 label 再刷一次。
 *
 * `navigator.mediaDevices` 不可用（老浏览器/非安全上下文）时返回空数组，
 * 不抛异常——列不出设备不是错误态，是"这台机器/这个环境没有可选设备"。
 */
export async function enumerateInputDevices(
  deps: { enumerateDevices?: () => Promise<MediaDeviceInfo[]> } = {},
): Promise<AudioInputDevice[]> {
  const enumerate = deps.enumerateDevices
    ?? (globalThis.navigator?.mediaDevices?.enumerateDevices
      ? () => globalThis.navigator.mediaDevices.enumerateDevices()
      : null);
  if (enumerate === null) return [];
  let devices: MediaDeviceInfo[];
  try {
    devices = await enumerate();
  } catch {
    return [];
  }
  return devices
    .filter((device) => device.kind === "audioinput")
    // deviceId 为空串的项（某些浏览器未授权时会给一条占位）不作为可选项——
    // 它无法被 `deviceId: { exact }` 定位，选了也没用。
    .filter((device) => device.deviceId !== "")
    .map((device) => ({ deviceId: device.deviceId, label: device.label }));
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

  // deviceId 非空 → 精确锁定该设备（§7.1）；空/未传 → 不加此约束，走系统默认，
  // 与接本增补前逐字相同。
  const audio: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true };
  if (deps.deviceId !== undefined && deps.deviceId !== "") {
    audio.deviceId = { exact: deps.deviceId };
  }

  let stream: MediaStream;
  try {
    stream = await getUserMedia({ audio });
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
