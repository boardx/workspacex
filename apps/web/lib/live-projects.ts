/**
 * F122 —— 真实 API 的类型化薄封装，供 `/project/live` 页面使用。
 *
 * 类型全部从 `@repo/contracts` 推导，不重新声明——同一份形状两处声明正是本仓
 * AGENTS.md 点名的事故模式（设计 token / 字号档位 / …）。
 */
import { project } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProjectListItem = z.infer<typeof project.ProjectListItem>;
export type ListProjectsOut = z.infer<typeof project.operations.listProjects.out>;
export type CreateProjectOut = z.infer<typeof project.operations.createProject.out>;

/**
 * `login` 已提到 `./auth.ts`（issue #355）——两个真实入口
 * （`(entry)/login`、`/project/live`）共用同一份实现，这里只做转发，
 * 不重新声明，避免和 F122 之前的做法一样再长出第二份。
 */
export { login, type LoginOut } from "./auth";

export async function listProjects(orgId: string): Promise<ListProjectsOut> {
  return apiRequest<ListProjectsOut>(project.operations.listProjects.path, {
    method: "GET",
    query: { orgId },
  });
}

/**
 * F353 —— 按 id 找一个项目的真实基本信息。
 *
 * 用已经真实挂了的 `listProjects` 复用扁平列表（F185 之前是两段，那条裁决已被
 * 2026-08-16 推翻），按 id 查——能拿到的字段就是 `ProjectListItem` 那六个
 * （id/name/kind/status/readOnlyReason/tags）。`readOnlyReason` 是
 * `getProjectOverview` 不返回的字段（白名单四件里没有它），只需要粗粒度身份 +
 * 只读原因的场景（工作台顶部项目头）继续用它。
 *
 * ⚠ 需要更完整的概览（`currentAgendaSegment`/`roleCounts`/`backflow`/`blueprint`）
 *   请用下面的 `getProjectOverview`——控制器的 `@Get` 路由其实早已由 F123 挂好
 *   （`project.controller.ts` 的 `overview()`），此前这里的注释误以为它没挂，
 *   已在 issue #362 更正。
 */
export async function findProject(orgId: string, projectId: string): Promise<ProjectListItem | null> {
  const out = await listProjects(orgId);
  return out.find((p) => p.id === projectId) ?? null;
}

export type ProjectOverview = z.infer<typeof project.operations.getProjectOverview.out>;
export type BackflowEntry = ProjectOverview["backflow"][number];

/**
 * 回流徽标中文标签——单一声明处。F362（`tab-overview.tsx`）与 F964（`tab-results.tsx`）
 * 两处都要显示同一份 `BackflowEntry.badge` 三值闭枚举，之前只在 `tab-overview.tsx`
 * 里私有声明；现在有第二个消费点，按 AGENTS.md「同一事实不得声明在两处」收成这一处，
 * 两个组件都从这里 import，不各自抄一份。
 */
export const BACKFLOW_BADGE_LABEL: Record<BackflowEntry["badge"], string> = {
  draft: "草稿",
  live: "实时 · 随源变动",
  pinned: "已定版",
};

/**
 * F362 —— 真实 `GET /projects/:projectId/overview`。不需要 `orgId`：契约
 * `getProjectOverview.in` 只收 `{ projectId }`，`orgId` 在服务端取自
 * `principal.orgId`（同 `advance`/`archive` 几条路由的形状）。
 */
export async function getProjectOverview(projectId: string): Promise<ProjectOverview> {
  return apiRequest<ProjectOverview>(
    project.operations.getProjectOverview.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "GET" },
  );
}

export const PROJECT_KIND_LABEL: Record<z.infer<typeof project.ProjectKind>, string> = {
  workshop: "工作坊",
  research_project: "研究项目",
  user_insight: "用户洞察",
};

export const PROJECT_STATUS_LABEL: Record<z.infer<typeof project.ProjectStatus>, string> = {
  active: "进行中",
  archived: "已归档",
};

export interface CreateProjectInput {
  readonly orgId: string;
  readonly name: string;
  readonly kind: z.infer<typeof project.ProjectKind>;
  readonly blueprintVersionId: string | null;
}

export async function createProject(input: CreateProjectInput): Promise<CreateProjectOut> {
  return apiRequest<CreateProjectOut>(project.operations.createProject.path, {
    method: "POST",
    body: input,
  });
}

export const PROJECT_KIND_OPTIONS = project.ProjectKind.options;

export type ArchiveProjectOut = z.infer<typeof project.operations.archiveProject.out>;
export type UnarchiveProjectOut = z.infer<typeof project.operations.unarchiveProject.out>;

/**
 * F164 —— 真实 `POST /projects/:projectId/archive` / `…/unarchive`。
 *
 * 与 `getProjectOverview` 同形：契约 `in` 只收 `{ projectId }`，`orgId` 在服务端取自
 * `principal.orgId`，所以这里不传组织。
 *
 * ⚠ 归档失败面有一条**无错误码**的路径：U-2⑵「有进行中环节时拒绝归档」后端已在
 *   `project.controller.ts` 拦截，但抛的是裸 400（`KNOWN_CONTRACT_GAPS.P7`），
 *   `ApiError.reasonCode` 为空。调用方**不要替它编一个原因**——见 issue #999。
 */
export async function archiveProject(projectId: string): Promise<ArchiveProjectOut> {
  return apiRequest<ArchiveProjectOut>(
    project.operations.archiveProject.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "POST" },
  );
}

export async function unarchiveProject(projectId: string): Promise<UnarchiveProjectOut> {
  return apiRequest<UnarchiveProjectOut>(
    project.operations.unarchiveProject.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "POST" },
  );
}

export type UpdateProjectTagsOut = z.infer<typeof project.operations.updateProjectTags.out>;

/**
 * F185（2026-08-16 delta）—— 真实 `PATCH /projects/:projectId/tags`。整体替换语义：
 * 传入的 `tags` 就是替换后的全集，不是增量 add/remove。
 */
export async function updateProjectTags(projectId: string, tags: readonly string[]): Promise<UpdateProjectTagsOut> {
  return apiRequest<UpdateProjectTagsOut>(
    project.operations.updateProjectTags.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "PATCH", body: { projectId, tags } },
  );
}

export const PROJECT_TAGS_MAX = project.PROJECT_TAGS_MAX;

export type AgendaSegment = z.infer<typeof project.AgendaSegment>;
export type CreateAgendaSegmentOut = z.infer<typeof project.operations.createAgendaSegment.out>;
export type ListAgendaSegmentsOut = z.infer<typeof project.operations.listAgendaSegments.out>;

/**
 * #853 —— 真实 `POST /workshops/:workshopId/agenda-segments`（UC-P6，`createAgendaSegment`）。
 *
 * `createAgendaSegment` 有 controller 挂了整整一个 feature（#627），但直到 #853 之前
 * `apps/web` 里零调用方——用户造不出议程环节，`bindTemplateToSegment`（#493）因此永远
 * 没有可绑的目标。本函数是它的第一个真实调用方。
 *
 * ⚠ 建出来的初始态恒 `pending`（服务端 `PgAgendaSegmentRepository.create` 逐字），
 *   不是「建完就是当前环节」——调用方不要在本地把它渲染成「当前」。
 */
export async function createAgendaSegment(input: {
  readonly workshopId: string;
  readonly agendaSegmentDefinitionId: string | null;
  readonly ordinal: number;
  readonly title: string;
  readonly duration: number;
}): Promise<CreateAgendaSegmentOut> {
  return apiRequest<CreateAgendaSegmentOut>(
    project.operations.createAgendaSegment.path.replace(":workshopId", encodeURIComponent(input.workshopId)),
    {
      method: "POST",
      body: {
        workshopId: input.workshopId,
        agendaSegmentDefinitionId: input.agendaSegmentDefinitionId,
        ordinal: input.ordinal,
        title: input.title,
        duration: input.duration,
      },
    },
  );
}

/**
 * #853 —— 真实 `GET /workshops/:workshopId/agenda-segments`（`listAgendaSegments`）。
 *
 * 契约签了跟 `createAgendaSegment` 一样久（同一次签核），此前也是全仓零 controller——
 * 没有它，`createAgendaSegment` 建出来的环节（初始 `pending`）在任何真实读路径里都
 * 不可见（`getProjectOverview` 只回 `state='active'` 那一条）。#853 把它跟建的入口
 * 一起补上，两者缺一，「建了 → 刷新 → 还在」这条闭环都做不出来。
 */
export async function listAgendaSegments(workshopId: string): Promise<ListAgendaSegmentsOut> {
  return apiRequest<ListAgendaSegmentsOut>(
    project.operations.listAgendaSegments.path.replace(":workshopId", encodeURIComponent(workshopId)),
    { method: "GET" },
  );
}

export const AGENDA_SEGMENT_STATE_LABEL: Record<AgendaSegment["state"], string> = {
  pending: "待开始",
  active: "进行中",
  closed: "已结束",
  skipped: "已跳过",
};

export type AdvanceAgendaSegmentAction = z.infer<typeof project.AgendaSegmentAdvanceAction>;
export type AdvanceAgendaSegmentOut = z.infer<typeof project.operations.advanceAgendaSegment.out>;

/**
 * F963 —— 真实 `POST /workshops/:workshopId/agenda-segments/:segmentId/advance`
 * （`advanceAgendaSegment`，F119 UC-P7）。
 *
 * 契约签了跟 `createAgendaSegment`/`listAgendaSegments` 一样久、controller 也早挂好了
 * （`project.controller.ts` 的 `advance()`），此前只是没有前端调用方——「现场协作」
 * 主持台的推进/提前结束/跳过/合并四个动作因此全部只能停在 mock。
 *
 * ⚠ body 里**必须**带 `workshopId`/`segmentId`（与路径同值）——不是 F950/F961 那种
 *   路径参数泄漏进 body（见 `lint-body-path-param-leak.mjs`）：这个 controller 的
 *   body schema 是全量 `C.operations.advanceAgendaSegment.in`（未 `.omit()`），
 *   服务端还会显式比对 `body.workshopId !== workshopId`，不一致直接 400
 *   `workshop_or_segment_id_mismatch`——两边取自同一个变量，前端制造不出那种不一致
 *   （同 `bindCanvasTemplateToSegment` 头注一致的先例，该函数已登记进
 *   `.harness/state/body-path-param-leak-allowlist.json`，本函数用同一条豁免）。
 */
export async function advanceAgendaSegment(input: {
  readonly workshopId: string;
  readonly segmentId: string;
  readonly action: AdvanceAgendaSegmentAction;
  readonly mergeIntoSegmentId: string | null;
}): Promise<AdvanceAgendaSegmentOut> {
  return apiRequest<AdvanceAgendaSegmentOut>(
    project.operations.advanceAgendaSegment.path
      .replace(":workshopId", encodeURIComponent(input.workshopId))
      .replace(":segmentId", encodeURIComponent(input.segmentId)),
    {
      method: "POST",
      body: {
        workshopId: input.workshopId,
        segmentId: input.segmentId,
        action: input.action,
        mergeIntoSegmentId: input.mergeIntoSegmentId,
      },
    },
  );
}
