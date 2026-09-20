import * as React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GuidedResearchSources } from "@/components/research-studio/guided-research-sources";
import { runtimeFixture } from "../guided-runtime-fixture";
it("shows Chinese reading metadata inline while linking to the original source", () => {
  const source = { ...runtimeFixture("research").sources[0]!, title: "Energy outlook", content: "Original evidence", presentation: { title: "储能市场展望", summary: "分析欧洲储能市场的增长与并网条件。" } };
  render(<GuidedResearchSources sources={[source]} disabled={false} onAdd={vi.fn()} onRemove={vi.fn()} />);
  expect(screen.getByRole("link", { name: "储能市场展望" })).toHaveAttribute("href", source.url);
  expect(screen.getByText(source.presentation.summary)).toBeVisible();
  expect(screen.queryByText("已筛选")).not.toBeInTheDocument();
});
