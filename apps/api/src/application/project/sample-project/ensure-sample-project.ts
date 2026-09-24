/**
 * backlog E2 —— `ensureSampleProject`：新组织一落地就有一个内置、脱敏、可立即提问的示例项目。
 *
 * 同 `ensureDefaultAgent`（#662）的形状：组织创建时（`/auth/bootstrap`、`/auth/register-open`）
 * 调一次，`scripts/backfill-sample-projects.ts` 在每次部署时给存量组织补一次。
 *
 * ## 不新造写路径
 *   · 容器走 `createProject`（本仓创建项目的唯一路径，含组织角色判定与 fingerprint 幂等）；
 *   · 材料走 `uploadArtifact`（F35 的服务端重校验 + 对象存储 + `STORED` 落库，
 *     并由 `materializeArtifact` 入队 ingestion outbox `EXTRACTED`）——索引由既有的
 *     ingestion worker 在本地异步完成，本用例本身**不发任何外部调用**（离线可用）。
 *   · 示例标记走 `project_tags`（`ProjectTagsRepository.updateTags`），不往 `projects` 加列
 *     （I-P33 封闭列集）。
 *
 * ## 幂等 + 可续跑
 * 顺序是「查标记 → 建容器 → 传材料 → 打标记」，标记**最后**打：
 *   · 已有标记（含已归档）⇒ 直接返回，不再种——用户归档/删除后不会被补种脚本种回来；
 *   · 中途失败重跑：`createProject` 的 fingerprint 重放返回同一容器（同 actor），
 *     `uploadArtifact` 按 content hash 去重（`duplicate: true`，不产生新版本），然后补打标记。
 * 已知边界：用户若手动把「内置示例」标签删掉而不归档，下一次补种会再建（fingerprint 相同
 * 的 actor 会重放回同一个容器，不会重复；不同 actor 会新建一个）。
 */
import type { OrgId } from "../../../domain/org-id";
import { createProject, type CreateProjectDeps } from "../create-project";
import type { ProjectTagsRepository } from "../ports";
import { uploadArtifact, type UploadArtifactDeps } from "../../files/upload-artifact";
import {
  SAMPLE_DOCUMENTS,
  SAMPLE_PROJECT_KIND,
  SAMPLE_PROJECT_NAME,
  SAMPLE_PROJECT_TAG,
  type SampleDocument,
} from "./sample-project-content";

export interface SampleProjectLookup {
  /** 本组织带 `tag` 的项目 id（含已归档）；没有则 null。 */
  findProjectIdByTag(orgId: OrgId, tag: string): Promise<string | null>;
}

export interface EnsureSampleProjectDeps {
  readonly project: CreateProjectDeps;
  readonly upload: UploadArtifactDeps;
  readonly tags: ProjectTagsRepository;
  readonly lookup: SampleProjectLookup;
  /** 测试注入用；缺省即 `SAMPLE_DOCUMENTS`。 */
  readonly documents?: readonly SampleDocument[];
}

export interface EnsureSampleProjectResult {
  readonly projectId: string;
  readonly created: boolean;
}

export class SampleProjectSeedError extends Error {}

/** 装配好依赖的种子函数（`infrastructure/project/sample-project-seeder.ts` 产出）。 */
export type SampleProjectSeeder = (input: { orgId: OrgId; actorId: string }) => Promise<EnsureSampleProjectResult>;
export const SAMPLE_PROJECT_SEEDER = Symbol("SampleProjectSeeder");

export async function ensureSampleProject(
  deps: EnsureSampleProjectDeps,
  input: { readonly orgId: OrgId; readonly actorId: string },
): Promise<EnsureSampleProjectResult> {
  const existing = await deps.lookup.findProjectIdByTag(input.orgId, SAMPLE_PROJECT_TAG);
  if (existing !== null) return { projectId: existing, created: false };

  const project = await createProject(deps.project, {
    orgId: input.orgId,
    actorId: input.actorId,
    name: SAMPLE_PROJECT_NAME,
    kind: SAMPLE_PROJECT_KIND,
    blueprintVersionId: null,
  });

  const encoder = new TextEncoder();
  const uploaded = await uploadArtifact(deps.upload, {
    orgId: input.orgId,
    projectId: project.id,
    agendaSegmentId: null,
    confidential: false,
    actorId: input.actorId,
    files: (deps.documents ?? SAMPLE_DOCUMENTS).map((d) => ({ filename: d.filename, bytes: encoder.encode(d.body) })),
  });
  const rejected = uploaded.files.filter((f) => f.status === "rejected");
  if (rejected.length > 0) {
    // 不打标记：下一次调用（或补种脚本）会从这里续跑。
    throw new SampleProjectSeedError(
      `sample project upload rejected: ${rejected.map((f) => `${f.filename}:${f.status === "rejected" ? f.reason.kind : ""}`).join(",")}`,
    );
  }

  const tagged = await deps.tags.updateTags(input.orgId, project.id, [SAMPLE_PROJECT_TAG]);
  if (tagged.kind !== "updated") throw new SampleProjectSeedError("sample project vanished before tagging");

  return { projectId: project.id, created: project.created };
}
