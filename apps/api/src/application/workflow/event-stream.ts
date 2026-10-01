/**
 * WF03 / UC-WR-6 —— SSE 事件流的读侧（ADR-118 第 3 条；domain I-10/I-11；R3 第 8 步；R4 E10）。
 *
 * 只推 workflow_events 里已有的行（I-11：先写事件、再推送）。信封 `{instanceId, seq, type, stateVersion, payload}`：
 * - 首次连接（无 Last-Event-ID）或差距超过保留窗口（`lastSeq - lastEventId > replayWindow`）或 Last-Event-ID
 *   比服务端还新：先发一个 `snapshot`（seq = projection.lastSeq），之后从它 +1 起发 delta；
 * - 否则从 `lastEventId + 1` 起逐条补发 delta：无缺号、无重复。
 * 流不依赖连接：服务端运行与此无关，断线只影响推送。
 */
import { WorkflowSseEnvelope } from "@repo/contracts/workflow-runtime";
import { isTerminal, loadVisibleProjection, resolveActor } from "./instance-projection";
import type { WorkflowActor, WorkflowDefinitionRepository, WorkflowInstanceRepository } from "./workflow-ports";
import type { WorkflowAccessPort, WorkflowEventStore, WorkflowStoredEvent } from "./workflow-runtime-ports";

export interface EventStreamDeps {
  definitions: WorkflowDefinitionRepository;
  instances: WorkflowInstanceRepository;
  events: WorkflowEventStore;
  access: WorkflowAccessPort;
}

export interface WorkflowEventCursor {
  /** 取下一批信封；`done` = 实例已终态且事件已全部发出。 */
  next(): Promise<{ envelopes: WorkflowSseEnvelope[]; done: boolean }>;
}

const BATCH = 500;

export function toDeltaEnvelope(instanceId: string, e: WorkflowStoredEvent): WorkflowSseEnvelope {
  return WorkflowSseEnvelope.parse({
    instanceId,
    seq: e.seq,
    type: "delta",
    stateVersion: e.stateVersion,
    payload: { event: e.type, stageId: e.stageId, reasonCode: e.reasonCode, data: e.data },
  });
}

export async function openEventStream(
  deps: EventStreamDeps,
  cmd: { orgId: string; userId: string; instanceId: string; lastEventId?: number; replayWindow: number },
): Promise<WorkflowEventCursor> {
  const actor: WorkflowActor = await resolveActor(deps.access, cmd.orgId, cmd.userId);
  // 可见性先判（404），并拿到当前 lastSeq 决定补发还是快照。
  const first = await loadVisibleProjection(deps, cmd.orgId, cmd.instanceId, actor);
  const pending: WorkflowSseEnvelope[] = [];
  let cursor: number;
  const last = cmd.lastEventId;
  if (last === undefined || last > first.lastSeq || first.lastSeq - last > cmd.replayWindow) {
    pending.push(WorkflowSseEnvelope.parse({ instanceId: cmd.instanceId, seq: first.lastSeq, type: "snapshot", stateVersion: first.stateVersion, payload: first }));
    cursor = first.lastSeq;
  } else {
    cursor = last;
  }
  return {
    async next() {
      const out = pending.splice(0);
      const batch = await deps.events.listAfter(cmd.orgId, cmd.instanceId, cursor, BATCH);
      for (const e of batch) {
        if (e.seq !== cursor + 1) throw new Error(`workflow event log gap after seq ${cursor} (got ${e.seq})`);
        out.push(toDeltaEnvelope(cmd.instanceId, e));
        cursor = e.seq;
      }
      if (batch.length === BATCH) return { envelopes: out, done: false };
      const instance = await deps.instances.find(cmd.orgId, cmd.instanceId);
      if (!instance) return { envelopes: out, done: true };
      if (!isTerminal(instance.status)) return { envelopes: out, done: false };
      // 终态：再补一次，确保终态事件本身已发出（状态与事件同事务，读到终态即事件已在库）。
      for (const e of await deps.events.listAfter(cmd.orgId, cmd.instanceId, cursor, BATCH)) {
        if (e.seq !== cursor + 1) throw new Error(`workflow event log gap after seq ${cursor} (got ${e.seq})`);
        out.push(toDeltaEnvelope(cmd.instanceId, e));
        cursor = e.seq;
      }
      return { envelopes: out, done: true };
    },
  };
}
