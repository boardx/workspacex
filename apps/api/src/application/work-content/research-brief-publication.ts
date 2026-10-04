import { materializeArtifact, type MaterializeDeps, type MaterializeResult } from "../artifact/materialize-artifact";
import { toOrgId } from "../../domain/org-id";
import type { ResearchBriefOutput } from "../../domain/work-content/research-brief";

export interface ResearchBriefPublication {
  orgId: string;
  initiatorUserId: string;
  brief: ResearchBriefOutput;
  provenance: Record<string, unknown>;
}

/** Native file-first artifact: successful return means both Markdown and provenance bytes were read-back verified. */
export function publishResearchBrief(deps: MaterializeDeps, args: ResearchBriefPublication): Promise<MaterializeResult> {
  const lines = [args.brief.title, "", "结论", ...args.brief.claims.map(c =>
    `${c.text}\n来源：${c.evidenceRefs.join("、")}；置信度：${c.confidence}`), "", "风险", ...args.brief.risks.map(c =>
    `${c.text}\n来源：${c.evidenceRefs.join("、")}；置信度：${c.confidence}`)];
  return materializeArtifact(deps, {
    orgId: toOrgId(args.orgId), projectId: null, source: "ai-generated", title: args.brief.title,
    actorId: args.initiatorUserId, versionCreatorKind: "agent", versionChangeSource: "materialize",
    parts: {
      "content.md": Buffer.from(lines.join("\n\n") + "\n", "utf8"),
      "provenance.json": Buffer.from(JSON.stringify({ ...args.provenance, synthesized: true, briefDigest: args.brief.digest }) + "\n", "utf8"),
    },
  });
}
