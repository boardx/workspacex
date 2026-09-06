import { afterEach, describe, expect, it, vi } from "vitest";
import { RunInterjectionController } from "../../src/interface/controllers/run-interjection.controller";
import type { AgentRunStore, ModelCallPort } from "../../src/application/agent-run/ports";
import type { InterjectionStore } from "../../src/application/agent-run/interjection-store";
import type { ToolPermissionGrantStore } from "../../src/application/agent-run/tool-permission-grants";
import { pausePlanRun } from "../../src/application/plan-control/pause-plan-run";
import { resumePlanRun } from "../../src/application/plan-control/resume-plan-run";
import type { PlanRunStatusReader } from "../../src/application/plan-control/ports";
import { toOrgId } from "../../src/domain/org-id";

const orgId = toOrgId("org-a");
const input = { orgId, threadId: "thread-a", actorId: "user-a" };
afterEach(() => vi.unstubAllEnvs());

describe("run control authorization and truthful state", () => {
  it("rejects missing service identity before even looking up tenant data", async () => {
    vi.stubEnv("DEEP_AGENT_SERVICE_INTERNAL_KEY", "");
    const findLocator = vi.fn();
    const controller = new RunInterjectionController({ findLocator } as unknown as AgentRunStore,
      {} as InterjectionStore, {} as ToolPermissionGrantStore);
    await expect(controller.poll(undefined, "run-a", {})).rejects.toMatchObject({ status: 401 });
    expect(findLocator).not.toHaveBeenCalled();
  });

  it("does not poll or ACK a run that is outside the provided organization", async () => {
    vi.stubEnv("DEEP_AGENT_SERVICE_INTERNAL_KEY", "secret");
    const pollForKernel = vi.fn();
    const controller = new RunInterjectionController({ findLocator: vi.fn().mockResolvedValue(null) } as unknown as AgentRunStore,
      { pollForKernel } as unknown as InterjectionStore, {} as ToolPermissionGrantStore);
    await expect(controller.poll("secret", "run-a", { orgId: "other-org", acknowledgedIds: ["one"] }))
      .rejects.toMatchObject({ status: 404 });
    expect(pollForKernel).not.toHaveBeenCalled();
  });

  it("revokes old-direction grants before delivering steering and retains pending pause", async () => {
    vi.stubEnv("DEEP_AGENT_SERVICE_INTERNAL_KEY", "secret");
    const revokeAllForRun = vi.fn().mockResolvedValue(undefined);
    const controller = new RunInterjectionController({ findLocator: vi.fn().mockResolvedValue({ threadId: "t" }) } as unknown as AgentRunStore,
      { pollForKernel: vi.fn().mockResolvedValue([{ interjectionId: "one", text: "换成新方向", classification: "direction_change", receivedAt: "2026-09-07T00:00:00Z" }]),
        isPauseRequested: vi.fn().mockResolvedValue(true) } as unknown as InterjectionStore,
      { revokeAllForRun } as unknown as ToolPermissionGrantStore);
    const result = await controller.poll("secret", "run-a", { orgId, acknowledgedIds: [] });
    expect(revokeAllForRun).toHaveBeenCalledWith(orgId, "run-a");
    expect(result.pauseRequested).toBe(true);
    expect(result.interjections[0]?.interjectionId).toBe("one");
  });

  it("pause only queues intent and never cancels a tool or claims a confirmed pause", async () => {
    const cancelRun = vi.fn(), markRunPaused = vi.fn(), requestPause = vi.fn().mockResolvedValue(true);
    const runs = { getLatestRun: vi.fn().mockResolvedValue({ runId: "run-a", status: "running", pausedAt: null,
      modelProvider: "deep-agent", remoteRunId: "remote" }), markRunPaused } as unknown as PlanRunStatusReader;
    const result = await pausePlanRun({ runs, engine: { cancelRun },
      interjections: { requestPause } as unknown as InterjectionStore,
      model: { supportsLiveInterjections: () => true } as unknown as ModelCallPort,
      provenance: { append: vi.fn().mockResolvedValue("audit-a"), appendWithin: vi.fn().mockResolvedValue("audit-a") } }, input);
    expect(result.status).toBe("pause_requested");
    expect(requestPause).toHaveBeenCalledWith(orgId, "run-a");
    expect(cancelRun).not.toHaveBeenCalled();
    expect(markRunPaused).not.toHaveBeenCalled();
  });

  it("resume uses the same logical run checkpoint rather than synthetic chat", async () => {
    const createConfirmedRun = vi.fn(), resumeCheckpoint = vi.fn().mockResolvedValue({ runId: "run-a" });
    const result = await resumePlanRun({
      runs: { getLatestRun: vi.fn().mockResolvedValue({ runId: "run-a", pausedAt: "2026-09-07T00:00:00Z" }) } as unknown as PlanRunStatusReader,
      runCreator: { createConfirmedRun, resumeCheckpoint }, provenance: { append: vi.fn().mockResolvedValue("audit-a"), appendWithin: vi.fn().mockResolvedValue("audit-a") },
    }, input);
    expect(result.runId).toBe("run-a");
    expect(resumeCheckpoint).toHaveBeenCalledWith({ ...input, runId: "run-a" });
    expect(createConfirmedRun).not.toHaveBeenCalled();
  });
});
