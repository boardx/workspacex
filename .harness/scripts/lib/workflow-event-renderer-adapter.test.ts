import { describe, it, expect } from "vitest";
import { makeWorkflowEventRenderer, toInstanceMetadata, GENERATED_EVENTS_DIR } from "./workflow-event-renderer-adapter";
import { runRenderPipeline } from "./render-pipeline";
import { parseGeneratedHeader, verifyContentHash } from "./generated-metadata";
import type { ProgressWorkflowEvent } from "./workflow-event-model";
import type { RenderContext } from "./renderer-model";

const CTX: RenderContext = { repoRoot: "/repo", revision: "abcdef1234567" };

function makeEvent(overrides: Partial<ProgressWorkflowEvent> = {}): ProgressWorkflowEvent {
  return {
    template_id: "TPL-EVT-001",
    template_version: 1,
    instance_id: "EVT-422-0001",
    kind: "progress",
    task_id: "TSK-422-e2-01",
    actor: "dev-chat-e2e",
    head_sha: "b975e6f6",
    evidence_refs: ["PR #894"],
    delta: { implemented: ["四件已合并"] },
    blockers: [],
    next_action: { owner_role: "dev-chat-e2e", action: "HMV2-017" },
    sourceFile: ".harness/events/EVT-422-0001.yaml",
    ...overrides,
  };
}

describe("toInstanceMetadata 桥接", () => {
  it("envelope → InstanceMetadata：status=active、phase=null、refs=evidence_refs", () => {
    const meta = toInstanceMetadata(makeEvent());
    expect(meta).toMatchObject({
      template_id: "TPL-EVT-001",
      instance_id: "EVT-422-0001",
      status: "active",
      scope: { project: "workspacex", phase: null },
      refs: ["PR #894"],
    });
  });
});

describe("makeWorkflowEventRenderer（收编 H3A-035）", () => {
  it("走完整管道：产出落 generated/events/，标题行是 H3A-035 的逐字格式", () => {
    const event = makeEvent();
    const renderer = makeWorkflowEventRenderer([event]);
    const { files, issues } = runRenderPipeline(renderer, toInstanceMetadata(event), CTX);
    expect(issues).toEqual([]);
    expect(files[0]?.path).toBe(`${GENERATED_EVENTS_DIR}/EVT-422-0001.md`);
    const { parsed } = parseGeneratedHeader(files[0]!.path, files[0]!.finalContent);
    expect(verifyContentHash(parsed!).ok).toBe(true);
    // H3A-035 §13.2 逐字标题格式：task_id · kind · 短 SHA——收编零改动渲染逻辑的证据
    expect(parsed?.body.split("\n")[0]).toBe("TSK-422-e2-01 · progress · b975e6f");
  });

  it("反证：实例不在本批事件集合 → 抛错拒绝渲染，不静默出空内容", () => {
    const renderer = makeWorkflowEventRenderer([makeEvent()]);
    const stranger = toInstanceMetadata(makeEvent({ instance_id: "EVT-999-0099" }));
    expect(() => renderer.render(stranger, CTX)).toThrow(/不在本批事件集合/);
  });

  it("12 行预算被保留（H3A-035 的核心约束在收编后仍然成立）", () => {
    const noisy = makeEvent({
      evidence_refs: Array.from({ length: 10 }, (_, i) => `EVD-${i}`),
      blockers: Array.from({ length: 10 }, (_, i) => `blocker-${i}`),
      delta: { implemented: Array.from({ length: 10 }, (_, i) => `impl-${i}`) },
    });
    const renderer = makeWorkflowEventRenderer([noisy]);
    const { files } = runRenderPipeline(renderer, toInstanceMetadata(noisy), CTX);
    const { parsed } = parseGeneratedHeader(files[0]!.path, files[0]!.finalContent);
    expect(parsed!.body.trimEnd().split("\n").length).toBeLessThanOrEqual(12);
  });
});
