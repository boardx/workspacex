/**
 * AG06 真实模型缺口 —— 把本 run 钉住的 `escalationPolicy` 的**事项名**与**裁决人（人话）**注入 run 的
 * system 上下文。
 *
 * 为什么：`escalate_matter` 的网关只按 `matter` **精确匹配**策略里的规则决定是否挂起
 * （`decide-escalation.ts`）。工具描述只说「与本 Agent 的升级策略里的事项名一致」，而真实模型从来
 * 看不到策略本身——它只能猜事项名，猜错一个字就「未升级给任何人」。回环模型靠剧本绕开了这件事，
 * 真实模型绕不开。
 *
 * 纪律：运行时从钉住的版本快照读、按 run 拼接；**不回填** Agent 的 instructions（那是用户写的正文）。
 * 策略为空 / 解析失败 ⇒ 返回 `null`，system prompt 一个字都不变。
 */
import { EscalationPolicy } from "@repo/contracts/agent-role";
import type { z } from "zod";

type Target = z.infer<typeof EscalationPolicy>["rules"][number]["target"];

const TARGET_IN_PLAIN_WORDS: Record<Target, string> = {
  requester: "发起这次对话的人",
  project_owner: "所在项目的负责人",
  org_admin: "组织管理员",
};

export function buildEscalationPolicyContext(raw: unknown): string | null {
  const parsed = EscalationPolicy.safeParse(raw);
  if (!parsed.success || parsed.data.rules.length === 0) return null;
  const lines = parsed.data.rules.map((r) => `- 「${r.matter}」→ 由${TARGET_IN_PLAIN_WORDS[r.target]}裁决`);
  return [
    "## 升级策略（escalate_matter）",
    "遇到下列事项时，调用 `escalate_matter` 请人裁决，`matter` 必须**逐字**填写下面引号里的事项名之一（不要改写、不要加词）：",
    ...lines,
    "不在这张清单里的事项不会升级给任何人：职责内的自己处理，职责外的向用户说明并停止。",
    "调用后只有工具结果才代表真实结果——在收到结果前不要告诉用户「已升级」。",
  ].join("\n");
}
