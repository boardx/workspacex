import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GuidedResearchSkillAssistant } from "@/components/research-studio/guided-research-skill-assistant";
import { GuidedResearchStepLayout } from "@/components/research-studio/guided-research-step-layout";

const directionSnapshot = {
  step: "directions",
  value: [{ id: "d1", title: "市场", description: "规模", enabled: true, order: 0 }],
} as const;

describe("guided research skill assistant", () => {
  beforeEach(() => localStorage.clear());

  it("only changes the editor after explicit application and restores it on undo", () => {
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
    expect(screen.getByTestId("research-skill-suggestion")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用建议" }));
    expect(onSnapshotChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "撤销上次应用" }));
    expect(onSnapshotChange).toHaveBeenLastCalledWith(directionSnapshot);
  });

  it("sends non-empty input with Enter and disables empty sends", () => {
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
    expect(screen.getByTestId("research-skill-suggestion")).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(screen.getByText("演示 Skill · 不作为真实研究证据")).toBeInTheDocument();
  });

  it("uses a disclosure on smaller screens and preserves a min-width-safe desktop grid", () => {
    render(
      <GuidedResearchStepLayout assistant={<div>助手面板</div>}>
        <div>主内容</div>
      </GuidedResearchStepLayout>,
    );

    expect(screen.getByText("研究 Skill 助手").closest("summary")).toBeInTheDocument();
    expect(screen.getAllByText("助手面板")[0]?.parentElement?.parentElement).toHaveClass("min-w-0");
  });
});
