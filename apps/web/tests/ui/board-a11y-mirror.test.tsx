import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardA11yMirror } from "@/components/whiteboard/fabric/board-a11y-mirror";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const object = (id: string, orderKey: string, text: string, kind: BoardFabricObject["kind"] = "sticky"): BoardFabricObject => ({
  id,
  kind,
  revision: 1,
  orderKey,
  geometry: { x: 0, y: 0, width: 200, height: 140, rotation: 0 },
  style: { fill: "#f8d76e", textColor: "#29261e" },
  content: { text },
});

describe("Board accessibility object mirror", () => {
  it("exposes canonical object ids, order, kinds, names, and selection through accessible controls", () => {
    const onSelect = vi.fn();
    const objects = [object("b", "b", "Beta", "rectangle"), object("a", "a", "Alpha")];
    const view = render(<BoardA11yMirror objects={objects} selectedObjectIds={[]} onSelect={onSelect} readOnly={false} />);
    const mirror = screen.getByRole("region", { name: "白板对象大纲" });
    const buttons = within(mirror).getAllByRole("button");
    const first = buttons[0];
    const second = buttons[1];
    if (!first || !second) throw new Error("Object outline did not render both canonical objects");

    expect(buttons.map((button) => button.closest("li")?.getAttribute("data-object-id"))).toEqual(["a", "b"]);
    expect(within(mirror).getByRole("button", { name: "图形：Alpha" })).toBe(first);
    expect(within(mirror).getByRole("button", { name: "图形：Beta" })).toBe(second);
    expect(first).toHaveAccessibleDescription("对象类型：便利贴");
    expect(second).toHaveAccessibleDescription("对象类型：矩形");
    expect(first).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("a");

    view.rerender(<BoardA11yMirror objects={objects} selectedObjectIds={["a"]} onSelect={onSelect} readOnly={false} />);
    expect(screen.getByTestId("board-a11y-object-a")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("board-a11y-selection-announcement")).toHaveTextContent("已选择 1 个对象");
  });

  it("keeps the same selection path available in readonly mode without claiming edit access", () => {
    const onSelect = vi.fn();
    render(<BoardA11yMirror objects={[object("a", "a", "Readonly note")]} selectedObjectIds={[]} onSelect={onSelect} readOnly />);

    expect(screen.getByText("只读模式；可浏览和选择对象。")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "图形：Readonly note" });
    expect(button).toHaveAccessibleDescription("对象类型：便利贴");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("updates text and removes deleted ids instead of retaining a second stale object model", () => {
    const onSelect = vi.fn();
    const view = render(<BoardA11yMirror objects={[object("a", "a", "Before"), object("b", "b", "Delete me")]} selectedObjectIds={["a"]} onSelect={onSelect} readOnly={false} />);

    view.rerender(<BoardA11yMirror objects={[{ ...object("a", "a", "After"), revision: 2 }]} selectedObjectIds={["a"]} onSelect={onSelect} readOnly={false} />);

    expect(screen.queryByRole("button", { name: /Before/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete me/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "图形：After" })).toHaveAttribute("aria-pressed", "true");
  });

  it("uses the object kind as the stable name fallback without merging its type into the name", () => {
    render(<BoardA11yMirror objects={[object("empty", "a", "", "ellipse")]} selectedObjectIds={[]} onSelect={vi.fn()} readOnly={false} />);

    const button = screen.getByRole("button", { name: "图形：椭圆" });
    expect(button).toHaveAccessibleDescription("对象类型：椭圆");
  });

  it("announces an unsupported object placeholder without exposing a canonical write path", () => {
    const onSelect = vi.fn();
    render(<BoardA11yMirror objects={[{ ...object("future", "a", "暂不支持“frame”对象，内容已安全保留。", "placeholder"), locked: true, projectionIssue: { code: "BOARD_OBJECT_UNSUPPORTED", sourceKind: "frame", message: "暂不支持“frame”对象，内容已安全保留。" } }]} selectedObjectIds={[]} onSelect={onSelect} readOnly={false} />);

    const placeholder = screen.getByRole("button", { name: "图形：暂不支持“frame”对象，内容已安全保留。" });
    expect(placeholder).toHaveAccessibleDescription("对象类型：暂不支持的对象");
    expect(placeholder).toBeDisabled();
    fireEvent.click(placeholder);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
