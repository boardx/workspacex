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

/**
 * ⚠ AI 生成入口本版未接（同 `new-project-flow.tsx` 对未接能力的处置纪律），恒传 `aiGenerated: null`。
 *
 * ⚠ **body 里不带 `projectId`**（F961 修，2026-08-18）：`projectId` 是**路径参数**，
 *   controller 的 body schema 是 `saveAndSyncTopic.in.omit({ projectId: true })`——
 *   而契约那个 object 是 `.strict()`，`.omit()` 保留 strict，所以 body 里多带一个
 *   `projectId` 会被 zod 判成未知字段，整个请求 **400**。
 *   F950 当初这么写并且全绿，是因为组件测试里 `fetch` 是 mock 的——它只记录 body，
 *   不会像真的 zod 那样拒绝。这个 bug 由 F961 的真栈 e2e
 *   （`e2e/interview-subjects-smoke.spec.ts`）第一次跑出来，见该文件头注。
 *   下方 `saveProjectGrouping` / `saveInterviewSubjects` 同理，三处是同一个 bug。
 */
export async function saveProjectTopic(
  input: SaveTopicInput,
): Promise<z.infer<typeof templates.operations.saveAndSyncTopic.out>> {
  return apiRequest(
    templates.operations.saveAndSyncTopic.path.replace(":projectId", encodeURIComponent(input.projectId)),
    {
      method: "PUT",
      body: {
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
      // ⚠ 同 `saveProjectTopic` 头注：`projectId` 是路径参数，不进 body（strict 会 400）。
      body: {
        groupCount: input.groupCount,
        groups: input.groups,
        expectedRevision: input.expectedRevision,
      },
    },
  );
}

/* ─────────────── F961：观察/访谈对象表（后端由 F960 落地，本次接前端） ─────────────── */

export type InterviewSubject = z.infer<typeof templates.InterviewSubject>;
export type InterviewSubjectsOut = z.infer<typeof templates.operations.getInterviewSubjects.out>;

function subjectsPath(projectId: string, groupId: string): string {
  return templates.operations.getInterviewSubjects.path
    .replace(":projectId", encodeURIComponent(projectId))
    .replace(":groupId", encodeURIComponent(groupId));
}

export async function getInterviewSubjects(projectId: string, groupId: string): Promise<InterviewSubjectsOut> {
  return apiRequest<InterviewSubjectsOut>(subjectsPath(projectId, groupId), { method: "GET" });
}

export interface SaveInterviewSubjectsInput {
  readonly projectId: string;
  readonly groupId: string;
  readonly subjects: readonly InterviewSubject[];
  readonly expectedRevision: string;
}

export async function saveInterviewSubjects(
  input: SaveInterviewSubjectsInput,
): Promise<InterviewSubject[]> {
  return apiRequest<InterviewSubject[]>(subjectsPath(input.projectId, input.groupId), {
    method: "PUT",
    // ⚠ 同 `saveProjectTopic` 头注：`projectId`/`groupId` 都是路径参数，不进 body。
    body: {
      subjects: input.subjects,
      expectedRevision: input.expectedRevision,
    },
  });
}

/** 六列表头——逐字照 `uc-2-2` R3 第 6 步与契约 `InterviewSubject` 的字段顺序，不另起一套叫法。 */
export const INTERVIEW_SUBJECT_COLUMNS: ReadonlyArray<{
  key: keyof Omit<InterviewSubject, "subjectId">;
  label: string;
}> = [
  { key: "name", label: "对象" },
  { key: "role", label: "部门角色" },
  { key: "contact", label: "联系方式" },
  { key: "focus", label: "背景与要问什么" },
  { key: "method", label: "方式" },
  { key: "status", label: "状态" },
];

export const GROUP_STATUS_LABEL: Record<z.infer<typeof templates.GroupStatus>, string> = {
  "recording-ready": "录音就绪",
  "short-n": "缺人",
  "needs-intervention": "需介入",
};
