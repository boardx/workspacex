import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasFieldCompleteness } from "@/components/chat/canvas-field-completeness";
afterEach(cleanup);

describe("canvas header completeness", () => {
  it("shows the exact missing journey stage names instead of silently accepting blank headers", () => {
    render(<CanvasFieldCompleteness lang="canvas" code={"模板: journey-map\n## 阶段1行为\n- 新生学情诊断"} />);
    expect(screen.getByRole("status").textContent).toContain("阶段1、阶段2、阶段3、阶段4、阶段5");
  });
  it("clears the notice once all stage definitions are provided", () => {
    const fields = Array.from({ length: 5 }, (_, i) => `阶段${i + 1}: 教学阶段${i + 1}`).join("\n");
    render(<CanvasFieldCompleteness lang="canvas" code={`模板: journey-map\n${fields}\n## 阶段1行为\n- 新生学情诊断`} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("does not require header fields for templates that have none", () => {
    render(<CanvasFieldCompleteness lang="canvas" code={"模板: adlib\n我们的:\n- 课程"} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
