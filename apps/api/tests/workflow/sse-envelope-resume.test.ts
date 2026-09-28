/**
 * WF03 —— SSE 信封与断线续传（ADR-118 第 3 条；requirements 02 R3 第 8 步、R4 E10；domain I-10/I-11）。
 * 真实 HTTP（kernel.module 合成）+ 真实 PostgreSQL；保留窗口经 KERNEL_WORKFLOW_SSE_REPLAY_WINDOW 调小到 3。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkflowSseEnvelope } from "@repo/contracts/workflow-runtime";
import { DEMO_WORKFLOW_KEY } from "../../src/infrastructure/workflow/demo-workflow-graph";
import { closeAppDeterministically } from "../support/close-app";
import { resetOrgs } from "../support/db";
import { eventSeqs, publishDemoWorkflow, seedWorkflowOrg, waitFor } from "./wf03-fixtures";
import { as, startWorkflowApp, type Wf03App } from "./wf03-http";

const ORG = "org-wf03-sse";
const OTHER_ORG = "org-wf03-sse-other";
const ALICE = "u-wf03-sse-alice";
const AGENT = "agent-wf03-sse";
const WINDOW = 3;

let n = 0;
const rid = () => `req-wf03-sse-${Date.now()}-${++n}`;

interface Frame {
  id: number;
  envelope: WorkflowSseEnvelope;
}

/** 读 SSE 帧；`stopAfter` 条后主动断线（模拟网络中断）。流自然结束（实例终态）时返回全部。 */
async function readSse(e: Wf03App, userId: string, orgId: string, instanceId: string, opts: { lastEventId?: number; stopAfter?: number } = {}) {
  const controller = new AbortController();
  const headers: Record<string, string> = { "x-kernel-test-principal": `${userId}:${orgId}` };
  if (opts.lastEventId !== undefined) headers["last-event-id"] = String(opts.lastEventId);
  const res = await fetch(`${e.base}/workflow-instances/${instanceId}/events`, { headers, signal: controller.signal });
  const frames: Frame[] = [];
  if (res.status !== 200) return { status: res.status, contentType: res.headers.get("content-type"), frames, body: await res.json() };
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const id = /^id: (\d+)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (id === undefined || data === undefined) continue; // keepalive 注释
        frames.push({ id: Number(id), envelope: WorkflowSseEnvelope.parse(JSON.parse(data)) });
        if (opts.stopAfter !== undefined && frames.length >= opts.stopAfter) {
          controller.abort();
          return { status: res.status, contentType: res.headers.get("content-type"), frames, body: null };
        }
      }
    }
  } catch (err) {
    if (!controller.signal.aborted) throw err;
  }
  return { status: res.status, contentType: res.headers.get("content-type"), frames, body: null };
}

describe("WF03 SSE envelope and Last-Event-ID resume", () => {
  let e: Wf03App;
  beforeAll(async () => {
    e = await startWorkflowApp({ KERNEL_WORKFLOW_SSE_REPLAY_WINDOW: String(WINDOW) });
  }, 120_000);
  afterAll(async () => {
    await resetOrgs(ORG, OTHER_ORG);
    await closeAppDeterministically(e?.app);
  });
  beforeEach(async () => {
    await resetOrgs(ORG, OTHER_ORG);
    await seedWorkflowOrg(ORG, [{ userId: ALICE }], AGENT);
    await seedWorkflowOrg(OTHER_ORG, [{ userId: ALICE }], `${AGENT}-other`);
    await publishDemoWorkflow(e.db, ORG);
  });

  async function startSlow(): Promise<string> {
    const r = await as(e, ALICE, ORG).post(`/workflows/${DEMO_WORKFLOW_KEY}/instances`, {
      agentId: AGENT, requestId: rid(), input: { topic: "推送", stageDelayMs: 300 },
    });
    expect(r.status).toBe(201);
    return r.body.instanceId;
  }

  it("first connect: snapshot then contiguous deltas {instanceId,seq,type,stateVersion,payload}; every pushed seq exists in workflow_events", async () => {
    const id = await startSlow();
    const s = await readSse(e, ALICE, ORG, id);
    expect(s.status).toBe(200);
    expect(s.contentType).toMatch(/^text\/event-stream/);
    const [head, ...rest] = s.frames;
    expect(head!.envelope.type).toBe("snapshot");
    expect(head!.envelope.instanceId).toBe(id);
    expect(head!.id).toBe(head!.envelope.seq);
    const deltas = rest.map((f) => f.envelope);
    expect(deltas.every((d) => d.type === "delta")).toBe(true);
    expect(deltas.map((d) => d.seq)).toEqual(deltas.map((_, i) => head!.envelope.seq + 1 + i));

    const log = await eventSeqs(ORG, id);
    expect(log.at(-1)!.seq).toBe(deltas.length > 0 ? deltas.at(-1)!.seq : head!.envelope.seq);
    for (const d of deltas) {
      const row = log.find((x) => x.seq === d.seq);
      expect(row, `seq ${d.seq}`).toBeDefined(); // I-11：推送的 seq 一定已在事件日志
      expect(d.stateVersion).toBe(row!.state_version);
      expect(d.type === "delta" && d.payload.event).toBe(row!.type);
    }
    const last = deltas.at(-1)!;
    expect(last.type === "delta" && last.payload.event).toBe("status_changed");
    expect(last.type === "delta" && last.payload.data.status).toBe("succeeded");
  }, 60_000);

  it("E10: disconnect mid-run and reconnect with Last-Event-ID → resumes at seq+1, no gap, no duplicate, no snapshot", async () => {
    const id = await startSlow();
    const first = await readSse(e, ALICE, ORG, id, { stopAfter: 3 });
    expect(first.frames).toHaveLength(3);
    const lastSeen = first.frames.at(-1)!.envelope.seq;
    // 断线期间服务端继续运行（不依赖连接）
    await waitFor(async () => (await eventSeqs(ORG, id)).length, (len) => len > lastSeen + 1);

    const second = await readSse(e, ALICE, ORG, id, { lastEventId: lastSeen });
    expect(second.frames.length).toBeGreaterThan(0);
    expect(second.frames.every((f) => f.envelope.type === "delta")).toBe(true);
    expect(second.frames[0]!.envelope.seq).toBe(lastSeen + 1);

    const snapshotSeq = first.frames[0]!.envelope.seq;
    const all = [...first.frames.slice(1), ...second.frames].map((f) => f.envelope.seq);
    const log = (await eventSeqs(ORG, id)).map((x) => x.seq).filter((s) => s > snapshotSeq);
    expect(all).toEqual(log); // 无缺号、无重复
    expect(new Set(all).size).toBe(all.length);
  }, 60_000);

  it("gap beyond the retention window (or a Last-Event-ID from the future) → a snapshot first, then only newer deltas", async () => {
    const id = await startSlow();
    await waitFor(() => as(e, ALICE, ORG).get(`/workflow-instances/${id}`), (r) => r.body.status === "succeeded");
    const log = await eventSeqs(ORG, id);
    const lastSeq = log.at(-1)!.seq;
    expect(lastSeq - 1).toBeGreaterThan(WINDOW);

    const beyond = await readSse(e, ALICE, ORG, id, { lastEventId: 1 });
    expect(beyond.frames).toHaveLength(1);
    const snap = beyond.frames[0]!.envelope;
    expect(snap.type).toBe("snapshot");
    expect(snap.seq).toBe(lastSeq);
    expect(snap.type === "snapshot" && snap.payload.status).toBe("succeeded");
    expect(snap.type === "snapshot" && snap.payload.lastSeq).toBe(lastSeq);
    expect(snap.stateVersion).toBe(log.at(-1)!.state_version);

    const within = await readSse(e, ALICE, ORG, id, { lastEventId: lastSeq - WINDOW });
    expect(within.frames.map((f) => [f.envelope.type, f.envelope.seq])).toEqual(
      [lastSeq - WINDOW + 1, lastSeq - WINDOW + 2, lastSeq].map((s) => ["delta", s]),
    );

    const future = await readSse(e, ALICE, ORG, id, { lastEventId: lastSeq + 50 });
    expect(future.frames.map((f) => f.envelope.type)).toEqual(["snapshot"]);
  }, 60_000);

  it("another org cannot open the stream (404, not an event-stream)", async () => {
    const id = await startSlow();
    const s = await readSse(e, ALICE, OTHER_ORG, id);
    expect(s.status).toBe(404);
    expect(s.body.code).toBe("workflow_not_found");
    await waitFor(() => as(e, ALICE, ORG).get(`/workflow-instances/${id}`), (r) => r.body.status === "succeeded");
  }, 60_000);
});
