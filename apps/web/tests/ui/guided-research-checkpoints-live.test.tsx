import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";

const api = vi.hoisted(() => ({
  listGuidedResearchSessions: vi.fn(), createGuidedResearchSession: vi.fn(), getGuidedResearchSession: vi.fn(),
  generateResearchDirections: vi.fn(), confirmResearchDirections: vi.fn(), generateResearchOutline: vi.fn(), confirmResearchOutline: vi.fn(),
}));

vi.mock("@/lib/guided-research-api", () => api);

const baseSession = {
  sessionId: "grs-f169", title: "欧洲储能", brief: {
    topic: "欧洲储能", goal: "选择进入市场", timeRange: "2025", region: "欧洲", focus: "规模",
  },
  briefVersion: 1, briefConfirmedAt: "2026-08-13T00:00:00.000Z",
  directions: { candidateVersion: null, confirmedVersion: null, versions: [] },
  outline: { candidateVersion: null, confirmedVersion: null, versions: [] },
  stage: "directions", resumeStage: "directions", status: "active", progress: 20, sourceCount: 0, reportId: null,
  createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
};

beforeEach(() => { Object.values(api).forEach((mock) => mock.mockReset()); });

describe("F169 guided research live checkpoints", () => {
  it("loads a generated direction candidate, saves human edits, and then enters outline", async () => {
    api.getGuidedResearchSession.mockResolvedValueOnce(baseSession);
    api.generateResearchDirections.mockResolvedValueOnce({
      ...baseSession,
      directions: { candidateVersion: 1, confirmedVersion: null, versions: [{
        version: 1, items: [{ id: "d1", title: "候选方向", description: "候选描述", enabled: true, order: 0 }],
        createdAt: "2026-08-13T00:01:00.000Z", confirmedAt: null,
      }] },
    });
    api.confirmResearchDirections.mockResolvedValueOnce({
      ...baseSession, stage: "outline", resumeStage: "outline",
      directions: { candidateVersion: 2, confirmedVersion: 2, versions: [{
        version: 2, items: [{ id: "d1", title: "人工编辑方向", description: "候选描述", enabled: true, order: 0 }],
        createdAt: "2026-08-13T00:02:00.000Z", confirmedAt: "2026-08-13T00:02:00.000Z",
      }] },
    });
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="directions" sessionId="grs-f169" onStepChange={onStepChange} />);

    expect(await screen.findByDisplayValue("候选方向", {}, { timeout: 5_000 })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("research-direction-title-d1"), { target: { value: "人工编辑方向" } });
    fireEvent.click(screen.getByTestId("research-confirm-directions"));

    await waitFor(() => expect(api.confirmResearchDirections).toHaveBeenCalledWith("grs-f169", expect.objectContaining({
      candidateVersion: 1, directions: [expect.objectContaining({ title: "人工编辑方向" })],
    })));
    expect(onStepChange).toHaveBeenCalledWith("outline", "grs-f169");
  });

  it("keeps confirmation disabled when every direction is disabled", async () => {
    api.getGuidedResearchSession.mockResolvedValueOnce({
      ...baseSession, directions: { candidateVersion: 1, confirmedVersion: null, versions: [{
        version: 1, items: [{ id: "d1", title: "方向", description: "描述", enabled: true, order: 0 }],
        createdAt: "2026-08-13T00:01:00.000Z", confirmedAt: null,
      }] },
    });
    render(<GuidedResearchFlow step="directions" sessionId="grs-f169" />);
    await screen.findByDisplayValue("方向");
    fireEvent.click(screen.getByLabelText("启用方向 1"));
    expect(screen.getByTestId("research-confirm-directions")).toBeDisabled();
  });

  it("loads and confirms an edited non-empty outline", async () => {
    const outlined = {
      ...baseSession, stage: "outline", resumeStage: "outline",
      outline: { candidateVersion: 1, confirmedVersion: null, versions: [{
        version: 1, items: [{ id: "o1", title: "候选章节", questions: ["问题"], enabled: true, order: 0 }],
        createdAt: "2026-08-13T00:02:00.000Z", confirmedAt: null,
      }] },
    };
    api.getGuidedResearchSession.mockResolvedValueOnce(outlined);
    api.confirmResearchOutline.mockResolvedValueOnce({ ...outlined, stage: "researching", resumeStage: "researching" });
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="outline" sessionId="grs-f169" onStepChange={onStepChange} />);
    expect(await screen.findByDisplayValue("候选章节")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("research-outline-title-o1"), { target: { value: "人工编辑章节" } });
    fireEvent.click(screen.getByTestId("research-start-search"));
    await waitFor(() => expect(api.confirmResearchOutline).toHaveBeenCalledWith("grs-f169", expect.objectContaining({
      candidateVersion: 1, outline: [expect.objectContaining({ title: "人工编辑章节" })],
    })));
    expect(onStepChange).toHaveBeenCalledWith("search", "grs-f169");
  });
});
