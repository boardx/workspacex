import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ResearchChaptersWorkspace } from "@/components/research-studio/research-chapters-workspace";
import { prototypeRuntime } from "@/components/research-studio/research-prototype-fixture";

it("renders the chapter-to-report action as the prototype's primary action and preserves navigation", () => {
  const next = vi.fn();
  render(<ResearchChaptersWorkspace runtime={prototypeRuntime()} disabled={false} onSave={vi.fn()} onOptimize={vi.fn()} onNext={next} />);
  const button = screen.getByRole("button", { name: "下一步：生成报告" });
  expect(button).toHaveClass("bg-primary", "text-primary-foreground");
  fireEvent.click(button);
  expect(next).toHaveBeenCalledOnce();
});
