import { expect, it } from "vitest";
import { phaseLabelForCallSkillArgs, phaseLabelForToolName } from "@/lib/agent-run-phase";
import { ownedRunError, renderChatDisplayText, renderChatPhase } from "@/lib/chat-runtime-display";
import { describeCopilotkitV2RunError } from "@/lib/copilotkit-v2-error-copy";

it("translates only the explicitly owned phase wrapper and preserves raw tool/skill names", () => {
  const name = "组织原名 {locale}）…🌱";
  const skill = phaseLabelForCallSkillArgs("stable-id", name);
  const tool = phaseLabelForToolName(name);
  expect(renderChatPhase(skill, true, "en")).toBe(`Executing skill script (${name})…`);
  expect(renderChatPhase(tool, true, "en")).toBe(`Calling tool (${name})…`);
  expect(renderChatPhase(skill, true, "zh-CN")).toBe(skill);
  expect(name).toBe("组织原名 {locale}）…🌱");
});

it("does not translate a custom caller label even when it equals a known owned Chinese label", () => {
  expect(renderChatPhase("正在执行", undefined, "en")).toBe("正在执行");
  expect(renderChatPhase("正在执行", false, "en")).toBe("正在执行");
  expect(renderChatPhase("未来 owned label 原文", true, "en")).toBe("未来 owned label 原文");
  expect(renderChatPhase(null, true, "en")).toBeNull();
});

it("retains default Chinese and raw callback policy while rendering owned run causes in English", () => {
  const known = describeCopilotkitV2RunError("MODEL_CALL_FAILED", "executor_defect");
  expect(renderChatDisplayText(ownedRunError(known), "en")).toContain("A server defect occurred");
  expect(renderChatDisplayText(ownedRunError(known), "zh-CN")).toBe(known);
  expect(renderChatDisplayText(known, "en")).toBe(known);
  const raw = "caller error 原文 {id}";
  expect(renderChatDisplayText(raw, "en")).toBe(raw);
  const transport = describeCopilotkitV2RunError("AGENT_RUN_TIMEOUT");
  expect(renderChatDisplayText(ownedRunError(transport), "en")).toBe("This execution timed out before a result arrived");
  expect(renderChatDisplayText(ownedRunError(transport), "zh-CN")).toBe(transport);
});
