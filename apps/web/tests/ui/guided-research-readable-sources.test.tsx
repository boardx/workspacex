import * as React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { getResearchRuntime } from "@/lib/guided-research-api";
import { GuidedResearchSources } from "@/components/research-studio/guided-research-sources";
import { runtimeFixture } from "../guided-runtime-fixture";
it("shows Chinese reading metadata inline while linking to the original source", () => {
  const source = { ...runtimeFixture("research").sources[0]!, title: "Energy outlook", content: "Original evidence", presentation: { title: "储能市场展望", summary: "分析欧洲储能市场的增长与并网条件。" } };
  render(<GuidedResearchSources sources={[source]} disabled={false} onAdd={vi.fn()} onRemove={vi.fn()} />);
  expect(screen.getByRole("link", { name: "储能市场展望" })).toHaveAttribute("href", source.url);
  expect(screen.getByText(source.presentation.summary)).toBeVisible();
  expect(screen.queryByText("已筛选")).not.toBeInTheDocument();
});

vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
it("does not offer a no-op search when all tasks and reading metadata are complete", async () => {
  const state = runtimeFixture("research");
  state.tasks = state.tasks.map((task) => ({ ...task, status: "succeeded" }));
  state.sources = state.sources.map((source) => ({ ...source, presentation: { title: "政策资料", summary: "政策的适用范围。" } }));
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
  await screen.findByTestId("research-sources");
  expect(screen.queryByRole("button", { name: /搜索资料|继续搜索|更新资料|补充搜索/ })).not.toBeInTheDocument();
});
