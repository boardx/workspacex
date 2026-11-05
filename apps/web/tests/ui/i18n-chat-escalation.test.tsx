import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { AgentEscalationCard, AgentEscalationDecidedRecord, type ResolvedEscalation } from "@/components/chat/agent-escalation-card";
import { ApiError } from "@/lib/api-client";
import { escalationFailureText } from "@/lib/agent-escalation";
const payload = { matter: "模型事项 {count}", reason: "模型原因🌍", target: "project_owner" as const, contextRefs: ["10000000-0000-4000-8000-000000000001"] };
const id = "20000000-0000-4000-8000-000000000002";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
it("keeps the user's decision and exact pending request while localizing escalation chrome", async () => {
  let finish: () => void = () => { throw new Error("submit not started"); };
  const submit = vi.fn().mockImplementation(() => new Promise<unknown>(resolve => { finish = () => resolve({}); }));
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><AgentEscalationCard interruptId={id} payload={payload} agentName="组织原名{count}" submit={submit} sessionToken="unit-fixture" /></I18nProvider>);
  const field = screen.getByRole("textbox", { name: "Your decision or feedback" });
  expect(screen.getByTestId("agent-escalation-target").textContent).toBe("Project owner");
  expect(screen.getByTestId("agent-escalation-matter").textContent).toBe(payload.matter); expect(screen.getByTestId("agent-escalation-reason").textContent).toBe(payload.reason);
  const text = " 用户决定{status}🌍 "; fireEvent.change(field, { target: { value: text } });
  const resolveButton = screen.getByRole("button", { name: "Submit decision" }); fireEvent.click(resolveButton); fireEvent.click(resolveButton);
  expect(submit).toHaveBeenCalledTimes(1); expect(submit).toHaveBeenCalledWith(id, { decision: "resolve", decisionText: text.trim() }, "unit-fixture");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("textbox", { name: "你的决定或意见" })).toBe(field); expect((field as HTMLTextAreaElement).value).toBe(text); expect(field).toBeDisabled();
  expect(screen.getByTestId("agent-escalation-who").textContent).toBe("组织原名{count}"); expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => finish()); expect(screen.getByTestId("agent-escalation-done").textContent).toContain("已提交你的决定");
});
it("keeps observer escalation read-only across locale changes", () => {
  const submit = vi.fn();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><AgentEscalationCard interruptId={id} payload={payload} canWrite={false} submit={submit} /></I18nProvider>);
  const notice = screen.getByTestId("agent-escalation-readonly"); expect(notice.textContent).toBe("You can only view this conversation. The project owner must decide.");
  expect(screen.queryByTestId("agent-escalation-resolve")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(screen.getByTestId("agent-escalation-readonly")).toBe(notice); expect(submit).not.toHaveBeenCalled();
});
it("localizes known escalation denial without exposing reason codes and preserves default compatibility", () => {
  const error = new ApiError(403, "ESCALATION_DECIDER_FORBIDDEN", {});
  expect(escalationFailureText(error, "en")).toBe("This matter was escalated to someone else. You cannot decide on their behalf.");
  expect(escalationFailureText(error)).toBe("这件事升级给了其他人，你没有权限替他做决定");
});

it("localizes decided-record chrome without changing the decider, decision text or persisted timestamp", () => {
  const record: ResolvedEscalation = { permissionRequestId: id, argsSummary: JSON.stringify(payload), decision: "reject", text: "用户裁决原文{count}", decidedBy: { userId: "raw-user", displayName: "决定人原名🌍" }, decidedAt: "2026-11-04T00:00:00Z" };
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><AgentEscalationDecidedRecord record={record} /></I18nProvider>);
  const section = screen.getByTestId("agent-escalation-decided"); expect(screen.getByTestId("agent-escalation-decided-verdict").textContent).toBe("Rejected");
  const raw = screen.getByTestId("agent-escalation-decided-text"); expect(raw.textContent).toBe(`Reason: ${record.text}`);
  const at = screen.getByTestId("agent-escalation-decided-at"); expect(at.getAttribute("datetime")).toBe(record.decidedAt); expect(at.textContent).not.toContain("月");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("agent-escalation-decided")).toBe(section); expect(screen.getByTestId("agent-escalation-decided-text")).toBe(raw);
  expect(raw.textContent).toBe(`理由：${record.text}`); expect(screen.getByTestId("agent-escalation-decided-by").textContent).toBe(record.decidedBy?.displayName);
  expect(screen.getByTestId("agent-escalation-decided-at")).toBe(at); expect(at.getAttribute("datetime")).toBe(record.decidedAt); expect(section.getAttribute("data-decision")).toBe("reject");
});
