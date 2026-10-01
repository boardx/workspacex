import * as React from "react";
import { expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InlineQuestionText } from "@/components/survey/live/inline-question-text";

function Field({ multiline = false }: { multiline?: boolean }) {
  const [value, setValue] = React.useState("原标题");
  return <InlineQuestionText value={value} label="题目" onChange={setValue} multiline={multiline} />;
}

it("returns multiline text to reading with Enter but preserves Shift+Enter", () => {
  render(<Field multiline />);
  fireEvent.click(screen.getByRole("button", { name: "题目" }));
  const input = screen.getByRole("textbox", { name: "题目" });
  fireEvent.change(input, { target: { value: "新标题" } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "题目" })).toHaveTextContent("新标题");
});

it("keeps the editor open while Enter confirms IME composition", () => {
  render(<Field />);
  fireEvent.click(screen.getByRole("button", { name: "题目" }));
  const input = screen.getByRole("textbox", { name: "题目" });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(input).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "中文选项" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("button", { name: "题目" })).toHaveTextContent("中文选项");
});

it("returns keyboard focus to the reading field on Escape", () => {
  render(<Field />);
  fireEvent.click(screen.getByRole("button", { name: "题目" }));
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(screen.getByRole("button", { name: "题目" })).toHaveFocus();
});
