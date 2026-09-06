import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PlanPhaseIndicator } from "@/components/plan-control/plan-phase-indicator";
it("shows cancelled as stopped rather than a successful or failed phase", () => {
  render(<PlanPhaseIndicator phase="cancelled" />);
  expect(screen.getByRole("status")).toHaveTextContent("已停止");
  expect(screen.queryByText("完成")).not.toBeInTheDocument();
  expect(screen.queryByText("失败")).not.toBeInTheDocument();
});
