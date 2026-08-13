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
});
