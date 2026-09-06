import { AGENT_INTERRUPTS_TOOL_NAMES } from "@repo/contracts/agent-interrupts";

/**
 * issue #2842 —— 三个具名 HITL 虚拟工具的 args 归一化。
 *
 * 2026-09-06 本地真栈实测（qwen3.8-max）：模型给 `confirm_task_intent` 的
 * `assumptions` 不是数组，而是**一个 JSON 字符串** `"[\"…\", \"…\"]"`（工具调用的
 * args 本身是合法对象，只是这个字段被多编码了一层）。这份 args 经 TOOL_CALL_ARGS
 * 原样到前端后，`ConfirmIntentCard` 的 `args.assumptions.map` 直接抛
 * `TypeError: t.assumptions.map is not a function`，整页进错误边界——用户看到的是
 * 「页面出了点问题」，而不是审批卡。`fill_run_params.fields` / `choose_execution_option.
 * options` 同一形状风险。
 *
 * 归一化只做一件事：契约里声明为数组的字段若收到字符串，尝试 `JSON.parse`，解出数组
 * 才替换；`assumptions` 解不出时按行拆成非空字符串（模型偶尔给"1. …\n2. …"）。其它
 * 情况一律原样返回——这里不校验契约（契约校验在各自的消费点），只修"多编码一层"这一种
 * 已实测的畸形。不是这三个工具 ⇒ 原样返回。
 */
const ARRAY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  [AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent]: ["assumptions"],
  [AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams]: ["fields"],
  [AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption]: ["options"],
};

export function normalizeAgentInterruptArgs(toolName: string, args: unknown): unknown {
  const fields = ARRAY_FIELDS[toolName];
  if (fields === undefined || typeof args !== "object" || args === null || Array.isArray(args)) return args;
  const record = args as Record<string, unknown>;
  let changed = false;
  const out: Record<string, unknown> = { ...record };
  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "string") continue;
    const parsed = parseArray(value);
    if (parsed !== null) { out[field] = parsed; changed = true; continue; }
    if (field === "assumptions") {
      const lines = value.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, "").trim()).filter((l) => l !== "");
      if (lines.length > 0) { out[field] = lines; changed = true; }
    }
  }
  return changed ? out : args;
}

function parseArray(value: string): unknown[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
