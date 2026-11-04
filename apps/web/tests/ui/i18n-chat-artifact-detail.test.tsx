import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const source = vi.hoisted(() => ({ loads: vi.fn(), pending: false, resolve: null as null | ((doc: { markdown: string; version: number | null; savedAt: string } | null) => void) }));
const raw = "# 模型原文 {count}\n```ts\nconst raw = '{locale}';\n```";
vi.mock("@/components/chat/chat-artifact-view", () => ({ ChatArtifactView: (p: { artifactId: string; onLoaded?: (doc: { markdown: string; version: number | null; savedAt: string } | null) => void }) => {
  const { artifactId, onLoaded } = p;
  React.useEffect(() => {
    source.loads(artifactId); onLoaded?.(null); source.resolve = onLoaded ?? null;
    if (!source.pending) onLoaded?.({ markdown: raw, version: 2, savedAt: "2026-11-04T00:00:00Z" });
  }, [artifactId, onLoaded]);
  return <div data-testid="actual-detail-source-boundary">{p.artifactId}</div>;
} }));
vi.mock("@/components/chat/workbench/agent-artifact-versions-panel", () => ({ AgentArtifactVersionsPanel: () => null }));
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ChatTaskInspector, type ChatTaskInspectorProps } from "@/components/chat/chat-task-inspector";
function LocaleControl() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
const item = { artifactId: "raw-artifact", title: "模型标题 {title}", mode: "live" as const, pinnedBy: null, pinnedAt: null, version: 2, messageId: "raw-message", hasSource: true };
const props: ChatTaskInspectorProps = { hasSelection: true, threadId: "raw-thread", artifacts: { items: [item] }, materials: null, loading: false, artifactsError: null, materialsError: null, onRetry: vi.fn(), pendingMaterialsCount: 0, planTodos: null, isRunning: false, runPhaseLabel: null, runStartedAt: null };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); source.loads.mockClear(); source.pending = false; source.resolve = null; });
function openDetail() {
  fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-tab-artifacts"));
  fireEvent.click(screen.getByTestId("chat-artifact-raw-artifact"));
}
it("keeps loaded version copy/download bytes and action state through a locale change", async () => {
  const writeText = vi.fn(async () => {}); vi.stubGlobal("navigator", { clipboard: { writeText } });
  const blobs: Blob[] = []; const names: string[] = [];
  vi.stubGlobal("URL", class extends URL { static createObjectURL(blob: Blob) { blobs.push(blob); return "blob:loaded-version"; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
  const enlarge = vi.fn();
  render(<I18nProvider initialLocale="en"><LocaleControl /><ChatTaskInspector {...props} onOpenArtifact={enlarge} /></I18nProvider>); openDetail();
  const copy = screen.getByRole("button", { name: "Copy full text" });
  const loaded = screen.getByTestId("actual-detail-source-boundary");
  expect(screen.getByTestId("chat-task-workbench-artifact-sources").textContent).toContain("Source attached");
  fireEvent.click(copy); await screen.findByRole("button", { name: "Copied" }); expect(writeText).toHaveBeenCalledWith(raw);
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("button", { name: "已复制" })).toBe(copy); expect(screen.getByTestId("actual-detail-source-boundary")).toBe(loaded); expect(source.loads).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId("chat-inspector-artifact-download")); expect(names).toEqual(["模型标题 {title}.md"]);
  const saved = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blobs[0]!); }); expect(saved).toBe(raw);
  expect(enlarge).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "放大查看" })); expect(enlarge).toHaveBeenCalledTimes(1); expect(enlarge).toHaveBeenCalledWith(item);
});
it("does not refetch or enable actions merely because locale changed while source was pending", () => {
  source.pending = true;
  render(<I18nProvider initialLocale="en"><LocaleControl /><ChatTaskInspector {...props} /></I18nProvider>); openDetail();
  const detail = screen.getByTestId("chat-inspector-artifact-detail");
  const copy = within(detail).getByRole("button", { name: "Copy full text" }); expect(copy).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(within(detail).getByRole("button", { name: "复制全文" })).toBe(copy); expect(copy).toBeDisabled(); expect(source.loads).toHaveBeenCalledTimes(1);
  act(() => { source.resolve?.({ markdown: raw, version: 2, savedAt: "2026-11-04T00:00:00Z" }); }); expect(copy).toBeEnabled();
  expect(source.loads).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByTestId("chat-inspector-artifact-source-jump"));
  expect(screen.getByTestId("chat-inspector-artifact-source-missing").textContent).toBe("原消息不在当前视图里");
});
