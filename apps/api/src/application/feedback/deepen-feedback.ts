/**
 * `deepenFeedback`（UC-17.8 B4.4）—— 反馈列表/详情「更复杂？去 PM 设计工作台深化」→
 * `POST /feedback/:id/deepen`：建一个设计项目（`name`=反馈 `title`、`problem`=反馈 `detail`、
 * `template` 恒 `"wireframe"`），调用方直接跳到它的详情页（PDF §9 建议，原型跳工作台首页）。
 *
 * 契约：`packages/contracts/src/design-workbench.ts` 的 `deepenFeedback`（`in`/`out`/幂等/权限
 * 说明都在那份头注里，本文件不重复）。
 *
 * ## 为什么这个用例文件在 `feedback/` 目录，不在 `design-workbench/` 目录
 *
 * 同契约放在 `design-workbench.ts` 的理由相反：**用例的主语是这条反馈**——它读反馈行、
 * 判反馈的 D3 正文可见性,只是"深化"这个动作的落点恰好是另一束的资源（设计项目）。放在
 * `feedback/` 让这条用例与 `submit-feedback.ts`/`triage-feedback.ts` 挨在一起,复用同一个
 * `ProductFeedbackRepository`/`decideFeedbackDetailVisibility` 依赖组,不必把
 * `design-workbench/project-shared.ts` 的 owner 名字解析、`DesignProjectDeps` 那一整套
 * 拉进来（本用例创建后就返回,不需要那一层的 owner 可见性投影，直接用
 * `project-shared.ts` 的 `projectDesignProject` 投影函数即可,见下方）。
 *
 * ## D3 门控：深化要求对这条反馈的正文有可见权
 *
 * `problem` 字段照抄反馈 `detail` 原文——对正文没有可见权的人（既不是提交人也不是管理员）
 * 就不能把它抄进一个组织内全员可读的设计项目里，那等于绕开 D3 把正文散播出去。用同一个
 * `decideFeedbackDetailVisibility` + `discloseDecided`（`list-feedback.ts`/
 * `feedback-detail-decision.ts` 已建立的路径），不可见时抛 `FeedbackDetailNotVisibleError`
 * （契约 `FEEDBACK_DETAIL_NOT_VISIBLE`），不是静默把 `problem` 填成空字符串——那样会悄悄建出
 * 一个内容对不上反馈本意的项目，比拒绝更容易造成困惑。
 *
 * ## 幂等：交给仓储的 `createOrGetByLinkedFeedback`，用例层不做"先查后插"
 *
 * 见 `project-ports.ts` 头注与迁移 `20260904160000_uc178_b44_deepen_feedback_uniq.sql`——
 * 幂等键是 `feedbackId`，由 DB 唯一索引 + `ON CONFLICT ... DO NOTHING` 保证，不是这里先
 * `findByLinkedFeedback` 判断存不存在、不存在再建（那两步之间有窗口，见迁移头注）。
 */
import { designWorkbench } from "@repo/contracts";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { OrgRole } from "../../domain/identity/roles";
import { decideFeedbackDetailVisibility } from "./feedback-detail-decision";
import { FeedbackNotFoundError } from "./triage-feedback";
import type { ProductFeedbackRepository } from "./ports";
import { projectDesignProject, type DesignProjectView } from "../design-workbench/project-shared";
import type { DesignProjectRepository } from "../design-workbench/project-ports";
import type { FeedbackSubmitterDirectory } from "./notification-ports";

/** 请求者对这条反馈没有 D3 正文可见权（契约 `FEEDBACK_DETAIL_NOT_VISIBLE`）。 */
export class FeedbackDetailNotVisibleError extends Error {}

export interface DeepenFeedbackDeps {
  readonly feedback: ProductFeedbackRepository;
  readonly projects: DesignProjectRepository;
  readonly submitters?: FeedbackSubmitterDirectory;
  readonly newDecisionId: () => string;
  readonly newProjectId: () => string;
}

export interface DeepenFeedbackInput {
  readonly feedbackId: string;
  readonly viewerId: string;
  /** null = 不是本组织成员（此时不可能有正文可见权，见 `decideFeedbackDetailVisibility`） */
  readonly viewerOrgRole: OrgRole | null;
  readonly viewerTeamId: string | null;
}

export async function deepenFeedback(
  deps: DeepenFeedbackDeps,
  input: DeepenFeedbackInput,
): Promise<{ readonly project: DesignProjectView; readonly created: boolean }> {
  const feedback = await deps.feedback.findById(input.feedbackId, input.viewerId);
  if (feedback === null) throw new FeedbackNotFoundError();

  const decision = decideFeedbackDetailVisibility({
    decisionId: deps.newDecisionId(),
    viewerId: input.viewerId,
    viewerOrgRole: input.viewerOrgRole,
    viewerTeamId: input.viewerTeamId,
    submittedBy: feedback.submittedBy,
  });
  const outcome = discloseDecided(feedback.detail, decision);
  if (!isDisclosed(outcome)) throw new FeedbackDetailNotVisibleError();

  const { project: row, created } = await deps.projects.createOrGetByLinkedFeedback({
    id: deps.newProjectId(),
    ownerId: input.viewerId,
    name: feedback.title,
    template: "wireframe",
    problem: outcome.payload,
    criteria: designWorkbench.DESIGN_PROJECT_INITIAL_CRITERIA,
    frames: designWorkbench.DESIGN_PROJECT_INITIAL_FRAMES,
    prototype: [],
    linkedFeedbackId: input.feedbackId,
  });

  // owner 显示名——同 `project-shared.ts` 的 `ownerNamesFor`，不复用那个函数：它接的是
  // `DesignProjectDeps`（含 `orgId: OrgId`），本用例没有那个类型的自然值可以塞，直接查一次
  // 更直白（同一份"怎么查一个人的名字"端口，`FeedbackSubmitterDirectory`，不是第二份实现）。
  const ownerName =
    deps.submitters !== undefined ? (await deps.submitters.displayNamesForUserIds([row.ownerId])).get(row.ownerId) ?? null : null;
  return { project: projectDesignProject(row, ownerName), created };
}
