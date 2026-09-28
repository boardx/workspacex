/**
 * WF03 —— 演示 Workflow 作崩溃恢复载体（requirements 02 R3 第 3/4 步；R4 E2/E11；domain I-8/I-9/I-10）。
 * 真实 PostgreSQL + 真实 LangGraph PostgresSaver（经唯一 checkpointer 工厂）。
 *
 * 崩溃点：worker A 在 `draft` 阶段业务产出已写入 workflow_stage_outputs、节点尚未返回（checkpoint 未推进）时死掉。
 * worker B 在 A 的 lease 过期后接管：从 checkpoint 续跑，collect 不重做（checkpoint 已记），draft 命中既有产出行
 * 不重做，只做 finalize；事件无重复、seq 连续；A 的旧 epoch 在任何写入前被 assertLease 拦下。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkflowLeaseLostError } from "../../src/application/workflow/workflow-errors";
import type { WorkflowRuntimeService } from "../../src/application/workflow/workflow-runtime-service";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { createWorkflowRuntime } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { DEMO_WORKFLOW_GRAPH_REF, DEMO_WORKFLOW_KEY } from "../../src/infrastructure/workflow/demo-workflow-graph";
import { PgWorkflowLeaseStore } from "../../src/infrastructure/workflow/pg-workflow-lease-store";
import { WORKFLOW_CHECKPOINT_SCHEMA, createWorkflowCheckpointerFactory } from "../../src/infrastructure/workflow/workflow-checkpointer-factory";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { eventSeqs, publishDemoWorkflow, seedWorkflowOrg, sleep } from "./wf03-fixtures";

const API = fileURLToPath(new URL("../..", import.meta.url));
const ORG = "org-wf03-crash";
const USER = "u-wf03-crash";
const AGENT = "agent-wf03-crash";
const TTL = 400;

class SimulatedCrash extends Error {}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("WF03 demo workflow crash recovery", () => {
  let db: PgDatabase;
  let pool: pg.Pool;
  const threads: string[] = [];

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
    pool = new pg.Pool({ ...appConfig(), max: 3 });
  }, 60_000);
  afterAll(async () => {
    for (const t of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) {
      await asOwner((c) => c.query(`DELETE FROM ${WORKFLOW_CHECKPOINT_SCHEMA}.${t} WHERE thread_id = ANY($1)`, [threads]));
    }
    await resetOrgs(ORG);
    await pool?.end();
    await db?.close();
  });
  beforeEach(async () => {
    await resetOrgs(ORG);
    await seedWorkflowOrg(ORG, [{ userId: USER }], AGENT);
    await publishDemoWorkflow(db, ORG);
  });

  function worker(holder: string, opts: { crashAfterOutputOf?: string; slowStageMs?: number; workLog: string[]; errors: unknown[] }): WorkflowRuntimeService {
    let crashed = false;
    return createWorkflowRuntime(db, pool, {
      holder,
      leaseTtlMs: TTL,
      onRunError: (_id, e) => opts.errors.push(e),
      hooks: {
        beforeStageWork: async (stageId) => {
          opts.workLog.push(stageId);
          if (opts.slowStageMs) await sleep(opts.slowStageMs);
        },
        afterStageOutput: (stageId) => {
          if (!crashed && stageId === opts.crashAfterOutputOf) {
            crashed = true;
            throw new SimulatedCrash(`worker ${holder} died after writing ${stageId} output`);
          }
        },
      },
    }).service;
  }

  async function stageOutputs(instanceId: string) {
    const r = await asApp(ORG, (c) =>
      c.query<{ stage_id: string; attempt: number }>(
        "SELECT stage_id, attempt FROM workflow_stage_outputs WHERE instance_id = $1 ORDER BY created_at",
        [instanceId],
      ),
    );
    return r.rows;
  }

  it("renews its lease while running: a run far longer than the lease TTL still completes (no lease loss, no stuck 'running')", async () => {
    const log: string[] = [];
    const errors: unknown[] = [];
    const w = worker("worker-slow", { slowStageMs: TTL * 2, workLog: log, errors });
    const started = await w.start(ORG, USER, DEMO_WORKFLOW_KEY, { agentId: AGENT, requestId: "req-wf03-slow-1", input: { topic: "长阶段" } });
    threads.push(started.instanceId);
    await w.drain();
    expect(errors).toEqual([]);
    expect(log).toEqual(["collect", "draft", "finalize"]);
    expect((await w.get(ORG, USER, started.instanceId)).status).toBe("succeeded");
  }, 30_000);

  it("resumes from the last checkpoint after a crash between output write and checkpoint advance: no stage redone, no duplicate events", async () => {
    const aLog: string[] = [];
    const aErrors: unknown[] = [];
    const a = worker("worker-a", { crashAfterOutputOf: "draft", workLog: aLog, errors: aErrors });
    const started = await a.start(ORG, USER, DEMO_WORKFLOW_KEY, { agentId: AGENT, requestId: "req-wf03-crash-1", input: { topic: "季度复盘" } });
    threads.push(started.instanceId);
    await a.drain();

    expect(aErrors).toHaveLength(1);
    expect(aErrors[0]).toBeInstanceOf(SimulatedCrash);
    expect(aLog).toEqual(["collect", "draft"]);
    expect((await a.get(ORG, USER, started.instanceId)).status).toBe("running");
    // draft 的业务行已落库……
    expect((await stageOutputs(started.instanceId)).map((r) => r.stage_id)).toEqual(["collect", "draft"]);
    // ……但 checkpoint 只推进到 collect（节点未返回）；checkpoint 里只有 outputId 指针，没有业务内容。
    const saver = createWorkflowCheckpointerFactory(pool).saverFor(DEMO_WORKFLOW_GRAPH_REF);
    const tuple = await saver.getTuple({ configurable: { thread_id: started.instanceId } });
    const channelOutputs = (tuple?.checkpoint.channel_values as { outputs?: Record<string, string> }).outputs ?? {};
    expect(Object.keys(channelOutputs)).toEqual(["collect"]);
    expect(typeof channelOutputs.collect).toBe("string");
    const ns = await asOwner((c) =>
      c.query<{ checkpoint_ns: string }>(`SELECT DISTINCT checkpoint_ns FROM ${WORKFLOW_CHECKPOINT_SCHEMA}.checkpoints WHERE thread_id = $1`, [started.instanceId]),
    );
    expect(ns.rows).toEqual([{ checkpoint_ns: DEMO_WORKFLOW_GRAPH_REF }]);

    const bLog: string[] = [];
    const bErrors: unknown[] = [];
    const b = worker("worker-b", { workLog: bLog, errors: bErrors });
    const current = await b.get(ORG, USER, started.instanceId);
    // A 的 lease 未过期：B 抢不到（E2）
    await expect(b.resume(ORG, USER, started.instanceId, { expectedStateVersion: current.stateVersion, requestId: "req-wf03-resume-early" }))
      .rejects.toMatchObject({ code: "lease_conflict" });
    await sleep(TTL + 200);
    const resumed = await b.resume(ORG, USER, started.instanceId, { expectedStateVersion: current.stateVersion, requestId: "req-wf03-resume-1" });
    expect(resumed.instanceId).toBe(started.instanceId);
    await b.drain();

    expect(bErrors).toEqual([]);
    expect(bLog).toEqual(["finalize"]); // collect 由 checkpoint 跳过；draft 命中既有产出行
    const final = await b.get(ORG, USER, started.instanceId);
    expect(final.status).toBe("succeeded");
    expect(final.stages.map((s) => [s.stageId, s.status, s.outputs.length])).toEqual([
      ["collect", "succeeded", 1],
      ["draft", "succeeded", 1],
      ["finalize", "succeeded", 1],
    ]);
    expect((await stageOutputs(started.instanceId)).map((r) => `${r.stage_id}#${r.attempt}`)).toEqual(["collect#1", "draft#1", "finalize#1"]);

    const events = await eventSeqs(ORG, started.instanceId);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1)); // I-10：1..N 无空洞无重复
    for (const stage of ["collect", "draft", "finalize"]) {
      for (const type of ["stage_started", "stage_output_written", "stage_succeeded"]) {
        expect(events.filter((e) => e.stage_id === stage && e.type === type), `${stage}/${type}`).toHaveLength(1);
      }
    }
    // 每阶段：产出事件先于成功事件
    for (const stage of ["collect", "draft", "finalize"]) {
      const written = events.find((e) => e.stage_id === stage && e.type === "stage_output_written")!;
      const ok = events.find((e) => e.stage_id === stage && e.type === "stage_succeeded")!;
      expect(written.seq).toBeLessThan(ok.seq);
    }
    expect(events.at(-1)).toMatchObject({ type: "status_changed", state_version: final.stateVersion });
    expect(final.lastSeq).toBe(events.length);

    // A 的旧 epoch：任何副作用前被拦（E2）
    await expect(new PgWorkflowLeaseStore(db).assertLease({ orgId: ORG, instanceId: started.instanceId, holder: "worker-a", epoch: 1 }))
      .rejects.toBeInstanceOf(WorkflowLeaseLostError);
  }, 60_000);

  it("E11: a lost checkpoint after progress puts the instance in needs_attention; projection still shows completed stages from business rows", async () => {
    const errors: unknown[] = [];
    const a = worker("worker-a2", { crashAfterOutputOf: "draft", workLog: [], errors });
    const started = await a.start(ORG, USER, DEMO_WORKFLOW_KEY, { agentId: AGENT, requestId: "req-wf03-crash-2", input: { topic: "丢失" } });
    threads.push(started.instanceId);
    await a.drain();
    expect(errors[0]).toBeInstanceOf(SimulatedCrash);
    for (const t of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) {
      await asOwner((c) => c.query(`DELETE FROM ${WORKFLOW_CHECKPOINT_SCHEMA}.${t} WHERE thread_id = $1`, [started.instanceId]));
    }
    await sleep(TTL + 200);
    const bLog: string[] = [];
    const b = worker("worker-b2", { workLog: bLog, errors });
    const v = (await b.get(ORG, USER, started.instanceId)).stateVersion;
    await b.resume(ORG, USER, started.instanceId, { expectedStateVersion: v, requestId: "req-wf03-resume-2" });
    await b.drain();
    expect(bLog).toEqual([]); // 不从空 checkpoint 编造状态重跑
    const p = await b.get(ORG, USER, started.instanceId);
    expect(p.status).toBe("needs_attention");
    expect(p.reasonCode).toBe("checkpoint_missing");
    expect(p.stages.find((s) => s.stageId === "collect")).toMatchObject({ status: "succeeded" });
    expect(p.stages.find((s) => s.stageId === "collect")!.outputs).toHaveLength(1);
  }, 60_000);

  it("I-8: the projection / event read paths never reference checkpoint channel_values", () => {
    const files = [
      ...walk(join(API, "src/application/workflow")),
      join(API, "src/infrastructure/workflow/pg-workflow-event-store.ts"),
      join(API, "src/interface/controllers/workflow-runtime.controller.ts"),
    ];
    // 只查代码：注释里说明「不读 channel_values」本身不算引用
    const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const f of files) expect(code(f), f).not.toMatch(/channel_values/);
  });
});
