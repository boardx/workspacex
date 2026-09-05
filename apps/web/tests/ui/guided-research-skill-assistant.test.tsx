import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GuidedResearchSkillAssistant } from "@/components/research-studio/guided-research-skill-assistant";
import { GuidedResearchStepLayout } from "@/components/research-studio/guided-research-step-layout";
import { cloneResearchEditableSnapshot, saveResearchSkillState, suggestionForResearchPrompt } from "@/lib/guided-research-skill-state";

vi.mock("@/lib/guided-research-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/guided-research-api")>();
  return {
    ...original,
    runGuidedResearchSkillTurn: vi.fn(async ({ requestId, message, draft }) => ({
      assistantMessage: `模型建议：${message}`,
      proposal: draft.node === "directions"
        ? {
          node: "directions",
          value: [...draft.value, { id: "d2", title: message, description: "模型生成的研究方向", enabled: true, order: draft.value.length }],
        }
        : draft,
      modelId: "qwen3.7-plus",
      modelInvocationId: `${requestId}:qwen3.7-plus`,
    })),
  };
});

const directionSnapshot = {
  step: "directions",
  value: [{ id: "d1", title: "市场", description: "规模", enabled: true, order: 0 }],
} as const;

describe("guided research skill assistant", () => {
  beforeEach(() => localStorage.clear());

  it("only changes the editor after explicit application and restores it on undo", async () => {
    const onSnapshotChange = vi.fn();
    render(
      <GuidedResearchSkillAssistant
        step="directions"
        sessionKey="research-a"
        snapshot={directionSnapshot}
        onSnapshotChange={onSnapshotChange}
      />,
    );

    expect(screen.getByTestId("research-skill-assistant")).toHaveTextContent("研究 Skill 助手");
    fireEvent.click(screen.getByRole("button", { name: "补充研究方向" }));
    expect(onSnapshotChange).not.toHaveBeenCalled();
    expect(await screen.findByTestId("research-skill-suggestion")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用建议" }));
    expect(onSnapshotChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "撤销上次应用" }));
    expect(onSnapshotChange).toHaveBeenLastCalledWith(directionSnapshot);
  });

  it("sends non-empty input with Enter and disables empty sends", async () => {
    render(
      <GuidedResearchSkillAssistant
        step="directions"
        sessionKey="research-b"
        snapshot={directionSnapshot}
        onSnapshotChange={vi.fn()}
      />,
    );

    const input = screen.getByTestId("research-skill-input");
    const send = screen.getByTestId("research-skill-send");
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: "补充研究方向" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByTestId("research-skill-suggestion")).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(screen.getByText("由 qwen3.7-plus 生成建议；应用前不会修改研究内容。")).toBeInTheDocument();
  });

  it("does not render or apply another step's saved suggestion or undo", () => {
    saveResearchSkillState("research-shared", {
      version: 1,
      messages: [],
      pendingSuggestion: suggestionForResearchPrompt("补充研究方向", directionSnapshot),
      undoSnapshot: cloneResearchEditableSnapshot(directionSnapshot),
    });

    render(
      <GuidedResearchSkillAssistant
        step="brief"
        sessionKey="research-shared"
        snapshot={{ step: "brief", value: { topic: "储能", goal: "进入市场", timeRange: "2026", region: "欧盟", focus: "政策" } }}
        onSnapshotChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("research-skill-suggestion")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "撤销上次应用" })).not.toBeInTheDocument();
  });

  it("mounts one assistant and one editor while using a responsive disclosure", () => {
    let assistantEffects = 0;
    let editorEffects = 0;
    function AssistantProbe() {
      React.useEffect(() => { assistantEffects += 1; }, []);
      return <div>助手面板</div>;
    }
    function EditorProbe() {
      React.useEffect(() => { editorEffects += 1; }, []);
      return <div>主内容</div>;
    }

    render(
      <GuidedResearchStepLayout assistant={<AssistantProbe />}>
        <EditorProbe />
      </GuidedResearchStepLayout>,
    );

    expect(screen.getByText("研究 Skill 助手").closest("summary")).toBeInTheDocument();
    const workspace = screen.getByTestId("research-step-main").parentElement;
    expect(workspace).toHaveAttribute("data-layout", "skill-workspace-thirds");
    expect(workspace).toHaveClass("lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]");
    expect(assistantEffects).toBe(1);
    expect(editorEffects).toBe(1);
  });

  it("renders a full-height conversation surface with scrolling messages and a bottom composer", () => {
    render(
      <GuidedResearchSkillAssistant
        step="directions"
        sessionKey="research-layout"
        snapshot={directionSnapshot}
        onSnapshotChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("research-skill-assistant")).toHaveAttribute("data-surface", "full-height-conversation");
    expect(screen.getByTestId("research-skill-messages")).toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("research-skill-composer")).toBeInTheDocument();
  });

  it("keeps the assistant interactive when local storage writes fail", async () => {
    const onSnapshotChange = vi.fn();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("storage disabled", "SecurityError");
    });
    render(
      <GuidedResearchSkillAssistant
        step="directions"
        sessionKey="research-storage-error"
        snapshot={directionSnapshot}
        onSnapshotChange={onSnapshotChange}
      />,
    );

    expect(() => fireEvent.click(screen.getByRole("button", { name: "补充研究方向" }))).not.toThrow();
    expect(await screen.findByTestId("research-skill-suggestion")).toBeInTheDocument();
    expect(() => fireEvent.click(screen.getByRole("button", { name: "应用建议" }))).not.toThrow();
    expect(onSnapshotChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "撤销上次应用" })).toBeInTheDocument();
    expect(() => fireEvent.click(screen.getByRole("button", { name: "撤销上次应用" }))).not.toThrow();
    expect(onSnapshotChange).toHaveBeenLastCalledWith(directionSnapshot);
    setItem.mockRestore();
  });
});
