/**
 * 项目筹备（定题/分组）的真实 API 薄封装（F950，2026-08-16 delta）。
 *
 * `templates` 束各自成文件，不塞进 `live-projects.ts`（那是 `project` 束自己的封装）——
 * 同 `live-blueprints.ts` 已经确立的先例。类型从 `@repo/contracts` 推导，不重新声明。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProjectPrepOut = z.infer<typeof templates.operations.getProjectPrep.out>;
export type ProjectTopicOut = z.infer<typeof templates.operations.getProjectTopic.out>;
export type ProjectGroupingOut = z.infer<typeof templates.operations.getProjectGrouping.out>;
export type Group = z.infer<typeof templates.Group>;

export async function getProjectPrep(projectId: string): Promise<ProjectPrepOut> {
  return apiRequest<ProjectPrepOut>(
    templates.operations.getProjectPrep.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "GET" },
  );
}

export async function getProjectTopic(projectId: string): Promise<ProjectTopicOut> {
  return apiRequest<ProjectTopicOut>(
    templates.operations.getProjectTopic.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "GET" },
  );
}

export interface SaveTopicInput {
  readonly projectId: string;
  readonly title: string;
  readonly background: string;
  readonly expectedTopicRevision: string;
}

/** ⚠ AI 生成入口本版未接（同 `new-project-flow.tsx` 对未接能力的处置纪律），恒传 `aiGenerated: null`。 */
export async function saveProjectTopic(
  input: SaveTopicInput,
): Promise<z.infer<typeof templates.operations.saveAndSyncTopic.out>> {
  return apiRequest(
    templates.operations.saveAndSyncTopic.path.replace(":projectId", encodeURIComponent(input.projectId)),
    {
      method: "PUT",
      body: {
        projectId: input.projectId,
        title: input.title,
        background: input.background,
        expectedTopicRevision: input.expectedTopicRevision,
        aiGenerated: null,
      },
    },
  );
}

export async function getProjectGrouping(projectId: string): Promise<ProjectGroupingOut> {
  return apiRequest<ProjectGroupingOut>(
    templates.operations.getProjectGrouping.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "GET" },
  );
}

export interface SaveGroupingInput {
  readonly projectId: string;
  readonly groupCount: number | null;
  readonly groups: readonly Group[];
  readonly expectedRevision: string;
}

export async function saveProjectGrouping(input: SaveGroupingInput): Promise<Group[]> {
  return apiRequest<Group[]>(
    templates.operations.updateGrouping.path.replace(":projectId", encodeURIComponent(input.projectId)),
    {
      method: "PUT",
      body: {
        projectId: input.projectId,
        groupCount: input.groupCount,
        groups: input.groups,
        expectedRevision: input.expectedRevision,
      },
    },
  );
}

export const GROUP_STATUS_LABEL: Record<z.infer<typeof templates.GroupStatus>, string> = {
  "recording-ready": "录音就绪",
  "short-n": "缺人",
  "needs-intervention": "需介入",
};
