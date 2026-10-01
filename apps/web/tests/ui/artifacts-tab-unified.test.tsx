/**
 * 2026-09-27 人类反馈「右边的 panel 需要改进 UIUX」（截图：产物页签）。
 *
 * 实测的缺陷：页签里两块面板上下叠放——「成果与版本」一个标题 + 刷新 + 空态，
 * 「产物预览（0）」又一个标题 + 空态。同一个"还没有产物"说两遍，一处还用内部词「线程」；
 * 第一块紧贴左边框没有内边距。
 *
 * 钉住：统一外壳下只有一个标题、一个刷新、一个空态；有成果时空态消失且计数合并；
 * 版本还在读的时候不下"没有产物"的结论。
 */
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatArtifactsPanel } from "@/components/chat/chat-artifacts-panel";
import { AgentArtifactVersionsPanel } from "@/components/chat/workbench/agent-artifact-versions-panel";
import { fetchArtifactContent, listAgentArtifacts, type AgentArtifact } from "@/lib/chat-workbench/agent-artifacts";

vi.mock("@/lib/chat-workbench/agent-artifacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat-workbench/agent-artifacts")>()),
  listAgentArtifacts: vi.fn(), continueAgentArtifact: vi.fn(), fetchArtifactContent: vi.fn(),
}));
vi.mock("@/lib/agent-run", () => ({ getAgentRun: vi.fn(), isTerminalRunStatus: () => true }));

const pptx: AgentArtifact = {
  artifactId: "artifact-a", threadId: "thread-a", name: "design-thinking.pptx", kind: "other",
  versions: [{ version: 1, producedByRunId: "run-1", producedByStepId: "step", createdAt: "2026-09-27T00:00:00Z",
    sizeBytes: 6, changeNote: "初版", contentUrl: "/artifacts/artifact-a/versions/1/content", basedOnVersion: null }],
};
const EMPTY_LIST = { items: [] } as unknown as React.ComponentProps<typeof ChatArtifactsPanel>["artifacts"];

function Harness({ onRetry = () => {} }: { onRetry?: () => void }) {
  const [count, setCount] = React.useState<number | null>(null);
  const [reload, setReload] = React.useState(0);
  return (
    <ChatArtifactsPanel
      hasSelection artifacts={EMPTY_LIST} loading={false} error={null} onRetry={onRetry}
      versions={<AgentArtifactVersionsPanel embedded threadId="thread-a" refreshKey={reload} onCountChange={setCount} />}
      versionsCount={count}
      onRefresh={() => { onRetry(); setReload((v) => v + 1); }}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.mocked(fetchArtifactContent).mockResolvedValue(new Blob(["x"]));
});

describe("产物页签：一个标题、一个刷新、一个空态", () => {
  it("两边都空：只有一个空态，不再出现第二个标题/第二句空态/「线程」", async () => {
    vi.mocked(listAgentArtifacts).mockResolvedValue([]);
    render(<Harness />);
    expect(await screen.findByTestId("chat-artifacts-empty")).toHaveTextContent("这条对话还没有产物");
    expect(screen.getByTestId("chat-artifacts-panel-title")).toHaveTextContent("产物（0）");
    expect(screen.queryByText("成果与版本")).toBeNull();
    expect(screen.queryByTestId("empty")).toBeNull();
    expect(screen.queryByTestId("agent-artifact-versions-panel")).toBeNull();
    expect(document.body.textContent).not.toContain("线程");
    expect(screen.getAllByRole("button", { name: /刷新/ })).toHaveLength(1);
  });

  it("版本还在读：不下「没有产物」的结论，也不给一个会变的计数", () => {
    vi.mocked(listAgentArtifacts).mockReturnValue(new Promise(() => {}));
    render(<Harness />);
    expect(screen.queryByTestId("chat-artifacts-empty")).toBeNull();
    expect(screen.getByTestId("chat-artifacts-panel-title")).toHaveTextContent(/^产物$/);
  });

  it("配对：有任务文件时空态消失，文件出现，计数合并", async () => {
    vi.mocked(listAgentArtifacts).mockResolvedValue([pptx]);
    render(<Harness />);
    expect(await screen.findByTestId("agent-artifact-versions-panel")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("chat-artifacts-panel-title")).toHaveTextContent("产物（1）"));
    expect(screen.queryByTestId("chat-artifacts-empty")).toBeNull();
    // 列表本身为空时不留一截空白内边距（真栈实测过：24px 空块）。
    expect(screen.queryByTestId("chat-artifacts-list")).toBeNull();
  });

  it("唯一的刷新按钮同时重读两边", async () => {
    vi.mocked(listAgentArtifacts).mockResolvedValue([]);
    const onRetry = vi.fn();
    render(<Harness onRetry={onRetry} />);
    await screen.findByTestId("chat-artifacts-empty");
    const before = vi.mocked(listAgentArtifacts).mock.calls.length;
    fireEvent.click(screen.getByTestId("chat-artifacts-refresh"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(vi.mocked(listAgentArtifacts).mock.calls.length).toBe(before + 1));
  });
});
