/**
 * WF02 —— checkpointer 工厂（I-9）+ 统一 receipt begin/finalize 幂等（I-6/I-7）。真实 PostgreSQL。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import {
  WORKFLOW_CHECKPOINT_SCHEMA,
  createWorkflowCheckpointerFactory,
} from "../../src/infrastructure/workflow/workflow-checkpointer-factory";
import { PgWorkflowReceiptStore } from "../../src/infrastructure/workflow/pg-workflow-receipt-store";
import { WorkflowUseCaseError } from "../../src/application/workflow/workflow-errors";
import type { WorkflowReceiptKey } from "../../src/application/workflow/workflow-ports";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { seedWorkflowInstance } from "./wf02-fixtures";

const API = fileURLToPath(new URL("../..", import.meta.url));
const ORG = "org-wf02-ckpt";
const OTHER = "org-wf02-ckpt-other";
const THREADS = ["wi-wf02-ckpt-1", "wi-wf02-ckpt-2"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** 引导式研究 / 数字访谈的旧 saver：WF07 迁移引导式研究；数字访谈迁移属 Stage 2（02 号文件 R6「不包含」）。 */
const LEGACY_SAVERS = new Set([
  "src/infrastructure/research/langgraph-guided-research-runtime.ts",
  "src/infrastructure/interview/workflow/langgraph-digital-interview-runtime.ts",
]);

describe("WF02 unique checkpointer factory (I-9)", () => {
  it("`new PostgresSaver` appears in application|infrastructure only in the factory (plus the listed legacy runtimes)", () => {
    const hits = ["src/application", "src/infrastructure"]
      .flatMap((d) => walk(join(API, d)))
      .filter((p) => /new\s+PostgresSaver\s*\(/.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(API.length).replace(/^\//, ""));
    const fresh = hits.filter((h) => !LEGACY_SAVERS.has(h));
    expect(fresh).toEqual(["src/infrastructure/workflow/workflow-checkpointer-factory.ts"]);
    const src = readFileSync(join(API, "src/infrastructure/workflow/workflow-checkpointer-factory.ts"), "utf8");
    expect(src.match(/new\s+PostgresSaver\s*\(/g)).toHaveLength(1);
    // workflow 运行时不反向依赖 interview 目录（R3-12）
    for (const f of walk(join(API, "src/infrastructure/workflow"))) expect(readFileSync(f, "utf8")).not.toMatch(/interview\//);
  });

  describe("against PostgreSQL", () => {
    let pool: pg.Pool;
    beforeAll(async () => {
      ensureDatabase();
      await migrateOnce();
      pool = new pg.Pool({ ...appConfig(), max: 3 });
    }, 60_000);
    afterAll(async () => {
      await asOwner((c) => c.query(`DELETE FROM ${WORKFLOW_CHECKPOINT_SCHEMA}.checkpoints WHERE thread_id = ANY($1)`, [THREADS]));
      await asOwner((c) => c.query(`DELETE FROM ${WORKFLOW_CHECKPOINT_SCHEMA}.checkpoint_blobs WHERE thread_id = ANY($1)`, [THREADS]));
      await asOwner((c) => c.query(`DELETE FROM ${WORKFLOW_CHECKPOINT_SCHEMA}.checkpoint_writes WHERE thread_id = ANY($1)`, [THREADS]));
      await pool?.end();
    });

    const State = Annotation.Root({ n: Annotation<number>() });
    const graph = () =>
      new StateGraph(State).addNode("step", (s) => ({ n: s.n + 1 })).addEdge(START, "step").addEdge("step", END);

    it("writes checkpoints to langgraph_workflow with checkpoint_ns=key:version and thread_id=instanceId over one shared saver", async () => {
      const factory = createWorkflowCheckpointerFactory(pool);
      const v1 = factory.saverFor("research-to-brief:1");
      const v2 = factory.saverFor("research-to-brief:2");
      expect(factory.saverFor("research-to-brief:1")).toBe(v1);
      expect(v1.delegate).toBe(v2.delegate); // 一个 PostgresSaver、一个池
      expect(v1.checkpointNamespace).toBe("research-to-brief:1");
      expect(factory.configFor(THREADS[0]!)).toEqual({ configurable: { thread_id: THREADS[0] } });

      const out1 = await graph().compile({ checkpointer: v1 }).invoke({ n: 1 }, factory.configFor(THREADS[0]!));
      expect(out1.n).toBe(2);
      await graph().compile({ checkpointer: v2 }).invoke({ n: 10 }, factory.configFor(THREADS[1]!));

      // 独立查库（app_rw，生产用的身份）
      const rows = await asApp(null, (c) =>
        c.query<{ thread_id: string; checkpoint_ns: string }>(
          `SELECT DISTINCT thread_id, checkpoint_ns FROM langgraph_workflow.checkpoints WHERE thread_id = ANY($1) ORDER BY thread_id`,
          [THREADS],
        ),
      );
      expect(rows.rows).toEqual([
        { thread_id: THREADS[0], checkpoint_ns: "research-to-brief:1" },
        { thread_id: THREADS[1], checkpoint_ns: "research-to-brief:2" },
      ]);
      // 旧 schema 没有新写入
      const legacy = await asOwner((c) =>
        c.query("SELECT 1 FROM langgraph_interview.checkpoints WHERE thread_id = ANY($1)", [THREADS]),
      );
      expect(legacy.rows).toHaveLength(0);

      // 恢复：同 ns 读得到，别的 ns 读不到（版本互不串）
      expect((await v1.getTuple(factory.configFor(THREADS[0]!)))?.checkpoint.channel_values).toMatchObject({ n: 2 });
      expect(await v2.getTuple(factory.configFor(THREADS[0]!))).toBeUndefined();
      expect(pool.totalCount).toBeLessThanOrEqual(3);
    });

    it("rejects a graphRef that is not key:version", () => {
      const factory = createWorkflowCheckpointerFactory(pool);
      expect(() => factory.saverFor("research-to-brief")).toThrow();
      expect(() => factory.saverFor("Bad:1")).toThrow();
      expect(() => factory.configFor("")).toThrow();
    });
  });
});

describe("WF02 unified receipt begin/finalize (I-6/I-7)", () => {
  let db: PgDatabase;
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
  }, 60_000);
  afterAll(async () => {
    await resetOrgs(ORG, OTHER);
    await db?.close();
  });
  beforeEach(async () => {
    await resetOrgs(ORG, OTHER);
    await seedOrg({ orgId: ORG, projectId: "proj-wf02-ckpt" });
    await seedOrg({ orgId: OTHER, projectId: "proj-wf02-ckpt-other" });
  });

  const key: WorkflowReceiptKey = { orgId: ORG, scope: "command", requestKey: "req-wf02-0001", fingerprint: "fp-a" };

  it("begin is idempotent, finalize keeps the first stable response, a different fingerprint is refused", async () => {
    const receipts = new PgWorkflowReceiptStore(db);
    await seedWorkflowInstance(ORG, "wi-1");
    expect(await receipts.begin(key)).toEqual({ kind: "begun" });
    // undefined 不是 JSON：显式拒绝，不漏裸 23514
    const bad = await receipts.finalize(key, { stableResponse: undefined, checkpointId: null, instanceId: null }).then(() => null, (e: unknown) => e);
    expect(String(bad)).toMatch(/JSON-serializable/);
    expect(await receipts.begin(key)).toEqual({ kind: "in_flight", instanceId: null });

    const first = { instanceId: "wi-1", status: "running", stateVersion: 1 };
    expect(await receipts.finalize(key, { stableResponse: first, checkpointId: "ck-1", instanceId: "wi-1" })).toEqual(first);
    // 重复 finalize：返回首次稳定响应，不覆盖
    expect(await receipts.finalize(key, { stableResponse: { other: true }, checkpointId: "ck-2", instanceId: "wi-2" })).toEqual(first);
    expect(await receipts.begin(key)).toEqual({ kind: "replay", stableResponse: first, checkpointId: "ck-1", instanceId: "wi-1" });

    const err = await receipts.begin({ ...key, fingerprint: "fp-b" }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(WorkflowUseCaseError);
    expect((err as WorkflowUseCaseError).code).toBe("idempotency_key_reused");

    // 同 requestKey 的 effect scope、他组织是独立 receipt
    expect(await receipts.begin({ ...key, scope: "effect" })).toEqual({ kind: "begun" });
    expect(await receipts.begin({ ...key, orgId: OTHER })).toEqual({ kind: "begun" });

    const rows = await asApp(ORG, (c) =>
      c.query("SELECT scope, status, fingerprint, stable_response FROM workflow_receipts WHERE request_key = $1 ORDER BY scope", [key.requestKey]),
    );
    expect(rows.rows).toEqual([
      { scope: "command", status: "finalized", fingerprint: "fp-a", stable_response: first },
      { scope: "effect", status: "begun", fingerprint: "fp-a", stable_response: null },
    ]);
  });

  it("concurrent begins on one key yield exactly one owner", async () => {
    const receipts = new PgWorkflowReceiptStore(db);
    const results = await Promise.all(Array.from({ length: 5 }, () => receipts.begin(key)));
    expect(results.filter((r) => r.kind === "begun")).toHaveLength(1);
  });

  it("the database refuses to rewrite a fingerprint or a finalized response (I-7)", async () => {
    const receipts = new PgWorkflowReceiptStore(db);
    await receipts.begin(key);
    await receipts.finalize(key, { stableResponse: { ok: 1 }, checkpointId: null, instanceId: null });
    await expect(
      db.withTenant(toOrgId(ORG), (s) => s.query("UPDATE workflow_receipts SET stable_response = '{\"ok\":2}'::jsonb WHERE request_key = $1", [key.requestKey])),
    ).rejects.toThrow(/immutable \(I-7\)/);
    await expect(
      db.withTenant(toOrgId(ORG), (s) => s.query("UPDATE workflow_receipts SET fingerprint = 'x' WHERE request_key = $1", [key.requestKey])),
    ).rejects.toThrow(/immutable \(I-7\)/);
    await expect(
      db.withTenant(toOrgId(ORG), (s) => s.query("DELETE FROM workflow_receipts WHERE request_key = $1", [key.requestKey])),
    ).rejects.toThrow(/permission denied/);
  });
});
