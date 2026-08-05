/**
 * issue #466 —— 转写段落库的**唯一一条路**。
 *
 * ## 为什么这个文件存在
 *
 * 签核过的 delta（`design-deltas/realtime-asr/contract.md` §2）逐字要求：
 *
 *   > `asr.final` 由**服务端**调用既有 `ingestSegment` 用例落库。
 *   > **不新增第二条写路径。**
 *
 * 在这个文件之前，「调 `ingestSegment` 用例」这件事只在 `recording.controller.ts`
 * 里存在一次，而它周围裹着一层**不属于用例、但每次都必须做**的东西：
 * 幂等查表、项目角色、租户事务、转写策略。WS 面要落库，就必须重做这一层 ——
 * 抄一份等于把「怎么落库」声明在两处，正是 `AGENTS.md` 点名、本仓已漂移五次的形状。
 *
 * 所以这一层被抽成了一个**函数**（不是 Nest 的 `@Injectable`）：
 * `application/` 与 `domain/` 在本仓是 Nest-free 的（实测：`@nestjs` 在这两层零命中），
 * 而这一层要拿 `RECORDING_UNIT_OF_WORK` 这类由组合根注入的东西，
 * 于是它落在 `interface/`，由调用方把已经注入好的端口传进来。
 * HTTP 与 WS 两个边界各自把协议翻译干净，然后调**同一个函数**。
 *
 * ⚠ 反证义务（红线 2）落在这里：把 `ingest.persist` 掏空（保留返回值）应当让
 *   e2e 步骤 7 的「刷新后仍在」变红，而在那之前的每一步仍绿。做不到就说明
 *   那条断言吃的是 React state，不是 PostgreSQL。
 */
import { createHash } from "node:crypto";
import { recording as C } from "@repo/contracts";
import { ingestSegment, type CaptureDeps } from "../../application/recording/capture";
import type {
  RecordingOperationName,
  RecordingStores,
  RecordingUnitOfWork,
  TranscriptionPolicyProvider,
} from "../../application/recording/session-lifecycle-ports";
import type { IdentityRepository } from "../../application/identity/ports";
import type { RecordingErrorCode } from "../../domain/recording/transcription-core";
import type { OrgId } from "../../domain/org-id";

export type IngestSegmentBody = typeof C.operations.ingestSegment.in._type;
export type IngestSegmentResult = typeof C.operations.ingestSegment.out._type;

/**
 * The idempotency fingerprint.
 *
 * Key order is normalised before hashing: two JSON bodies that differ only in the order
 * their fields were serialised are the SAME request, and treating them as a conflict would
 * make an ordinary client retry look like key reuse.
 */
export function payloadDigest(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, canonical(val)]),
      );
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Raised inside a unit of work so the transaction rolls back before the response is built. */
export class RecordingRefusal extends Error {
  constructor(readonly reason: RecordingErrorCode | "IDEMPOTENCY_KEY_CONFLICT") {
    super("recording_refusal");
  }
}

/**
 * `CaptureDeps` for a path that does not transcribe.
 *
 * `startRecording` never touches `policy`, but `CaptureDeps` requires the field. Handing
 * it a stand-in that ANSWERS would be a second, unconfigured transcription policy hiding
 * in the composition; handing it one that throws means the day something on this path
 * starts transcribing, it stops loudly instead of masking with rules nobody chose.
 */
export function captureDepsWithoutPolicy(
  stores: RecordingStores,
  ids: CaptureDeps["ids"],
): CaptureDeps {
  return {
    sessions: stores.sessions,
    tracks: stores.tracks,
    segments: stores.segments,
    consent: { blocksStart: async () => true },
    retention: stores.retention,
    ids,
    policy: {
      isLowConfidence() {
        throw new Error("transcription policy is not available on this path");
      },
      mask() {
        throw new Error("transcription policy is not available on this path");
      },
    },
  };
}

/**
 * The replay/conflict half of every route.
 *
 * Returns the stored result on a replay so the caller can answer 200 without re-running
 * anything, and refuses a reused key that carries a different payload.
 */
export async function lookupIdempotent<T>(
  stores: RecordingStores,
  operation: RecordingOperationName,
  key: string,
  digest: string,
): Promise<T | undefined> {
  const found = await stores.idempotency.lookup<T>(operation, key, digest);
  if (found.kind === "conflict") throw new RecordingRefusal("IDEMPOTENCY_KEY_CONFLICT");
  return found.kind === "replay" ? found.result : undefined;
}

export interface SegmentIngestionDeps {
  readonly uow: RecordingUnitOfWork;
  readonly identities: IdentityRepository;
  readonly policies: TranscriptionPolicyProvider;
  readonly ids: CaptureDeps["ids"];
}

/**
 * `NO_PROJECT_ROLE`, decided from the SAME membership rows every other bundle's decision
 * reads. A "does this project exist" probe is deliberately not distinguishable from "you
 * have no role on it" — the house precedent (`withdraw-participant-phone.ts`) is explicit
 * that the two share one answer, so an outsider cannot enumerate projects.
 */
export async function requireProjectRole(
  identities: IdentityRepository,
  userId: string,
  orgId: OrgId,
  projectId: string,
): Promise<void> {
  const membership = await identities.findProjectMembership(userId, projectId, orgId);
  if (membership === null) throw new RecordingRefusal("NO_PROJECT_ROLE");
}

/**
 * 摄取一条转写段：幂等 → 会话存在 → 项目角色 → 用例 → 记住幂等结果。
 * 全程在**一个**租户事务里，所以第四步的拒绝会回滚第四步已经写过的东西。
 *
 * @returns `created=false` 表示这是一次幂等重放，调用方据此答 200 而不是 201。
 */
export async function ingestTranscriptSegment(
  deps: SegmentIngestionDeps,
  principal: { readonly userId: string },
  orgId: OrgId,
  sessionId: string,
  body: IngestSegmentBody,
): Promise<{ created: boolean; result: IngestSegmentResult }> {
  const digest = payloadDigest(body);
  return deps.uow.withOrg(orgId, { userId: principal.userId }, async (stores) => {
    const replayed = await lookupIdempotent<IngestSegmentResult>(
      stores, "ingestSegment", body.idempotencyKey, digest,
    );
    if (replayed !== undefined) return { created: false, result: replayed };

    const session = await stores.sessions.lifecycleSession(sessionId);
    if (session === undefined) throw new RecordingRefusal("SESSION_NOT_FOUND");
    await requireProjectRole(deps.identities, principal.userId, orgId, session.projectId);

    const captureDeps: CaptureDeps = {
      ...captureDepsWithoutPolicy(stores, deps.ids),
      policy: deps.policies.policy(),
    };
    const ingested = await ingestSegment(captureDeps, {
      sessionId,
      trackId: body.trackId,
      anchor: body.anchor,
      rawText: body.rawText,
      asrConfidence: body.asrConfidence,
      diarization: body.diarization,
      // ⚠ The contract has no `draft` field, and `transcribe()` needs one to tell
      //   「正在识别」 (`partial`) from a settled segment (`final`). Ingesting as settled
      //   is the choice that cannot fabricate: a `partial` segment is barred from
      //   quotes, retrieval and AI summary (`checkCitability`), so defaulting to
      //   `partial` would silently make every segment uncitable, while defaulting to
      //   `final` is what a caller pushing a completed recognition result means. The
      //   missing field is reported on issue #465.
      draft: false,
    });
    if (!ingested.ok) throw new RecordingRefusal(ingested.reason);

    const result = C.operations.ingestSegment.out.parse({
      segmentId: ingested.segmentId,
      status: ingested.segment.status,
      speakerChannelId: ingested.segment.speakerChannelId,
      lowConfidence: ingested.segment.lowConfidence,
      text: ingested.segment.text,
      piiFindings: ingested.segment.piiFindings,
    });
    await stores.idempotency.remember({
      operation: "ingestSegment", key: body.idempotencyKey, payloadDigest: digest, result,
    });
    return { created: true, result };
  });
}
