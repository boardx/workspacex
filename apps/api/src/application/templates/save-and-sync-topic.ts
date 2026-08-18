/**
 * 用例：定题单点继承（F24 / `uc-2-2` R7 I-13 / 契约 `templates.saveAndSyncTopic`）。
 *
 * 编排顺序：角色门槛 → AI 来源校验 → 仓储 upsert（并发冲突翻译）。
 *
 * ⚠ 只有 `facilitator`（引导师）能保存——原型逐字「**引导师操作**：在『定题与分组』里定项目
 * 主题与背景」；`groupLead`（组长）与 `member`/`observer` 都落在 `ROLE_INSUFFICIENT` 上，
 * 对应 `uc-2-2-prep-member.png` 里「写操作按钮置灰」的组员视角投影（V14）。
 */
import { isAiSourcesSufficient } from "../../domain/templates/project-topic";
import {
  TopicRevisionConflictError,
  type ProjectTopicRepository,
  type SavedTopic,
} from "./save-and-sync-topic-ports";
import type { ProjectRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";

export type SaveAndSyncTopicErrorCode =
  | "NO_PROJECT_ROLE"
  | "ROLE_INSUFFICIENT"
  | "VERSION_CHANGED"
  | "AI_SOURCES_INSUFFICIENT"
  | "DEPENDENCY_UNAVAILABLE";

export class SaveAndSyncTopicError extends Error {
  readonly reasonCode: SaveAndSyncTopicErrorCode;

  constructor(reasonCode: SaveAndSyncTopicErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "SaveAndSyncTopicError";
  }
}

/** 只有引导师——见文件头注,不是「谁都能定题」。 */
export function canSaveTopic(role: ProjectRole | null): boolean {
  return role === "facilitator";
}

export interface SaveAndSyncTopicInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly actorProjectRole: ProjectRole | null;
  readonly title: string;
  readonly background: string;
  readonly expectedTopicRevision: string;
  readonly aiGenerated: { readonly sources: readonly string[] } | null;
}

export interface SaveAndSyncTopicDeps {
  readonly repo: ProjectTopicRepository;
}

export interface SaveAndSyncTopicOutput {
  readonly topicId: string;
  readonly syncedTo: readonly ("grouping" | "agenda" | "ai-context")[];
}

export async function saveAndSyncTopicUseCase(
  deps: SaveAndSyncTopicDeps,
  input: SaveAndSyncTopicInput,
): Promise<SaveAndSyncTopicOutput> {
  if (input.actorProjectRole === null) throw new SaveAndSyncTopicError("NO_PROJECT_ROLE");
  if (!canSaveTopic(input.actorProjectRole)) throw new SaveAndSyncTopicError("ROLE_INSUFFICIENT");

  // 防御性重判：契约 zod `.min(1)` 已经在走 HTTP 时挡住空来源数组,这里再判一次是为了
  // 「直接调用用例函数」这条路径（测试、未来内部调用方）不必依赖调用方先经过 zod（见
  // `domain/templates/project-topic.ts` 头注）。
  if (!isAiSourcesSufficient(input.aiGenerated)) {
    throw new SaveAndSyncTopicError("AI_SOURCES_INSUFFICIENT");
  }

  let saved: SavedTopic;
  try {
    saved = await deps.repo.saveAndSync({
      orgId: input.orgId,
      projectId: input.projectId,
      title: input.title,
      background: input.background,
      expectedTopicRevision: input.expectedTopicRevision,
      aiGenerated: input.aiGenerated,
    });
  } catch (err) {
    if (err instanceof TopicRevisionConflictError) {
      throw new SaveAndSyncTopicError("VERSION_CHANGED");
    }
    throw err;
  }

  return {
    topicId: saved.topicId,
    // ⚠ 三处读的是同一个 topicId——这不是三次不同的写,是同一次 upsert 之后的一个回执。
    syncedTo: ["grouping", "agenda", "ai-context"],
  };
}
