import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DigitalInterviewSetup } from "@/components/itv/digital-interview-setup";
import { createMockDigitalInterviewDraft } from "@/lib/mock/digital-interview-drafts";

describe("F04 可点击 Mock 访谈流程", () => {
  beforeEach(() => {
    push.mockReset();
    localStorage.clear();
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-f04");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("确认主题后可点击完成专家、问题、访谈和报告步骤", async () => {
    const draft = createMockDigitalInterviewDraft({ name: "德国采购决策链", tags: ["采购决策"] });
    render(<DigitalInterviewSetup interviewId={draft.interviewId} />);

    expect(await screen.findByTestId("itv-workflow-step-1")).toHaveAttribute("aria-current", "step");
    fireEvent.change(screen.getByTestId("itv-topic-input"), {
      target: { value: "德国储能采购由谁拥有最终否决权？" },
    });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));

    expect(await screen.findByTestId("itv-workflow-step-2")).toHaveAttribute("aria-current", "step");
    expect(screen.getAllByTestId("itv-selected-expert").length).toBeGreaterThan(1);
    fireEvent.click(screen.getAllByLabelText(/删除专家/)[0]!);
    fireEvent.click(screen.getByTestId("itv-confirm-experts"));

    expect(await screen.findByTestId("itv-workflow-step-3")).toHaveAttribute("aria-current", "step");
    const question = screen.getAllByTestId("itv-question-input")[0]!;
    fireEvent.change(question, { target: { value: "请解释你在采购否决中的职责边界。" } });
    fireEvent.click(screen.getByTestId("itv-confirm-questions"));

    expect(await screen.findByTestId("itv-workflow-step-4")).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByTestId("itv-run-all"));
    fireEvent.click(screen.getByTestId("itv-workflow-step-5"));
    expect(screen.getByTestId("itv-report-markdown")).toHaveTextContent("# 德国采购决策链");
    expect(screen.getByTestId("itv-report-timeline")).toHaveTextContent("报告已生成");
  });

  it("从专家目录弹窗搜索并多选添加专家", async () => {
    const draft = createMockDigitalInterviewDraft({ name: "专家选择", tags: ["采购"] });
    render(<DigitalInterviewSetup interviewId={draft.interviewId} />);
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "验证决策链" } });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));

    fireEvent.click(await screen.findByTestId("itv-add-expert"));
    expect(screen.getByTestId("itv-expert-picker-dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("itv-expert-picker-search"), { target: { value: "陈宇轩" } });
    fireEvent.click(screen.getByLabelText("选择专家 陈宇轩"));
    fireEvent.click(screen.getByTestId("itv-expert-picker-confirm"));

    expect(screen.getByText("陈宇轩")).toBeInTheDocument();
    expect(screen.getAllByText("陈宇轩")).toHaveLength(1);
  });

  it("每位专家默认三问，生成问题与手动问题都可删除", async () => {
    const draft = createMockDigitalInterviewDraft({ name: "问题编辑", tags: ["采购"] });
    render(<DigitalInterviewSetup interviewId={draft.interviewId} />);
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "验证决策链" } });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));
    fireEvent.click(await screen.findByTestId("itv-confirm-experts"));

    const groups = await screen.findAllByTestId("itv-question-group");
    expect(groups.length).toBeGreaterThan(1);
    expect(screen.getAllByTestId("itv-question-input")).toHaveLength(groups.length * 3);

    fireEvent.click(screen.getAllByTestId("itv-delete-question")[0]!);
    expect(screen.getAllByTestId("itv-question-input")).toHaveLength(groups.length * 3 - 1);

    fireEvent.click(screen.getAllByTestId("itv-add-question")[0]!);
    expect(screen.getAllByTestId("itv-question-input")).toHaveLength(groups.length * 3);
    fireEvent.click(screen.getAllByTestId("itv-delete-question").at(-1)!);
    expect(screen.getAllByTestId("itv-question-input")).toHaveLength(groups.length * 3 - 1);
  });

  it("往返专家步骤时保留编辑，只为新增专家补齐三问", async () => {
    const draft = createMockDigitalInterviewDraft({ name: "往返编辑", tags: ["采购"] });
    render(<DigitalInterviewSetup interviewId={draft.interviewId} />);
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "验证决策链" } });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));
    fireEvent.click(await screen.findByTestId("itv-confirm-experts"));

    const firstQuestion = (await screen.findAllByTestId("itv-question-input"))[0]!;
    fireEvent.change(firstQuestion, { target: { value: "保留这条用户编辑的问题" } });
    fireEvent.click(screen.getByTestId("itv-workflow-step-2"));
    fireEvent.click(await screen.findByTestId("itv-add-expert"));
    fireEvent.change(screen.getByTestId("itv-expert-picker-search"), { target: { value: "陈宇轩" } });
    fireEvent.click(screen.getByLabelText("选择专家 陈宇轩"));
    fireEvent.click(screen.getByTestId("itv-expert-picker-confirm"));
    fireEvent.click(await screen.findByTestId("itv-confirm-experts"));

    expect(await screen.findByDisplayValue("保留这条用户编辑的问题")).toBeInTheDocument();
    expect(screen.getAllByTestId("itv-question-group")).toHaveLength(4);
    expect(screen.getAllByTestId("itv-question-input")).toHaveLength(12);
  });
});
