/**
 * Artifact 的两个写入点（都不在 `interface` 层——两者都由 run 的执行路径回调，不是
 * 用户直接发起的 HTTP 操作）：
 *
 *  1. `createArtifactFromToolOutput` —— R3 步骤 1：agent 一次工具调用产出文件类结果时，
 *     网关创建一个新的 Artifact 实体（`version=1`），而不是仅作为聊天附件落库。
 *     调用点：`kernel-gateway` 束 `proxyToolExecution`（coverage.md「跨束委托」——本文件
 *     只提供"建 Artifact"这一步，"工具调用产出的字节怎么写进对象存储"不在这里）。
 *
 *  2. `recordArtifactContinuationOutcome` —— R3 步骤 5 / I-3：`continueArtifact` 触发的
 *     run 结束时回调。**成功**才追加新版本；**失败**（`status: "failed"`）不产生任何
 *     版本，返回 `null`——失败的尝试不计入版本历史，这是本文件唯一的分支逻辑，也是
 *     `artifact-versioning.test.ts` 的核心断言。
 */
import type { artifactsSteering as AS } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { ArtifactClock, ArtifactStore, CreateArtifactInput } from "./ports";

export interface RecordArtifactDeps {
  readonly artifacts: ArtifactStore;
  readonly clock: ArtifactClock;
}

export async function createArtifactFromToolOutput(
  deps: RecordArtifactDeps,
  input: {
    readonly orgId: OrgId;
    readonly threadId: string;
    readonly name: string;
    readonly kind: AS.ArtifactKind;
    readonly producedByRunId: string;
    readonly producedByStepId: string;
    readonly changeNote: string;
    readonly storageKey: string;
    readonly sizeBytes: number;
  },
): Promise<AS.ArtifactRecord> {
  const create: CreateArtifactInput = {
    id: deps.clock.newArtifactId(),
    threadId: input.threadId,
    name: input.name,
    kind: input.kind,
    producedByRunId: input.producedByRunId,
    producedByStepId: input.producedByStepId,
    changeNote: input.changeNote,
    storageKey: input.storageKey,
    sizeBytes: input.sizeBytes,
  };
  return deps.artifacts.createArtifact(input.orgId, create);
}

export interface ArtifactContinuationOutcome {
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly runId: string;
  readonly runStepId: string;
  readonly changeNote: string;
  /** `failed` ⇒ I-3：不创建内容为空/损坏的版本，失败的尝试不计入版本历史。 */
  readonly status: "succeeded" | "failed";
  /** 仅 `status: "succeeded"` 时必填——失败时压根没有产出内容可以指向。 */
  readonly output?: { readonly storageKey: string; readonly sizeBytes: number };
}

export async function recordArtifactContinuationOutcome(
  deps: { readonly artifacts: ArtifactStore },
  outcome: ArtifactContinuationOutcome,
): Promise<AS.ArtifactVersionInfo | null> {
  if (outcome.status === "failed") return null;
  if (!outcome.output) {
    // 契约层面的自相矛盾（succeeded 却没有产出）——防御性拒绝，而不是造一个空 storageKey。
    throw new Error("recordArtifactContinuationOutcome: succeeded outcome missing output");
  }
  return deps.artifacts.appendVersion(outcome.orgId, {
    artifactId: outcome.artifactId,
    producedByRunId: outcome.runId,
    producedByStepId: outcome.runStepId,
    changeNote: outcome.changeNote,
    storageKey: outcome.output.storageKey,
    sizeBytes: outcome.output.sizeBytes,
  });
}
