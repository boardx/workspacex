/**
 * `routeTranscriptToGroup` —— 转写自动回流到本组（F99，uc-6-7 R3 步骤 8 / O-05）。
 *
 * ⚠ 未归组对象没有回流目标（A1）：判定发生在取任何引用之前，
 * 见 `SubjectNotGroupedError` / 契约的 `SUBJECT_NOT_GROUPED`。
 * ⚠ `quotesOnly` 完全委托给 `quotesOnlyFor`（domain 层单一实现），
 * 本函数不重复「同意位怎么算」这条规则。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import { quotesOnlyFor } from "../../domain/interview/transcript-backflow";
import type { OrgId } from "../../domain/org-id";
import { SubjectNotGroupedError } from "./errors";
import type {
  ConsentBitsForRouting,
  SubjectGroupLookup,
  TranscriptArtifactSource,
} from "./transcript-backflow-ports";

export type RouteTranscriptToGroupResult = z.infer<typeof interview.operations.routeTranscriptToGroup.out>;

export interface RouteTranscriptToGroupDeps {
  readonly groups: SubjectGroupLookup;
  readonly consent: ConsentBitsForRouting;
  readonly artifacts: TranscriptArtifactSource;
}

export interface RouteTranscriptToGroupCommand {
  readonly orgId: OrgId;
  readonly interviewId: string;
  readonly subjectId: string;
}

export async function routeTranscriptToGroup(
  deps: RouteTranscriptToGroupDeps,
  cmd: RouteTranscriptToGroupCommand,
): Promise<RouteTranscriptToGroupResult> {
  const facts = await deps.groups.find(cmd.orgId, cmd.subjectId);
  if (facts === null || facts.groupId === null) {
    throw new SubjectNotGroupedError(cmd.subjectId);
  }

  const [bits, refs] = await Promise.all([
    deps.consent.latestBits(cmd.orgId, cmd.interviewId, cmd.subjectId),
    deps.artifacts.refsFor(cmd.orgId, cmd.interviewId, cmd.subjectId),
  ]);

  return {
    groupId: facts.groupId,
    artifactRefs: refs.map((r) => ({ artifactId: r.artifactId, versionId: r.versionId })),
    quotesOnly: quotesOnlyFor(bits),
  };
}
