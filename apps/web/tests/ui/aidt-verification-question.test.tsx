import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtVerificationQuestion } from "@/features/aidt/components/aidt-verification-question";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";

function Controlled() {
  const [draft, onChange] = React.useState(emptyAidtUiDrafts()[5]!);
  return <AidtVerificationQuestion draft={draft} onChange={onChange} />;
}
it("waits for the student, accepts a question without fabricated optional answers and reconfirms edits", () => {
  render(<Controlled />);
  expect(screen.getByRole("button", { name: "确认本轮验证问题" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("通过这次制作原型，你最想知道什么？"), { target: { value: "用户是否看懂操作？" } });
  fireEvent.click(screen.getByRole("button", { name: "确认本轮验证问题" }));
  expect(screen.getByRole("button", { name: "本轮问题已确认" })).toBeDisabled();
  expect(screen.getByLabelText("目前看法的依据")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("目前看法的依据"), { target: { value: "只是猜测" } });
  expect(screen.getByRole("button", { name: "确认本轮验证问题" })).toBeEnabled();
});
it("blocks edits and confirmation when the project becomes read-only", () => {
  const onChange = vi.fn();
  const draft = emptyAidtUiDrafts()[5]!;
  draft.fields.verificationQuestion = "能理解吗？";
  const { rerender } = render(<AidtVerificationQuestion draft={draft} onChange={onChange} />);
  rerender(<AidtVerificationQuestion draft={draft} onChange={onChange} readOnly />);
  fireEvent.change(screen.getByLabelText("通过这次制作原型，你最想知道什么？"), { target: { value: "改题" } });
  fireEvent.click(screen.getByRole("button", { name: "确认本轮验证问题" }));
  expect(onChange).not.toHaveBeenCalled();
});
