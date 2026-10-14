import { materializeArtifact, type MaterializeDeps } from "../artifact/materialize-artifact";
import { toOrgId } from "../../domain/org-id";
import { DiscoveryArtifact, DiscoveryFrameBoundary, DiscoveryMapBoundary } from "@repo/contracts/discovery-execution";

export interface DiscoveryPublication {
  orgId: string;
  instanceId: string;
  initiatorUserId: string;
  input: Record<string, unknown>;
  prior: Readonly<Record<string, unknown>>;
}

/** File-first exploratory output. Materialization verifies bytes before recording the immutable version. */
export async function publishDiscovery(deps: MaterializeDeps, args: DiscoveryPublication): Promise<Record<string, unknown>> {
  const map = DiscoveryMapBoundary.parse(args.prior.map);
  const frame = DiscoveryFrameBoundary.parse(args.prior.frame);
  const title = typeof args.input.intent === "string" ? args.input.intent : "产品探索";
  const sections = ["hypothesize", "plan_interviews", "gather", "synthesize", "adjudicate", "frame", "map"];
  const text = [title, "", "证据等级：探索级（exploratory-provisional）",
    ...sections.flatMap(stageId => ["", `## ${stageId}`, JSON.stringify(args.prior[stageId], null, 2)])].join("\n");
  const provenance = { workflowId: "W027", instanceId: args.instanceId,
    evidenceGrade: "exploratory-provisional", semanticSupportVerified: false,
    reviews: Object.fromEntries(Object.entries(args.prior).filter(([key]) => key.startsWith("review_"))) };
  const result = await materializeArtifact(deps, {
    // A trigger-supplied project ID cannot grant write authority. Project binding needs its own adapter.
    orgId: toOrgId(args.orgId), projectId: null,
    source: "ai-generated", title, actorId: args.initiatorUserId,
    versionCreatorKind: "agent", versionChangeSource: "materialize",
    parts: { "content.md": Buffer.from(text + "\n"), "provenance.json": Buffer.from(JSON.stringify(provenance) + "\n") },
  });
  return DiscoveryArtifact.parse({ ...result, kind: "discovery_artifact", title,
    frame, map, digest: result.contentHash, evidenceGrade: "exploratory-provisional" });
}
