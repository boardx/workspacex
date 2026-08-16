/**
 * 用例：定题读侧（F950，delta / 契约 `templates.getProjectTopic`）。
 *
 * 同 `get-project-prep.ts` 的薄编排：角色门槛 → 仓储读。`null` = 尚未定题时，本用例把它
 * 合成为**空态响应**（`title`/`background` 空串，`revision: "0"`）——契约签的是「空串=空态」，
 * 不是 404，所以「没有行」这个数据库事实要在这里翻译成响应体，不是让 controller 抛错。
 */
import type { ProjectRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { ProjectTopicRepository } from "./save-and-sync-topic-ports";

export type GetProjectTopicErrorCode = "NO_PROJECT_ROLE" | "DEPENDENCY_UNAVAILABLE";

export class GetProjectTopicError extends Error {
  readonly reasonCode: GetProjectTopicErrorCode;

  constructor(reasonCode: GetProjectTopicErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "GetProjectTopicError";
  }
}

export interface GetProjectTopicInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly actorProjectRole: ProjectRole | null;
}

export interface GetProjectTopicDeps {
  readonly repo: ProjectTopicRepository;
}

export interface GetProjectTopicOutput {
  readonly topicId: string;
  readonly title: string;
  readonly background: string;
  readonly revision: string;
}

export async function getProjectTopicUseCase(
  deps: GetProjectTopicDeps,
  input: GetProjectTopicInput,
): Promise<GetProjectTopicOutput> {
  if (input.actorProjectRole === null) throw new GetProjectTopicError("NO_PROJECT_ROLE");

  let row;
  try {
    row = await deps.repo.getTopic(input.orgId, input.projectId);
  } catch {
    throw new GetProjectTopicError("DEPENDENCY_UNAVAILABLE");
  }

  if (row === null) {
    // 空态：`topicId` 用 `projectId` 占位——`saveAndSyncTopic` 第一次写入前，
    // 没有任何一个真实存在的 topicId 可以返回，用容器自己的 id 是唯一不编造的选择。
    return { topicId: input.projectId, title: "", background: "", revision: "0" };
  }
  return row;
}
