import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BoardToolPopover } from "@/components/whiteboard/board-tool-popover";
import { BoardBottomDock } from "@/components/whiteboard/board-bottom-dock";

afterEach(cleanup);

it("opens only the requested inspector, dismisses with Escape and returns focus", async () => {
  render(<><BoardToolPopover label="文字样式"><input aria-label="测试字体" /></BoardToolPopover><BoardToolPopover label="标签与链接"><input aria-label="测试标签" /></BoardToolPopover></>);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByTestId("board-inspector-text"));
  expect(screen.getByLabelText("测试字体")).toBeVisible();
  fireEvent.click(screen.getByTestId("board-inspector-metadata"));
  expect(screen.queryByLabelText("测试字体")).toBeNull();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(screen.getByTestId("board-inspector-metadata")).toHaveFocus());
});

it("does not reopen a creation palette just because an existing text object is selected", () => {
  render(<BoardBottomDock activeTool="select" creationTool={{ kind: "text", preset: "body" }} readOnly={false} onToolChange={vi.fn()} onCreationToolChange={vi.fn()} onQuickCreate={vi.fn()} onBulkSticky={vi.fn()} onImageRequest={vi.fn()} />);
  expect(screen.getByTestId("board-add-text")).toHaveClass("bg-foreground", "text-background", "hover:bg-foreground/90");
  expect(screen.queryByTestId("board-tool-picker")).toBeNull();
  fireEvent.click(screen.getByTestId("board-add-text"));
  expect(screen.getByTestId("board-tool-picker")).toBeVisible();
  expect(screen.getByTestId("board-text-body")).toHaveClass("bg-primary", "text-primary-foreground", "hover:bg-primary-hover", "hover:text-primary-foreground");
  fireEvent.pointerDown(document.body);
  expect(screen.queryByTestId("board-tool-picker")).toBeNull();
  for (const tool of ["sticky", "shape", "draw", "connector", "frame"]) expect(screen.getByTestId(`board-add-${tool}`)).toHaveClass("min-h-14", "min-w-14");
});
