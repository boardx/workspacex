/**
 * asr-stream-session.ts —— 实时 ASR 流的**编排逻辑**（#466 第二段）。
 *
 * 契约见 `phases/phase-01-run-a-project/design-deltas/realtime-asr/contract.md`
 * （人类 usamshen 2026-08-05 签核，commit `e6392322`）。
 *
 * ## 为什么编排单独成文件、不写在传输层里
 *
 * 传输层（ws 服务器、socket 生命周期、二进制帧）要真开端口才能测；而本文件要守的
 * 三条硬边界——授权、机密域 fail-closed、**落库只有一条路**——恰恰是最需要被反证
 * 逐条打过的东西。把它们留在传输层里，就只能靠 e2e 一次性验，反证打不到接缝上。
 *
 * 所以这里是纯函数式编排：所有外部能力（授权、数据域判定、上游 ASR、落库）都注入，
 * 测试直接构造。传输层只负责把帧搬进搬出。
 *
 * ## 落库只有一条路（contract.md §2）
 *
 * `asr.final` 由**本编排**调用既有 `ingestSegment` 用例，客户端不能自己写。
 * 幂等键 = `idempotencyKeyPrefix + 序号`，所以断线重连重放同一段不会写第二条。
 * 本文件**不新增任何读端口**——读回仍走既有 `readTranscriptStream`。
 */

/** 客户端 → 服务端。二进制音频帧在传输层被解成 `audio`。 */
export type ClientFrame =
  | { type: "asr.start"; trackId: string; idempotencyKeyPrefix: string }
  | { type: "audio"; pcm: Int16Array }
  | { type: "asr.commit" }
  | { type: "asr.finish" };

/** 服务端 → 客户端。 */
export type ServerFrame =
  | { type: "asr.partial"; text: string }
  | { type: "asr.final"; segmentId: string; text: string; lowConfidence: boolean }
  | { type: "asr.error"; reason: AsrErrorReason }
  | { type: "asr.finished" };

/**
 * 错误枚举。**没有「未知错误」这一项**（contract.md §1）——不认识的上游故障
 * 映射到 `ASR_PROVIDER_UNAVAILABLE` 并在服务端日志留原因，不向客户端编造语义。
 */
export type AsrErrorReason =
  | "NO_PROJECT_ROLE"
  | "SESSION_ENDED"
  | "CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR"
  | "ASR_NOT_CONFIGURED"
  | "AUDIO_FORMAT_REJECTED"
  | "ASR_PROVIDER_UNAVAILABLE";

export type Authorization = "ok" | "no-project-role" | "session-ended";
export type DataScope = "normal" | "confidential";

/** 上游返回的一段识别结果。`final: false` 是中间结果，**不落库**。 */
export interface UpstreamTranscript {
  text: string;
  final: boolean;
  confidence: number;
}

export interface UpstreamAsr {
  /** 送一帧音频，产出零到多段识别结果 */
  push: (pcm: Int16Array) => Promise<UpstreamTranscript[]>;
  /** 手动模式下切段 */
  commit: () => Promise<UpstreamTranscript[]>;
  close: () => Promise<void>;
}

export interface IngestSegmentInput {
  sessionId: string;
  trackId: string;
  rawText: string;
  asrConfidence: number;
  idempotencyKey: string;
}

export interface IngestSegmentResult {
  segmentId: string;
  lowConfidence: boolean;
  text: string;
}

export interface AsrStreamDeps {
  authorize: (sessionId: string) => Promise<Authorization>;
  dataScope: (sessionId: string) => Promise<DataScope>;
  /** `null` = 组织没有配置 ASR 提供方（见 #548：凭据入口尚无 controller） */
  openUpstream: null | (() => Promise<UpstreamAsr>);
  ingestSegment: (input: IngestSegmentInput) => Promise<IngestSegmentResult>;
  /** 上游异常的原始信息只进日志，不进客户端帧 */
  logUpstreamFailure?: (error: unknown) => void;
}

export interface AsrStreamSession {
  handle: (frame: ClientFrame) => Promise<ServerFrame[]>;
  close: () => Promise<void>;
}

/**
 * 建一条流。**在任何音频被接收之前**就把三道门走完，顺序即严重度：
 *   授权 → 机密域 → 提供方是否配置。
 * 任何一道不过就返回终止帧，**不建立上游连接**——不能让"反正连都连上了"变成
 * 绕过判定的理由。
 */
export async function openAsrStream(
  sessionId: string,
  deps: AsrStreamDeps,
): Promise<{ session: AsrStreamSession | null; rejection: ServerFrame | null }> {
  const auth = await deps.authorize(sessionId);
  if (auth === "no-project-role") return reject("NO_PROJECT_ROLE");
  if (auth === "session-ended") return reject("SESSION_ENDED");

  // 机密域：本面把音频送到**外部**提供方，所以这里 fail-closed 拒绝。
  // contract.md §4 明写「不提供任何『确认后继续』的绕行开关」——
  // 要放宽必须改 D-U1 本身，那是另一次签核。本文件里没有、也不该有这样的分支。
  if ((await deps.dataScope(sessionId)) === "confidential") {
    return reject("CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR");
  }

  // 未配置不是故障，是诚实降级：告诉界面「未配置转写」，
  // **不偷偷回退到别的提供方**（那会让"用哪个模型"变成不可见的事实）。
  if (!deps.openUpstream) return reject("ASR_NOT_CONFIGURED");

  let upstream: UpstreamAsr;
  try {
    upstream = await deps.openUpstream();
  } catch (error) {
    deps.logUpstreamFailure?.(error);
    return reject("ASR_PROVIDER_UNAVAILABLE");
  }

  let started: { trackId: string; prefix: string } | null = null;
  let seq = 0;
  let finished = false;

  async function persist(results: UpstreamTranscript[]): Promise<ServerFrame[]> {
    const frames: ServerFrame[] = [];
    for (const result of results) {
      if (!result.final) {
        frames.push({ type: "asr.partial", text: result.text });
        continue;
      }
      seq += 1;
      // 落库只有这一条路：调既有 ingestSegment 用例。幂等键由 prefix + 序号推出，
      // 断线重连重放同一段时命中同一个键，不会写第二条。
      const written = await deps.ingestSegment({
        sessionId,
        trackId: started!.trackId,
        rawText: result.text,
        asrConfidence: result.confidence,
        idempotencyKey: `${started!.prefix}-${seq}`,
      });
      frames.push({
        type: "asr.final",
        segmentId: written.segmentId,
        text: written.text,
        lowConfidence: written.lowConfidence,
      });
    }
    return frames;
  }

  const session: AsrStreamSession = {
    handle: async (frame) => {
      if (finished) return [{ type: "asr.error", reason: "SESSION_ENDED" }];

      if (frame.type === "asr.start") {
        started = { trackId: frame.trackId, prefix: frame.idempotencyKeyPrefix };
        return [];
      }
      // 第一帧必须是 asr.start：没有 trackId 与幂等前缀，落库就没有归属与去重依据。
      if (!started) return [{ type: "asr.error", reason: "AUDIO_FORMAT_REJECTED" }];

      try {
        if (frame.type === "audio") return await persist(await upstream.push(frame.pcm));
        if (frame.type === "asr.commit") return await persist(await upstream.commit());
        finished = true;
        await upstream.close();
        return [{ type: "asr.finished" }];
      } catch (error) {
        deps.logUpstreamFailure?.(error);
        return [{ type: "asr.error", reason: "ASR_PROVIDER_UNAVAILABLE" }];
      }
    },
    close: async () => {
      if (finished) return;
      finished = true;
      await upstream.close();
    },
  };

  return { session, rejection: null };
}

function reject(reason: AsrErrorReason): { session: null; rejection: ServerFrame } {
  return { session: null, rejection: { type: "asr.error", reason } };
}
