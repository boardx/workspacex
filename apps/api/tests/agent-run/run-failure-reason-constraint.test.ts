/**
 * issue #3211 ① —— `agent_runs.failure_reason` 的 CHECK 取值集合与契约
 * `wave2Runtime.AgentRunFailureReason` 是**同一件事**。
 *
 * 本仓已五次因「同一事实声明在两处」出事故（AGENTS.md 那条 ⚠）。这里照
 * `message-multi-run.test.ts` ③ 的既有先例：读 `pg_constraint` 的真实定义，断言与 zod
 * 枚举**集合相等**，而不是分别手写两份再祈祷不漂移。任何一侧加/删一个取值，这条红。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wave2Runtime } from "@repo/contracts";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";

beforeAll(async () => {
  await ensureDatabase();
  await migrateOnce();
});
afterAll(async () => {});

describe("#3211 ① failure_reason 的取值域单一事实源", () => {
  it("agent_runs_failure_reason_check 与 AgentRunFailureReason 集合相等", async () => {
    const found = await asOwner((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='agent_runs'::regclass AND conname='agent_runs_failure_reason_check'`,
    ));
    expect(found.rows, "CHECK 约束必须存在 —— 没有它这一列就是自由文本").toHaveLength(1);
    const inConstraint = new Set(
      [...found.rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!),
    );
    expect([...inConstraint].sort()).toEqual([...wave2Runtime.AgentRunFailureReason.options].sort());
  });

  /**
   * ⚠ 这条刻意**求值真实的约束表达式**（从 `pg_constraint` 读回来，去掉 `CHECK ` 外壳，
   * 用 CTE 喂 `failure_reason`），而不是在测试里再抄一遍取值表再自己跟自己比——后者是
   * 本仓点名过的「断言从没执行」的假绿形态（`红 ≠ 跑过`）。
   */
  it("约束真的在拦：契约内的值通过，契约外的值为假", async () => {
    const found = await asOwner((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='agent_runs'::regclass AND conname='agent_runs_failure_reason_check'`,
    ));
    const expression = found.rows[0]!.def.replace(/^CHECK\s*/, "");
    const evaluate = async (value: string | null) => {
      const r = await asOwner((c) => c.query<{ ok: boolean | null }>(
        `WITH t(failure_reason) AS (VALUES ($1::text)) SELECT ${expression} AS ok FROM t`,
        [value],
      ));
      return r.rows[0]!.ok;
    };
    expect(await evaluate(null)).toBe(true);
    for (const allowed of wave2Runtime.AgentRunFailureReason.options) {
      expect(await evaluate(allowed), `${allowed} 必须被约束接受`).toBe(true);
    }
    expect(await evaluate("definitely_not_a_reason")).toBe(false);
    // 「模型没返回可用结果」这句用户可见文案本身**不是**一个成因取值——防的是有人
    // 图省事把文案当枚举写进来，让这一列又退化成自由文本。
    expect(await evaluate("MODEL_CALL_FAILED")).toBe(false);
  });
});
