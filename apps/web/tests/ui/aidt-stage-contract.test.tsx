import * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AidtStageContract } from "@/features/aidt/components/aidt-stage-contract";

function openStage(stageNumber: number) {
  const result = render(<AidtStageContract stageNumber={stageNumber} />);
  const contract = screen.getByTestId("aidt-stage-contract");
  expect(contract).not.toHaveAttribute("open");
  fireEvent.click(within(contract).getByText("本步约定 · 输入3项 → 过程反馈 → 正式交付"));
  return result;
}

describe("AIDT stage contracts", () => {
  it.each([
    [1, "dt-frame-problem"], [2, "dt-empathize-users"], [3, "dt-synthesize-hmw"],
    [4, "dt-diverge-ideas"], [5, "dt-prototype-concept"], [6, "dt-test-iterate"],
  ])("stage %i distinguishes three student inputs, feedback and deliverables from a mounted Skill", (stageNumber, skill) => {
    openStage(Number(stageNumber));
    expect(within(screen.getByTestId("aidt-contract-inputs")).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByTestId("aidt-contract-feedback")).toHaveTextContent("学生");
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("待学生完成");
    expect(screen.getByTestId("aidt-contract-suggested-skill")).toHaveTextContent(String(skill));
    expect(screen.getByTestId("aidt-contract-suggested-skill")).toHaveTextContent("设计建议，当前未接入此预览");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/此处不执行生成、上传或项目保存/)).toBeVisible();
  });

  it("keeps the first-stage theme separate from synthesis, and leaves unsupported persona details unknown", () => {
    const first = openStage(1);
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("学生重写的研究主题");
    expect(screen.getByTestId("aidt-contract-deliverables")).not.toHaveTextContent("HMW");
    first.unmount();
    const second = openStage(2);
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("访谈问题清单PDF与定性反馈");
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("每位受访者的发现卡");
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("直接引文与概括分开标注");
    second.unmount();
    openStage(3);
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("用户画像");
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("选定HMW");
    expect(screen.getByTestId("aidt-contract-boundary")).toHaveTextContent("不强制另交独立的用户问题卡");
    expect(screen.getByTestId("aidt-contract-boundary")).toHaveTextContent("年龄、兴趣、生活方式未知时留空或标未知，不补编");
  });

  it("distinguishes three divergent idea sheets from prototype quantities and a changed prototype from a validated result", () => {
    const ideas = openStage(4);
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("至少3个不同点子描述单PDF");
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("名称、图和2–3句核心说明");
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("本轮进入原型的点子");
    expect(screen.getByTestId("aidt-contract-boundary")).toHaveTextContent("不是系统锁步门槛");
    ideas.unmount();
    const prototype = openStage(5);
    expect(screen.getByTestId("aidt-contract-feedback")).toHaveTextContent("方案数量不固定为3个");
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("学生确认的原型版本");
    expect(screen.getByTestId("aidt-contract-boundary")).toHaveTextContent("不要求视频或生产App");
    prototype.unmount();
    openStage(6);
    expect(screen.getByTestId("aidt-contract-inputs")).toHaveTextContent("学生先反思、采纳与修改");
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("新版本默认待复测");
    expect(screen.getByTestId("aidt-contract-deliverables")).toHaveTextContent("不能因已修改就认定改进有效");
  });
});
