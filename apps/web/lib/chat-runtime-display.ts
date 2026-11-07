import { wave2Runtime } from "@repo/contracts";
import { describeCopilotkitV2RunError } from "./copilotkit-v2-error-copy";
import { describePlanFailureReason } from "./plan-control-copy";
import { TRANSPORT_ERROR_TEXT } from "./chat-runtime-labels";
import { phaseLabelForKind, phaseLabelForToolName, phaseLabelForCallSkillArgs } from "./agent-run-phase";
import { translate, type MessageKey, type MessageParams } from "./i18n/messages";
import type { Locale } from "./i18n/locale";

export type ChatOwnedMessage = { readonly key: MessageKey; readonly params?: MessageParams };
export type ChatDisplayText = string | ChatOwnedMessage | { readonly kind: "owned-run-error"; readonly text: string };

// Only producers that already use the closed run-error formatter can attach this
// provenance. Plain caller Error.message values never enter the projection.
export const ownedRunError = (text: string): ChatDisplayText => ({ kind: "owned-run-error", text });
const runErrors = new Map<string, { code: (typeof wave2Runtime.AgentRunError.options)[number]; reason: (typeof wave2Runtime.AgentRunFailureReason.options)[number] | null }>();
for (const code of wave2Runtime.AgentRunError.options) {
  for (const reason of [null, ...wave2Runtime.AgentRunFailureReason.options]) {
    runErrors.set(describeCopilotkitV2RunError(code, reason), { code, reason });
  }
}
const transportKeys = new Map<string, MessageKey>(
  (Object.keys(TRANSPORT_ERROR_TEXT) as (keyof typeof TRANSPORT_ERROR_TEXT)[]).map(code => [TRANSPORT_ERROR_TEXT[code], `chatComposer.runtime.transport.${code}`]),
);
export function renderChatDisplayText(value: ChatDisplayText, locale: Locale): string {
  if (typeof value === "string") return value;
  if ("key" in value) return translate(locale, value.key, value.params);
  if (locale === "zh-CN") return value.text;
  const run = runErrors.get(value.text);
  if (run) return describePlanFailureReason(run.code, run.reason, "cloud", locale);
  const transport = transportKeys.get(value.text);
  if (transport) return translate(locale, transport);
  if (value.text === describeCopilotkitV2RunError(null)) return translate(locale, "chatComposer.runtime.unknown");
  if (value.text === describeCopilotkitV2RunError("UNREGISTERED_ERROR")) return translate(locale, "chatComposer.runtime.generic");
  return value.text;
}

const phaseKeys = new Map<string, MessageKey>();
for (const kind of ["accepted", "context_built", "model_called", "chat_writeback", "unknown"] as const) {
  phaseKeys.set(phaseLabelForKind(kind), `chatComposer.runtime.kind.${kind}`);
}
for (const tool of ["list_org_skills", "call_skill", "ls", "glob", "grep", "read_file", "write_file", "edit_file"] as const) {
  phaseKeys.set(phaseLabelForToolName(tool), `chatComposer.runtime.tool.${tool}`);
}
phaseKeys.set(phaseLabelForToolName(null), "chatComposer.runtime.toolMissing");
for (const key of ["restoring", "replying", "running", "queued", "plan", "writeback", "paused", "approval"] as const) {
  const message: MessageKey = `chatComposer.runtime.${key}`;
  phaseKeys.set(translate("zh-CN", message), message);
}
const namedPhases = [
  { template: phaseLabelForToolName("{name}"), key: "chatComposer.runtime.toolNamed" },
  { template: phaseLabelForCallSkillArgs("{name}"), key: "chatComposer.runtime.skillNamed" },
] as const;

/** The boolean is explicit producer provenance, not a Han-text heuristic. */
export function renderChatPhase(label: string | null, owned: boolean | undefined, locale: Locale): string | null {
  if (label === null || !owned || locale === "zh-CN") return label;
  const key = phaseKeys.get(label);
  if (key) return translate(locale, key);
  for (const { template, key: message } of namedPhases) {
    const index = template.indexOf("{name}");
    const prefix = template.slice(0, index), suffix = template.slice(index + "{name}".length);
    if (label.startsWith(prefix) && label.endsWith(suffix)) {
      return translate(locale, message, { name: label.slice(prefix.length, label.length - suffix.length) });
    }
  }
  return label;
}

export function restoredRunPhaseLabel(status: string | null, isRestoring: boolean): string | null {
  if (isRestoring) return translate("zh-CN", "chatComposer.runtime.restoring");
  const keys: Readonly<Record<string, MessageKey>> = {
    running: "chatComposer.runtime.running", queued: "chatComposer.runtime.queued",
    awaiting_plan_confirmation: "chatComposer.runtime.plan", writeback_pending: "chatComposer.runtime.writeback",
    paused: "chatComposer.runtime.paused", awaiting_tool_permission: "chatComposer.runtime.approval",
  };
  const key = status === null ? undefined : keys[status];
  return key ? translate("zh-CN", key) : null;
}
