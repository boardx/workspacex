import * as React from "react";
import { Blob } from "node:buffer";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { AgentArtifactVersionsPanel } from "@/components/chat/workbench/agent-artifact-versions-panel";
import { continueAgentArtifact, fetchArtifactContent, listAgentArtifacts, type AgentArtifact } from "@/lib/chat-workbench/agent-artifacts";

vi.mock("@/lib/chat-workbench/agent-artifacts", async original => ({
  ...await original<typeof import("@/lib/chat-workbench/agent-artifacts")>(),
  listAgentArtifacts: vi.fn(), continueAgentArtifact: vi.fn(), fetchArtifactContent: vi.fn(),
}));
vi.mock("@/lib/agent-run", async original => ({
  ...await original<typeof import("@/lib/agent-run")>(), getAgentRun: vi.fn(),
}));
let setLocale: (locale: "en" | "zh-CN") => void;
function LocaleDriver() { setLocale = useI18n().setLocale; return null; }
const rawInstruction = " 保留模型原文 {locale}\nconst x = '{count}'; ";
const artifact: AgentArtifact = { artifactId: "raw-artifact", threadId: "raw-thread", name: "模型文件 {count}.md", kind: "other", versions: [1, 2].map(version => ({
  version, producedByRunId: `raw-run-${version}`, producedByStepId: "raw-step", createdAt: "2026-11-04T00:00:00Z", sizeBytes: 12,
  changeNote: `模型修改原文 ${version} {version}`, contentUrl: `/artifacts/raw-artifact/versions/${version}/content`, basedOnVersion: version === 2 ? 1 : null,
})) };
function app(canEdit = true) { return <I18nProvider initialLocale="en"><LocaleDriver /><AgentArtifactVersionsPanel threadId="raw-thread" sessionToken="fixture-token" canEdit={canEdit} /></I18nProvider>; }
async function chooseOldVersion() {
  const picker = await screen.findByTestId("artifact-version-picker");
  fireEvent.keyDown(picker, { key: "ArrowDown" });
  const option = await screen.findByRole("menuitemradio", { name: /^(Version|版本) 1$/ });
  fireEvent.click(option);
  await waitFor(() => expect(picker).toHaveTextContent(/^(Version|版本) 1$/));
  return picker;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:artifact-version");
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(listAgentArtifacts).mockResolvedValue([artifact]);
  vi.mocked(fetchArtifactContent).mockImplementation(async (_id, version) => new Blob([version === 1 ? "raw {locale}\nold" : "raw {locale}\nnew"]) as unknown as globalThis.Blob);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps the real version selector, raw draft and idempotent request across locale and uncertain failure", async () => {
  vi.mocked(continueAgentArtifact).mockRejectedValue(new Error("uncertain transport"));
  render(app());
  const picker = await chooseOldVersion();
  const input = screen.getByTestId("artifact-edit-instruction");
  fireEvent.change(input, { target: { value: rawInstruction } });
  expect(screen.getByRole("textbox", { name: "Continue editing from version 1" })).toBe(input);
  fireEvent.click(screen.getByTestId("artifact-continue"));
  expect(await screen.findByRole("alert")).toHaveTextContent("The modification request was not confirmed");
  const first = vi.mocked(continueAgentArtifact).mock.calls[0]!;
  expect(first.slice(0, 3)).toEqual([artifact.artifactId, 1, rawInstruction]);
  expect(first[4]).toBe("fixture-token");
  act(() => setLocale("zh-CN"));
  expect(screen.getByTestId("artifact-version-picker")).toBe(picker);
  expect(screen.getByTestId("artifact-edit-instruction")).toBe(input);
  expect(input).toHaveValue(rawInstruction);
  expect(listAgentArtifacts).toHaveBeenCalledTimes(1);
  expect(continueAgentArtifact).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId("artifact-continue"));
  await waitFor(() => expect(continueAgentArtifact).toHaveBeenCalledTimes(2));
  expect(vi.mocked(continueAgentArtifact).mock.calls[1]).toEqual(first);
});

it("translates diff chrome while preserving raw lines, the loaded preview and exact download name", async () => {
  const downloads: { name: string; href: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ name: this.download, href: this.href }); });
  render(app(false));
  const compare = await screen.findByRole("button", { name: /^(Compare with version|与版本) 1( 比较)?$/ });
  fireEvent.click(compare);
  const diff = await screen.findByTestId("artifact-text-diff");
  expect(within(diff).getByLabelText("Added")).toHaveTextContent("+ new");
  expect(within(diff).getByLabelText("Removed")).toHaveTextContent("− old");
  expect(within(diff).getByLabelText("Unchanged")).toHaveTextContent("raw {locale}");
  const calls = vi.mocked(fetchArtifactContent).mock.calls.length;
  act(() => setLocale("zh-CN"));
  expect(screen.getByTestId("artifact-text-diff")).toBe(diff);
  expect(fetchArtifactContent).toHaveBeenCalledTimes(calls);
  expect(within(diff).getByLabelText("新增")).toHaveTextContent("+ new");
  fireEvent.click(screen.getByTestId("chat-task-workbench-artifact-export"));
  expect(downloads).toEqual([{ name: artifact.name, href: "blob:artifact-version" }]);
  expect(screen.queryByTestId("artifact-edit-instruction")).toBeNull();
  expect(continueAgentArtifact).not.toHaveBeenCalled();
});

it("keeps a pending content request mounted during locale change and retries only on explicit action", async () => {
  let rejectContent!: (error: Error) => void;
  vi.mocked(fetchArtifactContent).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectContent = reject; }));
  render(app(false));
  const pending = await screen.findByText("Loading version…");
  act(() => setLocale("zh-CN"));
  expect(screen.getByText("正在读取版本…")).toBe(pending);
  expect(fetchArtifactContent).toHaveBeenCalledTimes(1);
  await act(async () => { rejectContent(new Error("private caller detail")); });
  const retry = screen.getByRole("button", { name: "重试预览" });
  act(() => setLocale("en"));
  expect(screen.getByRole("button", { name: "Retry preview" })).toBe(retry);
  expect(fetchArtifactContent).toHaveBeenCalledTimes(1);
  fireEvent.click(retry);
  await screen.findByTestId("chat-task-workbench-artifact-export");
  expect(fetchArtifactContent).toHaveBeenCalledTimes(2);
  expect(listAgentArtifacts).toHaveBeenCalledTimes(1);
});
