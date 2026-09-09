import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TagInput } from "@/components/ui/tag-input";

afterEach(cleanup);

it.each(["Enter", ",", "，"])("IME %s confirms composition without committing or clearing the draft", (key) => {
  const onChange = vi.fn();
  render(<TagInput value={[]} onChange={onChange} knownTags={new Map()} />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "移动端" } });
  fireEvent.keyDown(input, { key });
  expect(onChange).not.toHaveBeenCalled();
  expect(input.value).toBe("移动端");
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(["移动端"]);
  expect(input.value).toBe("");
});

it.each([{ isComposing: true }, { keyCode: 229 }])("honors native IME state when composition events precede mounting", (nativeState) => {
  const onChange = vi.fn();
  render(<TagInput value={[]} onChange={onChange} knownTags={new Map()} />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "标签" } });
  fireEvent.keyDown(input, { key: "Enter", ...nativeState });
  expect(onChange).not.toHaveBeenCalled();
  expect(input.value).toBe("标签");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(["标签"]);
});

it("does not remove the last chip on Backspace during composition", () => {
  const onChange = vi.fn();
  render(<TagInput value={["已有"]} onChange={onChange} knownTags={new Map()} />);
  const input = screen.getByRole("textbox");
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Backspace" });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Backspace" });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith([]);
});
