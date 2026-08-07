import { describe, expect, it } from "vitest";
import type { Feature, RoadmapPhase } from "./types";
import { compileGraphInput, featureNodeId, phaseNodeId, projectNodeId, verificationNodeId } from "./graph-compiler";
import { serializeGraphSnapshot } from "./graph-stable";

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: "F01",
    priority: 1,
    area: "harness",
    title: "Graph kernel",
    user_visible_behavior: "Graph is deterministic",
    status: "in_progress",
    sprint: "01",
    owner: "codex",
    depends_on: [],
    verification: ["pnpm test graph"],
    evidence: "",
    notes: "",
    ...overrides,
  };
}

const phase00: RoadmapPhase = {
  id: "00",
  slug: "kernel",
  name: "Kernel",
  goal: "Base",
  status: "in_progress",
  depends_on: [],
};

describe("compileGraphInput", () => {
  it("从领域模型编译稳定节点、类型边和精确 source pointer", () => {
    const command = "pnpm test graph";
    const snapshot = compileGraphInput(
      {
        project: "WorkspaceX",
        roadmapPath: ".harness/state/roadmap.yaml",
        phases: [
          {
            phase: phase00,
            featureList: { phase: "00", features: [feature()] },
            featurePath: "phases/phase-00-kernel/feature_list.json",
          },
        ],
      },
      "sha-1"
    );

    expect(snapshot.nodes.map((node) => node.id)).toEqual([
      featureNodeId("00", "F01"),
      phaseNodeId("00"),
      projectNodeId("WorkspaceX"),
      verificationNodeId("00", "F01", command),
    ].sort());
    expect(snapshot.edges.map((edge) => edge.type).sort()).toEqual(["contains", "contains", "verified_by"]);
    expect(snapshot.nodes.find((node) => node.id === featureNodeId("00", "F01"))?.source).toEqual({
      path: "phases/phase-00-kernel/feature_list.json",
      pointer: "/features/0",
    });
    expect(snapshot.nodes.find((node) => node.type === "Verification")?.source.pointer).toBe(
      "/features/0/verification/0"
    );
  });

  it("自然语言依赖保留为 ExternalReference，不猜成不存在的 feature", () => {
    const snapshot = compileGraphInput(
      {
        project: "WorkspaceX",
        phases: [
          {
            phase: phase00,
            featureList: {
              phase: "00",
              features: [feature({ depends_on: ["通知内核等待设计"] })],
            },
            featurePath: "phases/phase-00-kernel/feature_list.json",
          },
        ],
      },
      "sha-1"
    );
    const external = snapshot.nodes.find((node) => node.type === "ExternalReference");
    expect(external?.properties).toEqual({ label: "通知内核等待设计" });
    expect(snapshot.edges).toContainEqual(
      expect.objectContaining({ type: "depends_on", from: featureNodeId("00", "F01"), to: external?.id })
    );
  });

  it("相同 source revision 连续编译字节一致", () => {
    const input = {
      project: "WorkspaceX",
      phases: [{ phase: phase00, featureList: { phase: "00", features: [feature()] }, featurePath: "f.json" }],
    };
    expect(serializeGraphSnapshot(compileGraphInput(input, "same-sha"))).toBe(
      serializeGraphSnapshot(compileGraphInput(input, "same-sha"))
    );
  });

  it("不吞掉权威源中的重复 Feature ID，把坏输入留给身份门控", () => {
    const snapshot = compileGraphInput(
      {
        project: "WorkspaceX",
        phases: [
          {
            phase: phase00,
            featureList: { phase: "00", features: [feature(), feature({ title: "duplicate" })] },
            featurePath: "f.json",
          },
        ],
      },
      "sha"
    );
    expect(snapshot.nodes.filter((node) => node.id === featureNodeId("00", "F01"))).toHaveLength(2);
  });
});
