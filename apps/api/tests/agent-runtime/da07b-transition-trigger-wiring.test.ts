/**
 * DA-07b 触发器接线的 real-db 反证（backend-gates 2026-08-22 红灯的复盘产物）。
 *
 * 那次红暴露了一个链条：20260822120000 用新名字建了触发器函数，但触发器仍指旧函数
 * ——awaiting_approval 的两条新边在 DB 层从未生效；而删除逃生口守卫的 %force% 扫描
 * 恰好命中孤儿函数名里的 en"force"，把 main 拦红。守卫误伤了名字，救了语义。
 *
 * 本文件把三件事钉死在真库上（不是 mock）：
 *   ① 孤儿函数已删（守卫不再红，且不许再回来）
 *   ② running → awaiting_approval 真的被触发器放行
 *   ③ awaiting_approval → running 之类未登记的边仍被拒（放行不是放开）
 */
import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

// 全套种子照抄 agent-run-context-snapshot.test.ts 的既有模式（seedOrg 带 projectId、
// addChatThread 建线程）——本文件只关心触发器行为，不重新发明种子路径。
const ORG = "org-da07b-wiring";
const PROJECT = "proj-da07b-wiring";
const ACTOR = "actor-da07b";

beforeAll(async () => {
  await ensureDatabase();
  await migrateOnce();
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
});

async function insertRun(status: "running" | "queued" = "running"): Promise<string> {
  const runId = randomUUID();
  const threadId = randomUUID();
  const messageId = randomUUID();
  await addChatThread({ orgId: ORG, id: threadId, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
  await addChatMessage({ orgId: ORG, id: messageId, threadId, authorId: ACTOR, body: "hitl wiring probe" });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
         skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,'deep-agent','m',$7)`,
      [runId, ORG, threadId, messageId, randomUUID(), randomUUID(), status],
    ),
  );
  return runId;
}

async function setStatus(runId: string, status: string): Promise<void> {
  await asApp(ORG, (c) => c.query(`UPDATE agent_runs SET status = $2 WHERE id = $1`, [runId, status]));
}

describe("DA-07b 状态迁移触发器接线（real db）", () => {
  it("① 孤儿函数 agent_runs_enforce_status_transition 已删——它撞守卫的 %force% 且从未被触发器引用", async () => {
    const rows = await asOwner(async (c) => {
      const r = await c.query<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname = 'agent_runs_enforce_status_transition'`,
      );
      return r.rows;
    });
    expect(rows).toEqual([]);
  });

  it("触发器指向 wave2_agent_run_transition（单一事实：函数体在最新 migration 里以旧名重建）", async () => {
    const rows = await asOwner(async (c) => {
      const r = await c.query<{ def: string }>(
        `SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger
          WHERE tgname = 'agent_runs_transition_trg' AND NOT tgisinternal`,
      );
      return r.rows.map((x) => x.def).join("\n");
    });
    expect(rows).toContain("wave2_agent_run_transition()");
  });

  it("② running → awaiting_approval 被放行（这就是那次接线 bug 会拦死的边）", async () => {
    const runId = await insertRun("running");
    await expect(setStatus(runId, "awaiting_approval")).resolves.not.toThrow();
  });

  it("awaiting_approval → queued 被放行（人批准重新入队）", async () => {
    const runId = await insertRun("running");
    await setStatus(runId, "awaiting_approval");
    await expect(setStatus(runId, "queued")).resolves.not.toThrow();
  });

  it("③ queued → awaiting_approval 仍被拒——中断只可能发生在执行中，放行不是放开", async () => {
    const runId = await insertRun("queued");
    await expect(setStatus(runId, "awaiting_approval")).rejects.toThrow(/may not move/);
  });
});

describe("UX-9 D4 存储面（real db）：pending_decision 三态与 pending_edited_args", () => {
  it("awaiting_approval → queued + pending_decision='edit' + 改后参数：一条 UPDATE 全过", async () => {
    const runId = await insertRun("running");
    await setStatus(runId, "awaiting_approval");
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `UPDATE agent_runs SET status='queued', pending_decision='edit', pending_edited_args=$2 WHERE id=$1`,
          [runId, JSON.stringify({ skill: "safe" })],
        ),
      ),
    ).resolves.not.toThrow();
    const row = await asApp(ORG, async (c) => {
      const r = await c.query<{ pending_decision: string; pending_edited_args: string }>(
        `SELECT pending_decision, pending_edited_args FROM agent_runs WHERE id=$1`, [runId],
      );
      return r.rows[0];
    });
    expect(row).toEqual({ pending_decision: "edit", pending_edited_args: JSON.stringify({ skill: "safe" }) });
  });

  it("CHECK 只放行 approve/edit——'respond' 之类没接的决策在 DB 层就被拒", async () => {
    const runId = await insertRun("running");
    await setStatus(runId, "awaiting_approval");
    await expect(
      asApp(ORG, (c) =>
        c.query(`UPDATE agent_runs SET status='queued', pending_decision='respond' WHERE id=$1`, [runId]),
      ),
    ).rejects.toThrow(/pending_decision_check/);
  });
});
