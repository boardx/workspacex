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
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Response } from "express";
import { personalRealtimeTranscription as PersonalC, recording as C } from "@repo/contracts";
import {
  startRecording,
  type CaptureDeps,
} from "../../application/recording/capture";
import { setConsentDecision } from "../../application/recording/consent-decision";
import {
  RecordingRefusal,
  captureDepsWithoutPolicy,
  ingestTranscriptSegment,
  lookupIdempotent,
  payloadDigest,
  requireProjectRole,
  type IngestSegmentBody,
} from "../recording/segment-ingestion";
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
import {
  createPersonalTranscription,
  listPersonalTranscriptions,
  PersonalTranscriptionNotFound,
  PersonalTranscriptionOrgMembershipRequired,
  readPersonalTranscription,
  updatePersonalTranscriptionContent,
  issueRealtimeAsrTicket,
  RealtimeAsrNotConfigured,
  RealtimeAsrCaptureAlreadyActive,
} from "../../application/recording/personal-transcription-usecases";
import {
  PERSONAL_TRANSCRIPTION_REPOSITORY,
  PersonalTranscriptionCursorInvalid,
  type PersonalTranscriptionRepository,
} from "../../application/recording/personal-transcription-ports";
import { PERSONAL_REALTIME_ASR_PROVIDER, REALTIME_ASR_TICKET_STORE, type PersonalRealtimeAsrProvider,
  type RealtimeAsrTicketStore } from "../../application/recording/personal-realtime-asr";

type StartBody = typeof C.operations.startRecording.in._type;
type EndBody = typeof C.operations.endRecording.in._type;
type MaterializeBody = typeof C.operations.materializeRecordingArtifacts.in._type;
type SetConsentDecisionBody = typeof C.operations.setConsentDecision.in._type;
type CreatePersonalTranscriptionBody = typeof PersonalC.operations.createPersonalTranscription.in._type;
type ListPersonalTranscriptionsQuery = typeof PersonalC.operations.listPersonalTranscriptions.in._type;
const UpdatePersonalContentBody = PersonalC.operations.updatePersonalTranscriptionContent.in.pick({ content: true });

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
    @Inject(PERSONAL_TRANSCRIPTION_REPOSITORY)
    private readonly personalTranscriptions: PersonalTranscriptionRepository,
    @Inject(REALTIME_ASR_TICKET_STORE) private readonly personalAsrTickets: RealtimeAsrTicketStore,
    @Inject(PERSONAL_REALTIME_ASR_PROVIDER) private readonly personalAsr: PersonalRealtimeAsrProvider,
  ) {}

  private personalDependencies() {
    return {
      identities: this.identities,
      repository: this.personalTranscriptions,
    };
  }

  private personalError(error: unknown): never {
    if (error instanceof PersonalTranscriptionNotFound) {
      throw new NotFoundException({ reasonCode: "TRANSCRIPTION_NOT_FOUND" });
    }
    if (error instanceof PersonalTranscriptionOrgMembershipRequired) {
      throw new ForbiddenException({ reasonCode: "ORG_MEMBERSHIP_REQUIRED" });
    }
    if (error instanceof PersonalTranscriptionCursorInvalid) {
      throw new BadRequestException({ reasonCode: "VALIDATION_FAILED" });
    }
    if (error instanceof RealtimeAsrNotConfigured) throw new ServiceUnavailableException({reasonCode:"ASR_NOT_CONFIGURED"});
    if (error instanceof RealtimeAsrCaptureAlreadyActive)
      throw new ConflictException({reasonCode:"CAPTURE_ALREADY_ACTIVE"});
    throw error;
  }

  @Post(PersonalC.operations.issueRealtimeAsrTicket.path)
  async issuePersonalTicket(@CurrentPrincipal() principal:Principal,@Param("sessionId") sessionId:string){
    assertPrincipal(principal);
    try{return PersonalC.operations.issueRealtimeAsrTicket.out.parse(await issueRealtimeAsrTicket({
      ...this.personalDependencies(),tickets:this.personalAsrTickets,ids:this.ids,isConfigured:()=>this.personalAsr.isConfigured()},
      {userId:principal.userId,orgId:toOrgId(principal.orgId),transcriptionId:sessionId}));}
    catch(error){this.personalError(error);}
  }

  @Post(PersonalC.operations.createPersonalTranscription.path)
  async createPersonal(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(PersonalC.operations.createPersonalTranscription.in))
    body: CreatePersonalTranscriptionBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);
    try {
      const created = await createPersonalTranscription(
        { ...this.personalDependencies(), ids: this.ids },
        { userId: principal.userId, orgId: toOrgId(principal.orgId), name: body.name, tags: body.tags },
      );
      response.status(HttpStatus.CREATED);
      return PersonalC.operations.createPersonalTranscription.out.parse(created);
    } catch (error) {
      this.personalError(error);
    }
  }

  @Get(PersonalC.operations.listPersonalTranscriptions.path)
  async listPersonal(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodBodyPipe(PersonalC.operations.listPersonalTranscriptions.in))
    query: ListPersonalTranscriptionsQuery,
  ) {
    assertPrincipal(principal);
    try {
      const listed = await listPersonalTranscriptions(this.personalDependencies(), {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        query: query.query,
        tag: query.tag,
        sort: query.sort,
        cursor: query.cursor,
      });
      return PersonalC.operations.listPersonalTranscriptions.out.parse(listed);
    } catch (error) {
      this.personalError(error);
    }
  }

  @Get(PersonalC.operations.readPersonalTranscription.path)
  async readPersonal(
    @CurrentPrincipal() principal: Principal,
    @Param("sessionId") sessionId: string,
  ) {
    assertPrincipal(principal);
    try {
      const detail = await readPersonalTranscription(this.personalDependencies(), {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        transcriptionId: sessionId,
      });
      return PersonalC.operations.readPersonalTranscription.out.parse(detail);
    } catch (error) {
      this.personalError(error);
    }
  }

  @Patch(PersonalC.operations.updatePersonalTranscriptionContent.path)
  async updatePersonalContent(
    @CurrentPrincipal() principal: Principal,
    @Param("sessionId") sessionId: string,
    @Body(new ZodBodyPipe(UpdatePersonalContentBody)) body: { content: string },
  ) {
    assertPrincipal(principal);
    try {
      return PersonalC.operations.updatePersonalTranscriptionContent.out.parse(
        await updatePersonalTranscriptionContent(this.personalDependencies(), {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          transcriptionId: sessionId,
          content: body.content,
        }),
      );
    } catch (error) {
      this.personalError(error);
    }
  }

  /**
   * `NO_PROJECT_ROLE`, decided from the SAME membership rows every other bundle's decision
   * reads. A "does this project exist" probe is deliberately not distinguishable from "you
   * have no role on it" — the house precedent (`withdraw-participant-phone.ts`) is explicit
   * that the two share one answer, so an outsider cannot enumerate projects.
   */
  private async requireProjectRole(userId: string, orgId: OrgId, projectId: string): Promise<void> {
    // Delegates: the same check runs on the WS surface (#466), and two copies of "who may
    // touch this project" is exactly the shape `AGENTS.md` names.
    await requireProjectRole(this.identities, userId, orgId, projectId);
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
    return lookupIdempotent<T>(stores, operation, key, digest);
  }

  /** See `interface/recording/segment-ingestion.ts` for why this stand-in throws. */
  private captureDepsWithoutPolicy(stores: RecordingStores): CaptureDeps {
    return captureDepsWithoutPolicy(stores, this.ids);
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

  /**
   * setConsentDecision —— issue #652. Writes one cell of `recording_consent_cells`.
   *
   * ⚠ See `contracts/recording.ts`'s `setConsentDecision` doc and
   * `KNOWN_CONTRACT_GAPS.C_REC_6` for why this route exists (production had ZERO writers for
   * a table `startRecording`'s `CONSENT_NOT_COMPLETED` gate reads) and what is still
   * unresolved (who may submit on whose behalf).
   *
   * Same authorization judgement as every other route in this controller: `NO_PROJECT_ROLE`
   * from `requireProjectRole`, nothing narrower — consistent with `startRecording` itself not
   * checking "is the caller one of the people in `trackPlan`".
   */
  @Post("/recording/consent/decisions")
  async setConsentDecision(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.setConsentDecision.in)) body: SetConsentDecisionBody,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);

    try {
      return await this.uow.withOrg(orgId, { userId: principal.userId }, async (stores) => {
        await this.requireProjectRole(principal.userId, orgId, body.projectId);

        const written = await setConsentDecision(
          { consent: stores.consent },
          {
            sourceRefId: body.sourceRefId,
            participantId: body.participantId,
            item: body.item,
            state: body.state,
          },
        );
        return C.operations.setConsentDecision.out.parse(written);
      });
    } catch (e) {
      if (e instanceof RecordingRefusal) refuse(e.reason);
      throw e;
    }
  }

  @Post("/recording/sessions/:sessionId/segments")
  async ingest(
    @CurrentPrincipal() principal: Principal,
    @Param("sessionId") sessionId: string,
    @Body(new ZodBodyPipe(C.operations.ingestSegment.in)) body: IngestSegmentBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);
    // Path and body both name the session. Preferring one silently would let a caller
    // address session A while the segment lands in B -- and a transcript is exactly the
    // record whose value depends on which conversation it is a record OF.
    if (body.sessionId !== sessionId) throw new BadRequestException("session_id_mismatch");
    const orgId = toOrgId(principal.orgId);

    try {
      // ⚠ The whole transaction lives in `interface/recording/segment-ingestion.ts`, and
      //   the WS surface (#466) calls THAT, not this method. Two boundaries, one write
      //   path — which is what `design-deltas/realtime-asr/contract.md` §2 requires in as
      //   many words ("不新增第二条写路径").
      const outcome = await ingestTranscriptSegment(
        { uow: this.uow, identities: this.identities, policies: this.policies, ids: this.ids },
        principal, orgId, sessionId, body,
      );
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

  /**
   * readTranscriptStream —— 读回本会话的转写段（契约 `readTranscriptStream`）。
   *
   * ## 为什么 #466 必须补上它
   *
   * #465 交付了四条**写**路由（start / ingest / end / materialize），一条读路由都没有。
   * 没有读路由，「录完了，刷新页面转录还在不在」这件事在浏览器里**无从断言** ——
   * 而那恰好是唯一能区分「写进了 PostgreSQL」与「写进了 React state」的断言
   * （本仓步骤 6a、8a 都栽在同一处，注释还在 `core-loop.spec.ts` 里）。
   * 所以这不是顺手加的端口，它是步骤 7 的验收线本身。
   *
   * ⚠ 契约的 `includeMasked` 是 `z.literal(true)`：本端口**不提供**未遮盖读取，
   *   那条路只有 `revealPii`。所以这里不接受 `includeMasked=false`，
   *   传了就是 400 —— 而不是悄悄当成 true。
   *
   * ⚠ `resolvedSpeaker` 恒 `null`：它由 `SpeakerAssignment` 解析而来（I-10），
   *   而指派那张表在 #465 的迁移里**刻意没建**。返回 `null` 是契约里「未指派」
   *   的正确表达（界面渲染「出处待补」），不是缺省值兜底。
   *
   * ⚠ `cursor` / `q` 今天不实现，且**不静默忽略**：传了就 422 `CURSOR_INVALID` /
   *   400。一个悄悄无视分页参数的列表端口，会在数据超过一页时开始丢数据而没人发现。
   */
  @Get("/recording/sessions/:sessionId/segments")
  async segments(
    @CurrentPrincipal() principal: Principal,
    @Param("sessionId") sessionId: string,
    @Query("includeMasked") includeMasked: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("q") q: string | undefined,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    // The contract's input is `includeMasked: z.literal(true)` — a query string carries
    // text, so "true" is the only spelling that parses to it.
    if (includeMasked !== "true") {
      throw new BadRequestException({ reasonCode: "INCLUDE_MASKED_MUST_BE_TRUE" });
    }
    if (cursor !== undefined) throw new UnprocessableEntityException({ reasonCode: "CURSOR_INVALID" });
    if (q !== undefined) throw new BadRequestException({ reasonCode: "FULL_TEXT_SEARCH_NOT_IMPLEMENTED" });

    const startedAt = Date.now();
    try {
      return await this.uow.withOrg(orgId, { userId: principal.userId }, async (stores) => {
        const session = await stores.sessions.lifecycleSession(sessionId);
        // Another tenant's session id is answered identically to a nonexistent one, so the
        // endpoint is not an id oracle (same rule as the write routes above).
        if (session === undefined) throw new RecordingRefusal("SESSION_NOT_FOUND");
        await this.requireProjectRole(principal.userId, orgId, session.projectId);
        const stored = await stores.segments.ofSession(sessionId);
        return C.operations.readTranscriptStream.out.parse({
          segments: stored.map((line) => ({
            id: line.id,
            sessionId: line.sessionId,
            trackId: line.trackId,
            anchor: line.anchor,
            speakerChannelId: line.speakerChannelId,
            resolvedSpeaker: null,
            status: line.status,
            lowConfidence: line.lowConfidence,
            text: line.text,
            piiFindings: line.piiFindings,
          })),
          nextCursor: null,
          latencyMs: Math.max(0, Date.now() - startedAt),
        });
      });
    } catch (e) {
      if (e instanceof RecordingRefusal) refuse(e.reason);
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
