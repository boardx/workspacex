/**
 * F40 -- uc-22-3 R2/R4/R7: the event catalog and debounce/priority policy for the
 * materialization event bus.
 *
 * ⚠ Scope boundary (R11): this bundle is ONE of the two horizontal features UC-22.3 asks to
 * be split out ("① 物化事件总线 + 去抖 + 持久队列"). It owns routing a business event to the
 * SHARED persistent queue (the same one UC-22.2's ingestion pipeline already uses -- see
 * `application/files/ingestion-ports.ts`), with debounce for high-frequency sources and
 * priority/backpressure so materialization never starves or blocks a user's own upload.
 * It does NOT own producing the seven per-source file sets (`responses.csv`,
 * `messages.jsonl`, ...) -- those are R11's seven separate per-source features, each of
 * which is the consumer that eventually claims a job this bus enqueued and calls into
 * `materializeArtifact` (F35/F04) the same way `upload-artifact.ts` already does. That is
 * what "不另建入库路径" means structurally: one shared queue, one shared claim path, two
 * different PRODUCERS feeding it (a human's upload vs. this bus's business event).
 *
 * ⚠ `MaterializationSourceType` is deliberately its OWN type, not a re-export or a second
 * declaration of `@repo/contracts`'s `artifact.ArtifactSource`. They answer different
 * questions: `ArtifactSource` is "what does `artifacts.source` hold once a row exists";
 * this is "which business domain fired the event that will eventually create that row" --
 * and it has two members (`workshop`, `canvas`) that `ArtifactSource` does not yet carry
 * (that enum has no workshop/canvas member as of this feature; extending it is each of
 * those two per-source features' own contract work, not this bus's). Naming this
 * `ArtifactSource` would misrepresent it as the same fact declared twice.
 */

/** The seven business domains R3's step-2 table enumerates. Routing label only -- see this
 *  file's header for why it is not `ArtifactSource`. */
export type MaterializationSourceType =
  | "survey"
  | "conversation"
  | "interview"
  | "workshop"
  | "research"
  | "canvas"
  | "generated";

/**
 * The exact trigger catalog from R2 -- "全部是系统事件驱动，不是用户点导出". Adding a new
 * kind here without an entry in `EVENT_SOURCE_TYPE` is a compile error (the `Record` below
 * is total), which is the mechanical guard against silently missing one of the seven rows.
 */
export type MaterializationEventKind =
  | "survey.response.submitted"
  | "survey.closed"
  | "conversation.message.appended"
  | "conversation.closed"
  | "interview.session.ended"
  | "transcript.finalized"
  | "workshop.recording.stopped"
  | "whiteboard.photo.uploaded"
  | "research.run.completed"
  | "canvas.saved"
  | "generation.completed";

/** Single source for "which domain does this event kind belong to" -- R2's table, restated
 *  as data instead of scattered `if (kind.startsWith("survey."))` checks at every call site. */
export const EVENT_SOURCE_TYPE: Readonly<Record<MaterializationEventKind, MaterializationSourceType>> = {
  "survey.response.submitted": "survey",
  "survey.closed": "survey",
  "conversation.message.appended": "conversation",
  "conversation.closed": "conversation",
  "interview.session.ended": "interview",
  "transcript.finalized": "interview",
  "workshop.recording.stopped": "workshop",
  "whiteboard.photo.uploaded": "workshop",
  "research.run.completed": "research",
  "canvas.saved": "canvas",
  "generation.completed": "generated",
};

/**
 * R4 A1 / R7 "高频小对象不单独成文件": ONLY conversation messages are debounced. Every other
 * event kind materializes on its own next tick (still queued, still async, but no
 * coalescing window) -- a submitted survey response, a finished interview, a saved canvas
 * are each already a single discrete business event, not a stream of them.
 */
export const DEBOUNCED_EVENT_KINDS: ReadonlySet<MaterializationEventKind> = new Set([
  "conversation.message.appended",
]);

/**
 * R4 A1: the event that forces an immediate final materialization regardless of any open
 * debounce window -- "会话结束时强制落一版终版". Also cancels (does not merely shorten) any
 * pending window for the same `sourceRef`, so a close right after a message does not produce
 * TWO versions (the debounced one and the forced one) once the crossed-08-chat "what counts
 * as session end" question (this feature's own `【跨分片依赖待确认】`) is answered upstream.
 */
export const FORCE_FLUSH_EVENT_KINDS: ReadonlySet<MaterializationEventKind> = new Set(["conversation.closed"]);

/**
 * R9's five time budgets are explicitly `[待确认]` in the requirements doc -- this feature
 * does not invent the ratified number, the same way `ingestion-worker.ts`'s `ReviewGate`
 * does not invent T-9's threshold. 5 minutes is the conservative value the requirements doc
 * itself proposes for the conversation debounce window; it is a constructor default so a
 * real ratified value replaces it in ONE place, not scattered across call sites.
 */
export const DEFAULT_CONVERSATION_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * R9 "物化任务与上传摄取共用持久队列，但优先级低于用户主动上传". A rank, not a boolean,
 * so a third tier could be added later without redefining the comparison -- lower rank is
 * served first. This is the ONE place that ordering is declared; the shared queue's
 * `claimNext` (production adapter, out of this feature's pure-test scope) and every fake used
 * in tests both sort by this rank, never by a re-typed literal comparison of their own.
 */
export type MaterializationPriority = "upload" | "materialization";

export const MATERIALIZATION_PRIORITY_RANK: Readonly<Record<MaterializationPriority, number>> = {
  upload: 0,
  materialization: 1,
};

/**
 * R4 E5 "物化风暴...积压超阈值时给出可见告警". Same status as the debounce window: a
 * requirements-proposed default, not a ratified SLO, so it lives here as ONE constant rather
 * than a magic number at the call site.
 */
export const DEFAULT_BACKLOG_ALERT_THRESHOLD = 500;
