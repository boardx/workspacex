import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtInterviewConversation } from "@/features/aidt/components/aidt-interview-conversation";
import { AidtChatEmptyState } from "@/features/aidt/components/aidt-chat-empty-state";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import type { AidtInterview } from "@/features/aidt/lib/aidt-interviews";

const interview: AidtInterview = { id: "U1", version: 1, code: "U01", original: "", adopted: "", guideConfirmed: false, consent: null, topicRevision: 1, topic: "午休", goal: "" };
const messages = [{ id: "1", role: "user", content: "你喜欢新品吗？" }, { id: "2", role: "assistant", content: "请回想一次选购经历。" }];

it("uses a short entity starter and the shell's only composer", () => {
  render(<AidtChatEmptyState step={AIDT_STEPS[1]} interviewPhase="initial" />);
  expect(screen.getByText(/你准备问这位受访者哪些问题/)).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText("先说说你们的想法")).toBeNull();
});

it("retains the student's opening and lets them edit and explicitly adopt a turn", () => {
  const apply = vi.fn();
  const view = render(<AidtInterviewConversation interview={interview} messages={messages} loading={true} running={false} onApply={apply} />);
  expect(apply).not.toHaveBeenCalled();
  view.rerender(<AidtInterviewConversation interview={interview} messages={messages} loading={false} running={false} onApply={apply} />);
  expect(apply).toHaveBeenCalledWith({ original: messages[0]!.content });
  view.rerender(<AidtInterviewConversation interview={{...interview, original: messages[0]!.content}} messages={messages} loading={false} running={false} onApply={apply} />);
  fireEvent.change(screen.getByLabelText("从对话选取问题"), {target:{value:"2"}});
  fireEvent.change(screen.getByRole("textbox"), {target:{value:"上次看到新品时，你怎样作出选择？"}});
  expect(apply).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", {name:"确认这份问题清单"}));
  expect(apply).toHaveBeenLastCalledWith({ adopted: "上次看到新品时，你怎样作出选择？", guideConfirmed: true });
});
