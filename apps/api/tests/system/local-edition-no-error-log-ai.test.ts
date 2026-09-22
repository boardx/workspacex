/**
 * 2026-09-22 —— 本地版不跑「系统异常 AI 研判」这个元任务。
 *
 * 取证：用户那台机器 `~/Library/Application Support/WorkspaceX/local/logs/api.log` 里有
 * 数十条 `error log summarization timed out`。它给运维团队看，而本机只有用户一个人；
 * 每条异常占用同一个本地模型 30 s，并发上限 5——异常成串出现时会把用户正在等的回答
 * 挤到后面。
 *
 * 这份测试打在**决策**上（`errorLogAiDepsForEdition`）以及**行为**上（不注入 ⇒ 一次
 * 模型调用都不发生）。组合根里那一行调用本身不在测试里——它是一行 wiring，
 * 但它调用的正是这里被钉住的这个函数，且 `record()` 的行为反证在下面第二条。
 */
import { expect, it, vi } from "vitest";
import { PgErrorLogWriter, errorLogAiDepsForEdition } from "../../src/infrastructure/logging/pg-error-log-writer";
import type { PgErrorLogWriterAiDeps } from "../../src/infrastructure/logging/pg-error-log-writer";

const aiDeps = {
  model: { complete: vi.fn(async () => ({ text: '{"title":"t","summary":"s"}' })) },
  summaryModel: { provider: "ollama", modelId: "qwen3.5:4b" },
  log: vi.fn(),
} as unknown as PgErrorLogWriterAiDeps;

it("drops the AI-summary dependency in the local edition and keeps it in the cloud", () => {
  expect(errorLogAiDepsForEdition("local", aiDeps)).toBeUndefined();
  expect(errorLogAiDepsForEdition("cloud", aiDeps)).toBe(aiDeps);
});

/** 真实数据库不参与：`record()` 只需要 `INSERT ... RETURNING id` 的形状。 */
function fakeDb(): { db: unknown; queries: string[] } {
  const queries: string[] = [];
  const session = { query: async (sql: string) => { queries.push(sql); return { rows: [{ id: "1" }] }; } };
  return { db: { withoutTenant: async (f: (s: unknown) => unknown) => f(session) }, queries };
}

it("records the exception without a single model call when the deps were dropped", async () => {
  const { db, queries } = fakeDb();
  const model = aiDeps.model as unknown as { complete: ReturnType<typeof vi.fn> };
  model.complete.mockClear();
  const writer = new PgErrorLogWriter(
    db as never, db as never,
    errorLogAiDepsForEdition("local", aiDeps),
  );
  await writer.record({ traceId: "t-1", msg: "boom", detail: { name: "Error" } });
  // 异常照旧落库——关掉的是摘要，不是记录
  expect(queries.some((q) => q.includes("INSERT INTO error_logs"))).toBe(true);
  // 反证：同一次 record 在 cloud 纪律下会发起一次模型调用（见下）
  expect(model.complete).not.toHaveBeenCalled();
});

it("cloud edition still summarizes -- the counterproof for the test above", async () => {
  const { db } = fakeDb();
  const model = aiDeps.model as unknown as { complete: ReturnType<typeof vi.fn> };
  model.complete.mockClear();
  const writer = new PgErrorLogWriter(db as never, db as never, errorLogAiDepsForEdition("cloud", aiDeps));
  await writer.record({ traceId: "t-2", msg: "boom", detail: { name: "Error" } });
  // 摘要是 fire-and-forget，`record()` 不等它——给微任务队列一次机会
  await new Promise((r) => setTimeout(r, 0));
  expect(model.complete).toHaveBeenCalledTimes(1);
});
