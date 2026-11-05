import * as React from "react";
import { Blob } from "node:buffer";
import { wave2Runtime } from "@repo/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { AgentArtifactVersionsPanel } from "@/components/chat/workbench/agent-artifact-versions-panel";
import { continueAgentArtifact, fetchArtifactContent, listAgentArtifacts, type AgentArtifact } from "@/lib/chat-workbench/agent-artifacts";
import { getAgentRun } from "@/lib/agent-run";

vi.mock("@/lib/chat-workbench/agent-artifacts", async original => ({
  ...await original<typeof import("@/lib/chat-workbench/agent-artifacts")>(),
  listAgentArtifacts: vi.fn(), continueAgentArtifact: vi.fn(), fetchArtifactContent: vi.fn(),
}));
vi.mock("@/lib/agent-run", async original => ({ ...await original<typeof import("@/lib/agent-run")>(), getAgentRun: vi.fn() }));
let changeLanguage: () => void;
function LocaleDriver() { const { setLocale } = useI18n(); changeLanguage = () => setLocale("zh-CN"); return null; }
const rawInstruction = "模型编辑目标 {locale}";
const artifact: AgentArtifact = { artifactId: "raw-artifact", threadId: "raw-thread", name: "原始文件 {version}.md", kind: "other", versions: [{
  version: 1, basedOnVersion: null, producedByRunId: "original-run", producedByStepId: "original-step", createdAt: "2026-11-04T00:00:00Z",
  sizeBytes: 12, changeNote: "模型原文 {change}", contentUrl: "/artifacts/raw-artifact/versions/1/content",
}] };
const statuses = [
  ["running", "Generating a new version; the original is unchanged.", "正在生成新版本，原版本保持不变。"],
  ["paused", "Modification paused. Continue in the task.", "修改已暂停，请在任务中继续。"],
  ["awaiting_tool_permission", "Waiting for confirmation. Handle it in the task.", "等待确认，请在任务中处理。"],
  ["succeeded", "A new version has been generated.", "新版本已生成。"],
  ["failed", "Modification incomplete; the old version is retained.", "修改未完成，旧版本保留。"],
  ["cancelled", "Modification stopped; the old version is retained.", "修改已停止，旧版本保留。"],
] as const;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:raw-version"); static revokeObjectURL = vi.fn(); });
  vi.mocked(listAgentArtifacts).mockResolvedValue([artifact]);
  vi.mocked(fetchArtifactContent).mockResolvedValue(new Blob(["原始字节 {locale}"]) as unknown as globalThis.Blob);
  vi.mocked(continueAgentArtifact).mockResolvedValue({ runId: "edit-run", artifactId: artifact.artifactId });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(statuses)("renders canonical %s progress without a locale-triggered submit or poll", async (status, english, chinese) => {
  vi.mocked(getAgentRun).mockResolvedValue(wave2Runtime.AgentRunView.parse({
    runId: "edit-run", threadId: "raw-thread", inputMessageId: "raw-input", agentId: "raw-agent", agentVersionId: "raw-agent-version", skillVersionIds: [],
    modelProvider: "controlled-fixture", modelId: "controlled-model", status, error: null, resultMessageId: null, steps: [], createdAt: "2026-11-04T00:00:00Z",
  }));
  const started = vi.fn();
  render(<I18nProvider initialLocale="en"><LocaleDriver /><AgentArtifactVersionsPanel threadId="raw-thread" sessionToken="fixture-token" canEdit onRunStarted={started} /></I18nProvider>);
  const input = await screen.findByTestId("artifact-edit-instruction");
  fireEvent.change(input, { target: { value: rawInstruction } });
  fireEvent.click(screen.getByTestId("artifact-continue"));
  await waitFor(() => expect(getAgentRun).toHaveBeenCalledTimes(1));
  expect(started).toHaveBeenCalledTimes(1); expect(started).toHaveBeenCalledWith("edit-run");
  expect(vi.mocked(continueAgentArtifact).mock.calls[0]?.slice(0, 3)).toEqual([artifact.artifactId, 1, rawInstruction]);
  const notice = await screen.findByText(english);
  const loads = vi.mocked(listAgentArtifacts).mock.calls.length;
  act(() => changeLanguage());
  expect(screen.getByText(chinese)).toBe(notice);
  expect(screen.getByTestId("artifact-edit-instruction")).toBe(input);
  expect(continueAgentArtifact).toHaveBeenCalledTimes(1); expect(getAgentRun).toHaveBeenCalledTimes(1);
  expect(listAgentArtifacts).toHaveBeenCalledTimes(loads);
  expect(input).toHaveValue(status === "succeeded" ? "" : rawInstruction);
  if (status === "running" || status === "paused" || status === "awaiting_tool_permission") expect(input).toBeDisabled();
});
