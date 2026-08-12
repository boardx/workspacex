/**
 * F162 —— `LimitRuleRepository` on PostgreSQL。
 *
 * ## 每条规则的用量是**按它自己的窗口**算的
 *
 * `listRules` 不是「查一次本月用量再套到所有规则上」。一条按 5 小时的规则和一条按月的
 * 规则，分母不同、分子也必须不同；用同一个分子去除不同的分母，两个百分比会同时显示在
 * 同一屏上且互相矛盾。所以聚合子查询按行内的 `window_kind` 选时间起点。
 *
 * ## `scope_kind` 决定用量怎么归集
 *
 * · `member` → 该 userId 的用量；`model` → 该模型的全组织用量；
 * · `role` / `team` → 该角色/团队下所有成员的用量之和（JOIN `org_memberships`）；
 * · `agent` → **今天算不出来**：`token_usage_events` 没有 agent 维度（F159 记的是
 *   org/user/model/run，run 上虽然有 agent_id，但那是 `agent_runs` 的列，而计量事件的
 *   `run_id` 在 run 被清理后会变 NULL，按它 JOIN 会让历史用量凭空缩水）。
 *   ⇒ 具名缺口 **`GAP-LIMIT-AGENT-SCOPE`**：`agent` 范围的规则可以创建、可以显示，
 *   但 `observedTokens` 恒为 0，界面据此显示「该范围暂无计量维度」。
 *   **不假装它是 0% 用量**——那会让一条永远不会触发的规则看起来在正常工作。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import {
  DegradeTargetRequiredError, LimitRuleNotFoundError,
  type CreateLimitRuleInput, type LimitEventRow, type LimitRuleRepository, type LimitRuleRow,
  type LimitScopeKind, type LimitAction, type LimitWindowKind, type UpdateLimitRuleInput,
} from "../../application/auth/token-quota-ports";

const num = (v: string | number | null): number => (v === null ? 0 : Number(v));

/** 窗口 → SQL 时间起点。`Record<...>` 让漏掉新窗口成为编译错误。 */
const WINDOW_START: Record<LimitWindowKind, string> = {
  hour: "now() - interval '1 hour'",
  day: "date_trunc('day', now())",
  week: "date_trunc('week', now())",
  month: "date_trunc('month', now())",
};

interface RuleDbRow {
  id: string; scope_kind: string; scope_ref: string; model_id: string | null;
  window_kind: string; threshold_tokens: string; action: string;
  degrade_to_model_id: string | null; enabled: boolean;
}

export class PgLimitRuleRepository implements LimitRuleRepository {
  constructor(private readonly db: DatabasePort) {}

  async listRules(orgId: OrgId): Promise<readonly LimitRuleRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const rules = await s.query<RuleDbRow>(
        `SELECT id, scope_kind, scope_ref, model_id, window_kind, threshold_tokens,
                action, degrade_to_model_id, enabled
           FROM limit_rules WHERE org_id = $1 ORDER BY created_at ASC, id ASC`,
        [orgId],
      );

      const out: LimitRuleRow[] = [];
      for (const r of rules.rows) {
        const since = WINDOW_START[r.window_kind as LimitWindowKind];
        // 每条规则一次聚合。规则数量是管理员手配的（十条量级），不是 N+1 的那个 N。
        const modelPredicate = r.model_id === null ? "" : " AND e.model_id = $3";
        const params: unknown[] = [orgId, r.scope_ref];
        if (r.model_id !== null) params.push(r.model_id);

        let sql: string | null = null;
        switch (r.scope_kind as LimitScopeKind) {
          case "member":
            sql = `SELECT SUM(e.tokens_total) AS total FROM token_usage_events e
                    WHERE e.org_id = $1 AND e.user_id = $2
                      AND e.occurred_at >= ${since}${modelPredicate}`;
            break;
          case "model":
            sql = `SELECT SUM(e.tokens_total) AS total FROM token_usage_events e
                    WHERE e.org_id = $1 AND e.model_id = $2
                      AND e.occurred_at >= ${since}`;
            break;
          case "role":
            sql = `SELECT SUM(e.tokens_total) AS total FROM token_usage_events e
                     JOIN org_memberships m ON m.user_id = e.user_id AND m.org_id = e.org_id
                    WHERE e.org_id = $1 AND m.org_role = $2
                      AND e.occurred_at >= ${since}${modelPredicate}`;
            break;
          case "team":
            sql = `SELECT SUM(e.tokens_total) AS total FROM token_usage_events e
                     JOIN org_memberships m ON m.user_id = e.user_id AND m.org_id = e.org_id
                    WHERE e.org_id = $1 AND m.team_id = $2
                      AND e.occurred_at >= ${since}${modelPredicate}`;
            break;
          case "agent":
            // GAP-LIMIT-AGENT-SCOPE（见文件头）：没有 agent 维度可归集，恒 0，不假装。
            sql = null;
            break;
        }

        const observed = sql === null
          ? 0
          : num((await s.query<{ total: string | null }>(sql, params)).rows[0]?.total ?? null);

        out.push({
          ruleId: r.id,
          scopeKind: r.scope_kind as LimitScopeKind,
          scopeRef: r.scope_ref,
          modelId: r.model_id,
          windowKind: r.window_kind as LimitWindowKind,
          thresholdTokens: num(r.threshold_tokens),
          action: r.action as LimitAction,
          degradeToModelId: r.degrade_to_model_id,
          enabled: r.enabled,
          observedTokens: observed,
        });
      }
      return out;
    });
  }

  async createRule(orgId: OrgId, input: CreateLimitRuleInput): Promise<string> {
    // 应用层先判一次，让它是一个明确的拒绝而不是一条 CHECK 违反的 500；
    // 数据库那条 `limit_rules_degrade_target_check` 是第二道，防的是绕过这一层的写入。
    if (input.action === "degrade" && input.degradeToModelId === null) {
      throw new DegradeTargetRequiredError();
    }
    const id = randomUUID();
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO limit_rules
           (id, org_id, scope_kind, scope_ref, model_id, window_kind, threshold_tokens,
            action, degrade_to_model_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id, orgId, input.scopeKind, input.scopeRef, input.modelId, input.windowKind,
          input.thresholdTokens, input.action,
          input.action === "degrade" ? input.degradeToModelId : null,
        ],
      );
    });
    return id;
  }

  async updateRule(orgId: OrgId, ruleId: string, input: UpdateLimitRuleInput): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      const existing = await s.query<{ action: string; degrade_to_model_id: string | null }>(
        "SELECT action, degrade_to_model_id FROM limit_rules WHERE org_id=$1 AND id=$2 FOR UPDATE",
        [orgId, ruleId],
      );
      if (existing.rows.length === 0) throw new LimitRuleNotFoundError();

      const nextAction = (input.action ?? existing.rows[0]!.action) as LimitAction;
      const nextTarget = input.degradeToModelId !== undefined
        ? input.degradeToModelId
        : existing.rows[0]!.degrade_to_model_id;
      // 「改成降级但没给目标」与「创建时没给目标」是同一个错误，不因为它是 PATCH 就放行。
      if (nextAction === "degrade" && nextTarget === null) throw new DegradeTargetRequiredError();

      await s.query(
        `UPDATE limit_rules
            SET threshold_tokens = COALESCE($3, threshold_tokens),
                action = $4,
                degrade_to_model_id = $5,
                enabled = COALESCE($6, enabled),
                updated_at = now()
          WHERE org_id = $1 AND id = $2`,
        [
          orgId, ruleId, input.thresholdTokens ?? null, nextAction,
          nextAction === "degrade" ? nextTarget : null,
          input.enabled ?? null,
        ],
      );
    });
  }

  async deleteRule(orgId: OrgId, ruleId: string): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      const res = await s.query<{ id: string }>(
        "DELETE FROM limit_rules WHERE org_id=$1 AND id=$2 RETURNING id", [orgId, ruleId],
      );
      if (res.rows.length === 0) throw new LimitRuleNotFoundError();
    });
  }

  async listEvents(orgId: OrgId, limit: number): Promise<readonly LimitEventRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const res = await s.query<{
        id: string; occurred_at: Date; rule_id: string | null; scope_kind: string;
        subject_ref: string; action_taken: string; observed_tokens: string; threshold_tokens: string;
      }>(
        `SELECT id, occurred_at, rule_id, scope_kind, subject_ref, action_taken,
                observed_tokens, threshold_tokens
           FROM limit_events WHERE org_id = $1
          ORDER BY occurred_at DESC, id DESC LIMIT $2`,
        [orgId, limit],
      );
      return res.rows.map((r) => ({
        eventId: r.id,
        occurredAt: r.occurred_at.toISOString(),
        // 规则已删时 rule_id 是 NULL——事件仍然是真的，用空串表达「那条规则已不在」，
        // 而不是把整行藏起来（藏起来就成了「上个月没发生过」）。
        ruleId: r.rule_id ?? "",
        scopeKind: r.scope_kind as LimitScopeKind,
        subjectRef: r.subject_ref,
        actionTaken: r.action_taken as LimitAction,
        observedTokens: num(r.observed_tokens),
        thresholdTokens: num(r.threshold_tokens),
      }));
    });
  }

  async recordEvent(
    orgId: OrgId,
    input: {
      readonly ruleId: string; readonly scopeKind: LimitScopeKind; readonly subjectRef: string;
      readonly actionTaken: LimitAction; readonly observedTokens: number;
      readonly thresholdTokens: number;
    },
  ): Promise<string> {
    const id = randomUUID();
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO limit_events
           (id, org_id, rule_id, scope_kind, subject_ref, action_taken,
            observed_tokens, threshold_tokens)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id, orgId, input.ruleId, input.scopeKind, input.subjectRef, input.actionTaken,
          input.observedTokens, input.thresholdTokens,
        ],
      );
    });
    return id;
  }
}
