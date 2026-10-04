import { W001 } from "./definitions/W001";
import { toResearchRuntimeDefinition } from "./workflow-definition";

/** New version: never mutate the published v1 initiator-only approval / side-effect declaration. */
export function researchPublicationDefinition() {
  const definition = toResearchRuntimeDefinition({ ...W001, version: 2 });
  return { ...definition, stages: definition.stages.map(stage => stage.stageId === "review_brief"
    ? { ...stage, humanGate: { approverRoles: ["admin"], approverUserIds: [], allowSelfApproval: false, onDenyStageId: null } }
    : stage.stageId === "publish" ? { ...stage, capabilityCategories: ["artifact.write" as const], sideEffect: "write" as const } : stage) };
}
