/**
 * F39 -- requestAiFillMissingMaterial（`[让 AI 补齐缺料]`, uc-22-2 A4 / V13）.
 *
 * ## Mechanism delegated to `materializeArtifact` (F04), same discipline `landAsArtifact`
 * (F114) already established for `source: "ai-generated"`
 *
 * Bytes, hash, version lineage: all reused unchanged. `synthesized` is NEVER taken from the
 * caller (`materializeArtifact` derives it from `source === "ai-generated"` -- a request that
 * could say "generated but not synthesized" is exactly the disguise D-27/A4 forbid, and the
 * schema already refuses that combination). `MATERIALIZATION_PLAN["ai-generated"]`'s two
 * required files (`content.md`, `provenance.json`) are both written here; this feature adds
 * no third file.
 *
 * ## `provenance.json`'s seven keys
 *
 * `contracts/files/design-signoff.md`'s prose (mirrored verbatim in
 * `apps/web/components/files/review-panel.tsx`'s `files-review-synth` block) names them:
 * prompt / model / model_version / run_id / 输入 Context Pack / 生成时间 / 触发者. Every one
 * is written below, `contextPackId` explicitly `null` rather than omitted when none was
 * supplied -- a MISSING key is what `PROVENANCE_MISSING` (N-12) exists to catch, and an
 * omitted-vs-null distinction here would make that check parse the file to tell them apart.
 *
 * ## Why this is unconditionally `REVIEW_PENDING`, never `READY`
 *
 * `materializeArtifact`'s `ingestionStatus` passthrough is set explicitly rather than left to
 * default -- an AI-generated candidate is D-27's "AI 生成一律落草稿态" restated for files:
 * the fork this feature's OWN gate (`review-gate.ts`) would otherwise decide is skipped
 * because there is no decision to make here, only one legal answer (V13④). The contract's
 * `out.state` types this as `z.literal("REVIEW_PENDING")` for the same reason: this is not a
 * runtime branch that happens to land on REVIEW_PENDING every time in practice, it is a
 * value with no other member.
 */
import type { ArtifactRepository, IdFactory, ObjectStore } from "../artifact/ports";
import { materializeArtifact } from "../artifact/materialize-artifact";
import type { ProvenanceWriter } from "../provenance/ports";
import type { OrgId } from "../../domain/org-id";

export interface RequestAiFillMissingMaterialInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly agendaSegmentId: string;
  /** 「材料要求」列的文案，A4：agent 依据它生成候选材料。也是 provenance 的 `prompt`。 */
  readonly requirement: string;
  readonly actorId: string;
  readonly model?: string;
  readonly modelVersion?: string;
  readonly contextPackId?: string | null;
}

export interface RequestAiFillMissingMaterialDeps {
  readonly store: ObjectStore;
  readonly repo: ArtifactRepository;
  readonly ids: IdFactory;
  readonly provenance: ProvenanceWriter;
  readonly now?: () => string;
}

export interface RequestAiFillMissingMaterialResult {
  readonly artifactId: string;
  readonly ingestionRunId: string;
  /** ⚠ 恒为 REVIEW_PENDING -- 契约上不存在「直接就绪」这条路径（V13④）。 */
  readonly state: "REVIEW_PENDING";
}

const DEFAULT_MODEL = "workspacex-ai-fill-v1";
const DEFAULT_MODEL_VERSION = "1";

export async function requestAiFillMissingMaterial(
  deps: RequestAiFillMissingMaterialDeps,
  input: RequestAiFillMissingMaterialInput,
): Promise<RequestAiFillMissingMaterialResult> {
  const generatedAt = (deps.now ?? (() => new Date().toISOString()))();
  const runId = deps.ids.next("run");
  const model = input.model ?? DEFAULT_MODEL;
  const modelVersion = input.modelVersion ?? DEFAULT_MODEL_VERSION;
  const contextPackId = input.contextPackId ?? null;

  const content =
    `# AI 补齐缺料\n\n` +
    `环节材料要求：${input.requirement}\n\n` +
    `本文件由 agent 依据以上材料要求生成，是候选材料而非一手证据，` +
    `在人接受（转 READY）之前不进入检索召回范围。`;

  const provenanceJson = JSON.stringify({
    prompt: input.requirement,
    model,
    modelVersion,
    runId,
    contextPackId,
    generatedAt,
    triggeredBy: input.actorId,
  });

  const materialized = await materializeArtifact(
    { store: deps.store, repo: deps.repo, ids: deps.ids },
    {
      orgId: input.orgId,
      projectId: input.projectId,
      source: "ai-generated",
      title: `AI 补料 · ${input.agendaSegmentId}`,
      actorId: input.actorId,
      agendaSegmentId: input.agendaSegmentId,
      // 🔴 A4 / D-27 同源: agent 不得自行把机密标记勾为否 -- 显式声明 false，而不是让
      // `NewArtifact.confidential` 的"未传即列默认值"替它做这个决定。
      confidential: false,
      // 🔴 V13④: 恒为 REVIEW_PENDING。
      ingestionStatus: "REVIEW_PENDING",
      versionCreatorKind: "agent",
      versionAgentRunId: runId,
      versionChangeSource: "materialize",
      parts: {
        "content.md": new TextEncoder().encode(content),
        "provenance.json": new TextEncoder().encode(provenanceJson),
      },
    },
  );

  await deps.provenance.append({
    orgId: input.orgId,
    type: "generated",
    actorId: input.actorId,
    target: { kind: "artifact", id: materialized.artifactId },
    detail: {
      agendaSegmentId: input.agendaSegmentId,
      requirement: input.requirement,
      versionId: materialized.versionId,
      runId,
      synthesized: true,
    },
  });

  return {
    artifactId: materialized.artifactId,
    ingestionRunId: materialized.versionId,
    state: "REVIEW_PENDING",
  };
}
