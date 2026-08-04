/**
 * issue #465 — the recording bundle's HTTP boundary: start / ingest / end / materialize.
 *
 * The bundle had 28 contract operations, ten domain modules and eleven application modules
 * and **no route**, so from outside the process the entire capability was zero. This
 * controller is protocol adaptation only; every judgement it appears to make is made
 * somewhere else and is named below.
 *
 * ## Four routes, not twenty-eight
 *
 * Deliberate. The other operations' use cases exist but their persistence does not (see the
 * migration's header for what was left out and why), and a route that returns a shape the
 * database cannot yet back is worse than no route: it looks implemented.
 *
 * ## Order of checks, and why it is this one
 *
 *   1. contract validation (`ZodBodyPipe`) — the request must be describable at all
 *   2. idempotency lookup — a replay must not re-run any gate, or a client that retried
 *      after a network blip could be refused by a consent state that changed since
 *   3. project role — `NO_PROJECT_ROLE`, decided by `IdentityRepository`, i.e. by the same
 *      membership data every other bundle's decisions are made from
 *   4. the use case — consent, retention, anchors, mic state
 *
 * Steps 3 and 4 run INSIDE one tenant transaction (`RecordingUnitOfWork.withOrg`), so a
 * refusal at step 4 rolls back whatever step 4 had written before it refused. That is what
 * makes "403 and zero rows" one fact instead of two hopes.
 *
 * ## Status codes
 *
 *   201  a session or a segment was created
 *   200  an ending, a materialisation, or an idempotent REPLAY of a create
 *   403  `CONSENT_NOT_COMPLETED` / `NO_PROJECT_ROLE` — server-side, both of them; a UI that
 *        hides the button is not an implementation of either
 *   404  no such session/track IN THIS TENANT. Another tenant's session id is answered
 *        identically to a nonexistent one, so the endpoint is not an id oracle
 *   409  state conflicts (`SESSION_ENDED`, `SESSION_NOT_ENDED`, `SESSION_ALREADY_RECORDING`,
 *        `MIC_NOT_GRANTED`, `IDEMPOTENCY_KEY_CONFLICT`)
 *   422  well-formed but unacceptable content (`ANCHOR_MISSING`, `RETENTION_POLICY_MISSING`,
 *        `MATERIALIZE_PARTIAL_FAILURE`)
 *   503  a dependency this path refuses to proceed without (masking kernel, object store,
 *        an unconfigured transcription policy) — reject, never degrade
 */
import { createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Response } from "express";
import { recording as C } from "@repo/contracts";
import {
  ingestSegment,
  startRecording,
  type CaptureDeps,
} from "../../application/recording/capture";
import {
  endRecordingSession,
  materializeRecordingSession,
} from "../../application/recording/session-lifecycle";
import {
  RECORDING_ID_GENERATOR,
  RECORDING_UNIT_OF_WORK,
  TRANSCRIPTION_POLICY_PROVIDER,
  TranscriptionPolicyUnconfiguredError,
  type RecordingOperationName,
  type RecordingStores,
  type RecordingUnitOfWork,
  type TranscriptionPolicyProvider,
} from "../../application/recording/session-lifecycle-ports";
import type { IdGenerator } from "../../application/recording/ports";
import {
  ARTIFACT_REPOSITORY,
  ID_FACTORY,
  OBJECT_STORE,
  type ArtifactRepository,
  type IdFactory,
  type ObjectStore,
} from "../../application/artifact/ports";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from "../../application/identity/ports";
import type { RecordingErrorCode } from "../../domain/recording/transcription-core";
import { toOrgId, type OrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type StartBody = typeof C.operations.startRecording.in._type;
type IngestBody = typeof C.operations.ingestSegment.in._type;
type EndBody = typeof C.operations.endRecording.in._type;
type MaterializeBody = typeof C.operations.materializeRecordingArtifacts.in._type;

/**
 * The idempotency fingerprint.
 *
 * Key order is normalised before hashing: two JSON bodies that differ only in the order
 * their fields were serialised are the SAME request, and treating them as a conflict would
 * make an ordinary client retry look like key reuse.
 */
function payloadDigest(value: unknown): string {
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
class RecordingRefusal extends Error {
  constructor(readonly reason: RecordingErrorCode | "IDEMPOTENCY_KEY_CONFLICT") {
    super("recording_refusal");
  }
}

const CONFLICT: ReadonlySet<string> = new Set([
  "SESSION_ALREADY_RECORDING", "SESSION_ALREADY_ENDED", "SESSION_ENDED", "SESSION_NOT_ENDED",
  "MIC_NOT_GRANTED", "MIC_STATE_TRANSITION_INVALID", "IDEMPOTENCY_KEY_CONFLICT",
  "SNAPSHOT_IMMUTABLE",
]);
const NOT_FOUND: ReadonlySet<string> = new Set([
  "SESSION_NOT_FOUND", "TRACK_NOT_FOUND", "SOURCE_REF_NOT_FOUND", "RESOURCE_NOT_FOUND",
]);
const FORBIDDEN: ReadonlySet<string> = new Set([
  "CONSENT_NOT_COMPLETED", "NO_PROJECT_ROLE", "NO_ORG_ROLE", "NOT_TRACK_OWNER",
]);
const UNAVAILABLE: ReadonlySet<string> = new Set([
  "PII_MASKING_UNAVAILABLE", "OBJECT_STORE_UNAVAILABLE", "ARTIFACT_REGISTRY_UNAVAILABLE",
]);

/**
 * One reason code, one status. A table rather than a chain of `if`s so a code added to the
 * contract without a home here lands on 422 — visible and wrong — instead of being folded
 * into whichever branch happened to be last.
 */
function refuse(reason: string): never {
  if (FORBIDDEN.has(reason)) throw new ForbiddenException({ reasonCode: reason });
  if (NOT_FOUND.has(reason)) throw new NotFoundException({ reasonCode: reason });
  if (CONFLICT.has(reason)) throw new ConflictException({ reasonCode: reason });
  if (UNAVAILABLE.has(reason)) throw new ServiceUnavailableException({ reasonCode: reason });
  throw new UnprocessableEntityException({ reasonCode: reason });
}

@Controller()
export class RecordingController {
  constructor(
    @Inject(RECORDING_UNIT_OF_WORK) private readonly uow: RecordingUnitOfWork,
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(TRANSCRIPTION_POLICY_PROVIDER) private readonly policies: TranscriptionPolicyProvider,
    @Inject(RECORDING_ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(ARTIFACT_REPOSITORY) private readonly artifacts: ArtifactRepository,
    @Inject(ID_FACTORY) private readonly artifactIds: IdFactory,
  ) {}

  /**
   * `NO_PROJECT_ROLE`, decided from the SAME membership rows every other bundle's decision
   * reads. A "does this project exist" probe is deliberately not distinguishable from "you
   * have no role on it" — the house precedent (`withdraw-participant-phone.ts`) is explicit
   * that the two share one answer, so an outsider cannot enumerate projects.
   */
  private async requireProjectRole(userId: string, orgId: OrgId, projectId: string): Promise<void> {
    const membership = await this.identities.findProjectMembership(userId, projectId, orgId);
    if (membership === null) throw new ForbiddenException({ reasonCode: "NO_PROJECT_ROLE" });
  }

  /**
   * The replay/conflict half of every route.
   *
   * Returns the stored result on a replay so the caller can answer 200 without re-running
   * anything, and refuses a reused key that carries a different payload.
   */
  private async idempotency<T>(
    stores: RecordingStores,
    operation: RecordingOperationName,
    key: string,
    digest: string,
  ): Promise<T | undefined> {
    const found = await stores.idempotency.lookup<T>(operation, key, digest);
    if (found.kind === "conflict") throw new RecordingRefusal("IDEMPOTENCY_KEY_CONFLICT");
    return found.kind === "replay" ? found.result : undefined;
  }

  /**
   * `CaptureDeps` for a path that does not transcribe.
   *
   * `startRecording` never touches `policy`, but `CaptureDeps` requires the field. Handing
   * it a stand-in that ANSWERS would be a second, unconfigured transcription policy hiding
   * in the composition; handing it one that throws means the day something on this path
   * starts transcribing, it stops loudly instead of masking with rules nobody chose.
   */
  private captureDepsWithoutPolicy(stores: RecordingStores): CaptureDeps {
    return {
      sessions: stores.sessions,
      tracks: stores.tracks,
      segments: stores.segments,
      consent: { blocksStart: async () => true },
      retention: stores.retention,
      ids: this.ids,
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

  @Post("/recording/sessions")
  async start(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.startRecording.in)) body: StartBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const digest = payloadDigest(body);
    const participantIds = body.trackPlan
      .map((t) => t.participantId)
      .filter((p): p is string => p !== null);

    try {
      const outcome = await this.uow.withOrg(orgId, { userId: principal.userId }, async (stores) => {
        const replayed = await this.idempotency<typeof C.operations.startRecording.out._type>(
          stores, "startRecording", body.idempotencyKey, digest,
        );
        if (replayed !== undefined) return { created: false, result: replayed };

        await this.requireProjectRole(principal.userId, orgId, body.projectId);

        const deps: CaptureDeps = {
          ...this.captureDepsWithoutPolicy(stores),
          // F69's gate asks only "is anything pending"; the participant set it has to be
          // complete over lives here, at the boundary, so the adapter closes over it.
          consent: { blocksStart: (ref) => stores.consent.blocksStart(ref, participantIds) },
        };
        const started = await startRecording(deps, {
          sourceType: body.sourceType,
          sourceRefId: body.sourceRefId,
          projectId: body.projectId,
          orgId,
          // ⚠ The contract's `trackPlan` entry carries ONLY `participantId`, while
          //   `capture.ts` wants the browser permission outcome at entry. There is no field
          //   to carry it, so every planned track starts `granted` and a participant who
          //   refused the prompt is expressed by the client not planning a track for them.
          //   That is a real contract gap (a `denied` track can no longer be recorded as a
          //   stored fact at start time, which is what makes 「本路显式标『未录制』」
          //   assertable) and it is reported on issue #465 rather than resolved by adding a
          //   field to the contract from here.
          trackPlan: body.trackPlan.map((t) => ({ participantId: t.participantId, micState: "granted" as const })),
        });
        if (!started.ok) throw new RecordingRefusal(started.reason);

        // Read the row back: `expiresAt` and the resolved retention are stored facts, and
        // recomputing them here would be the same fact in two places.
        const session = await stores.sessions.lifecycleSession(started.sessionId);
        if (session === undefined) throw new RecordingRefusal("SESSION_NOT_FOUND");

        const result = C.operations.startRecording.out.parse({
          sessionId: started.sessionId,
          tracks: started.tracks,
          retention: session.retention,
        });
        await stores.idempotency.remember({
          operation: "startRecording", key: body.idempotencyKey, payloadDigest: digest, result,
        });
        return { created: true, result };
      });
      response.status(outcome.created ? HttpStatus.CREATED : HttpStatus.OK);
      return outcome.result;
    } catch (e) {
      if (e instanceof RecordingRefusal) refuse(e.reason);
      throw e;
    }
  }

  @Post("/recording/sessions/:sessionId/segments")
  async ingest(
    @CurrentPrincipal() principal: Principal,
    @Param("sessionId") sessionId: string,
    @Body(new ZodBodyPipe(C.operations.ingestSegment.in)) body: IngestBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);
    // Path and body both name the session. Preferring one silently would let a caller
    // address session A while the segment lands in B -- and a transcript is exactly the
    // record whose value depends on which conversation it is a record OF.
    if (body.sessionId !== sessionId) throw new BadRequestException("session_id_mismatch");
    const orgId = toOrgId(principal.orgId);
    const digest = payloadDigest(body);

    try {
      const outcome = await this.uow.withOrg(orgId, { userId: principal.userId }, async (stores) => {
        const replayed = await this.idempotency<typeof C.operations.ingestSegment.out._type>(
          stores, "ingestSegment", body.idempotencyKey, digest,
        );
        if (replayed !== undefined) return { created: false, result: replayed };

        const session = await stores.sessions.lifecycleSession(sessionId);
        if (session === undefined) throw new RecordingRefusal("SESSION_NOT_FOUND");
        await this.requireProjectRole(principal.userId, orgId, session.projectId);

        const deps: CaptureDeps = {
          ...this.captureDepsWithoutPolicy(stores),
          policy: this.policies.policy(),
        };
        const ingested = await ingestSegment(deps, {
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
      response.status(outcome.created ? HttpStatus.CREATED : HttpStatus.OK);
      return outcome.result;
    } catch (e) {
      if (e instanceof RecordingRefusal) refuse(e.reason);
      if (e instanceof TranscriptionPolicyUnconfiguredError) {
        // 503 and nothing written. See `env-transcription-policy.ts` for why an
        // unconfigured threshold may not be answered with `lowConfidence: false`.
        throw new ServiceUnavailableException({ reasonCode: "TRANSCRIPTION_POLICY_UNCONFIGURED" });
      }
      throw e;
    }
  }

  // 200, not Nest's default 201: ending a session creates no resource, and materialising
  // returns rows the artifact bundle created rather than one this route owns.
  @HttpCode(HttpStatus.OK)
  @Post("/recording/sessions/:sessionId/end")
  async end(
    @CurrentPrincipal() principal: Principal,
    @Param("sessionId") sessionId: string,
    @Body(new ZodBodyPipe(C.operations.endRecording.in)) body: EndBody,
  ) {
    assertPrincipal(principal);
    if (body.sessionId !== sessionId) throw new BadRequestException("session_id_mismatch");
    const orgId = toOrgId(principal.orgId);
    const digest = payloadDigest(body);

    try {
      return await this.uow.withOrg(orgId, { userId: principal.userId }, async (stores) => {
        const replayed = await this.idempotency<typeof C.operations.endRecording.out._type>(
          stores, "endRecording", body.idempotencyKey, digest,
        );
        if (replayed !== undefined) return replayed;

        const session = await stores.sessions.lifecycleSession(sessionId);
        if (session === undefined) throw new RecordingRefusal("SESSION_NOT_FOUND");
        await this.requireProjectRole(principal.userId, orgId, session.projectId);

        const ended = await endRecordingSession(
          { sessions: stores.sessions, ids: this.ids, clock: { nowIso: () => new Date().toISOString() } },
          { sessionId },
        );
        if (!ended.ok) throw new RecordingRefusal(ended.reason);

        const result = C.operations.endRecording.out.parse({
          sessionId: ended.sessionId,
          endedAt: ended.endedAt,
          durationMs: ended.durationMs,
          materializeJobId: ended.materializeJobId,
        });
        await stores.idempotency.remember({
          operation: "endRecording", key: body.idempotencyKey, payloadDigest: digest, result,
        });
        return result;
      });
    } catch (e) {
      if (e instanceof RecordingRefusal) refuse(e.reason);
      throw e;
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post("/recording/sessions/:sessionId/materialize")
  async materialize(
    @CurrentPrincipal() principal: Principal,
    @Param("sessionId") sessionId: string,
    @Body(new ZodBodyPipe(C.operations.materializeRecordingArtifacts.in)) body: MaterializeBody,
  ) {
    assertPrincipal(principal);
    if (body.sessionId !== sessionId) throw new BadRequestException("session_id_mismatch");
    const orgId = toOrgId(principal.orgId);
    const digest = payloadDigest(body);

    try {
      return await this.uow.withOrg(orgId, { userId: principal.userId }, async (stores) => {
        const replayed = await this.idempotency<
          typeof C.operations.materializeRecordingArtifacts.out._type
        >(stores, "materializeRecordingArtifacts", body.idempotencyKey, digest);
        if (replayed !== undefined) return replayed;

        const session = await stores.sessions.lifecycleSession(sessionId);
        if (session === undefined) throw new RecordingRefusal("SESSION_NOT_FOUND");
        await this.requireProjectRole(principal.userId, orgId, session.projectId);

        const materialized = await materializeRecordingSession(
          {
            sessions: stores.sessions,
            segments: stores.segments,
            store: this.store,
            repo: this.artifacts,
            ids: this.artifactIds,
          },
          { orgId, sessionId, actorId: principal.userId },
        );
        if (!materialized.ok) throw new RecordingRefusal(materialized.reason);

        const result = C.operations.materializeRecordingArtifacts.out.parse({
          artifacts: materialized.artifacts,
        });
        await stores.idempotency.remember({
          operation: "materializeRecordingArtifacts",
          key: body.idempotencyKey,
          payloadDigest: digest,
          result,
        });
        return result;
      });
    } catch (e) {
      if (e instanceof RecordingRefusal) refuse(e.reason);
      throw e;
    }
  }
}
