/**
 * Phase 14 F03 (`streaming-transport` 契约束 UC-1 `subscribeRunEvents`) -- the port between
 * "an event happened inside this run's execution" (`execute-run.ts`'s own call sites) and
 * "a WebSocket client watching this run heard about it"
 * (`interface/ws/agent-run-events.gateway.ts`).
 *
 * ## Why this exists, and why it is NOT the ledger
 *
 * Before this feature, the only way a client learned what happened inside a run was to poll
 * `GET /agent-runs/:runId` (`read-run.ts`) -- reading the SAME rows `execute-run.ts` had
 * already committed. That coupling is exactly what R7 rules out for the new WS surface
 * (`domain.md` I-3): "落库(账本写入)与推流(前端事件转发)必须解耦...落库是审计/恢复用的
 * 旁路 fire-and-forget 写入,不是前端获取状态的路径". `publish` below is called ALONGSIDE
 * the existing ledger writes (`deps.runs.appendStep`/`failRun`/`commitWriteback`/...), never
 * gated on them, and never awaited by them -- see each call site in `execute-run.ts` /
 * `writeback.ts` for the "publish without awaiting the ledger write" ordering that makes the
 * decoupling real rather than aspirational.
 *
 * ## Why in-memory, for now
 *
 * `execute-run.ts` runs in the SAME process as the HTTP/WS surface in this deployment
 * (`AgentRunExecutor`'s own doc: "a deployment that moves execution to a separate worker
 * sets [autostart] to 0" -- that deployment shape does not exist yet). An in-memory,
 * per-process event log is therefore a faithful implementation, not a shortcut: every event
 * a WS client could possibly want was published by code running in this same process. The
 * day execution moves to a separate worker, this PORT'S IMPLEMENTATION needs to become a
 * real cross-process bus (Redis pub/sub -- already a compose dependency, see
 * `docker-compose.dev.yml` -- is the natural next home); nothing above this port's signature
 * needs to change for that swap. See `in-memory-run-event-bus.ts` for the implementation and
 * its own bounds.
 */
import type { OrgId } from "../../domain/org-id";
import type { streamingTransport as ST } from "@repo/contracts";

export type KernelStreamEvent = ST.KernelStreamEvent;

export interface RunEventBusPort {
  /**
   * Fire-and-forget: assigns the next `seq` for this run, appends the event to its replay
   * buffer, and hands it to every live subscriber synchronously. Never throws and never lets
   * a subscriber's own failure propagate back to the caller -- a slow or broken WS client
   * must not slow down or fail the run itself (see the in-memory implementation's own doc
   * for how a bad listener is isolated).
   *
   * `build` receives the seq this call assigned so the caller can construct the exact typed
   * `KernelStreamEvent` variant without keeping a separate counter of its own
   * (`execute-run.ts` already owns a `seqCursor`/`deltaSeq` for the LEDGER's own seq spaces;
   * this is a THIRD, independent seq space -- the WS wire's `seq`, scoped to this bus, per
   * I-4 "同一 runId 下事件的 seq 单调递增").
   */
  publish(orgId: OrgId, runId: string, build: (seq: number) => KernelStreamEvent): void;

  /**
   * Replays every buffered event with `seq > afterSeq` SYNCHRONOUSLY (before this call
   * returns), in order, then keeps delivering new ones live until the returned function is
   * invoked. One method covers both "fresh subscribe" (`afterSeq: -1`) and "reconnect"
   * (`afterSeq: lastKnownSeq`, R3 步骤 4 / R4 E2) -- giving them a single code path is how
   * "reconnect replays exactly the events a fresh connect would have delivered late" stays
   * true by construction, not by two implementations agreeing.
   */
  subscribe(
    orgId: OrgId,
    runId: string,
    afterSeq: number,
    onEvent: (event: KernelStreamEvent) => void,
  ): () => void;
}
