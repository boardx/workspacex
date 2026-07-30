/**
 * 访谈范围与两种权限投影 —— 洋葱最内层。
 *
 * 这里不知道 HTTP、不知道 PostgreSQL，只知道一件事：**给定一场访谈和一个看的人，
 * 他该不该看见**。SQL 谓词是这条规则的第二次表达（`pg-interview-scope-repository.ts`），
 * 两者必须同义 —— `scope-nullable-project-projection.test.ts` 用同一组样本同时喂给两边，
 * 谁跑偏了都会红。
 *
 * ## 为什么是「两种投影」而不是一条带 OR 的规则
 *
 * 写成一条也能跑：`创建者 ∨ 协作者 ∨ 项目成员`，`project_id IS NULL` 时第三项自然落空。
 * 但那样一来「无项目访谈只对创建者+显式协作者可见」（I-31）就成了一个**副作用**，
 * 而不是一条被声明、被断言、能被单独指着看的规则。本项目已经九次栽在
 * 「门控全绿但空转」上，而空转最常见的形态就是「那条规则其实没人写，是恰好成立的」。
 *
 * 所以：投影先被**判定**（`projectionFor`），再被**应用**（`canRead`），
 * 判定结果本身可断言。
 *
 * ## 这里刻意没有的东西
 *
 * · **没有组织管理员旁路。** usecases.md 的 `getInterview` pre 只有三项，R5 还补了一句
 *   「项目负责人不因职位自动获得跨项目/无项目访谈的读权」。给这里加一个
 *   `|| viewer.isOrgAdmin` 会把那句话直接作废。管理员的项目层读取是**另一条路径**
 *   （写审计、对项目负责人可见，D-18），不是在这里放行。
 * · **没有 research project 的成员模型。** `kind: "research"` 的可见性走的是
 *   与「无项目」同一条投影，因为 research project 在 phase-01 既没有表也没有成员概念
 *   （domain.md [待定 D-1]）。编一个出来会让它看起来已经被覆盖。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";

export type InterviewScopeKindName = z.infer<typeof interview.InterviewScopeKind>;
export type InterviewSourceKindName = z.infer<typeof interview.InterviewSourceKind>;
/** 契约的 `InterviewScope` 值对象；这里只取类型，绝不重声明形状。 */
export type ScopeSelector = z.infer<typeof interview.InterviewScope>;

/**
 * 两种投影，按 `projectId` 是否为空分岔。
 *
 * · `creator-and-collaborators` —— 无项目（也用于 research 范围，见文件头）
 * · `creator-collaborators-and-project-members` —— 有项目，是**并集**不是替换
 */
export type VisibilityProjection =
  | "creator-and-collaborators"
  | "creator-collaborators-and-project-members";

export function projectionFor(projectId: string | null): VisibilityProjection {
  return projectId === null
    ? "creator-and-collaborators"
    : "creator-collaborators-and-project-members";
}

/** 一场访谈里与可见性有关的那几个字段。不是整个实体 —— 这里判不了别的。 */
export interface InterviewVisibilityFacts {
  readonly projectId: string | null;
  readonly createdBy: string;
  /** 是否在 `interview_collaborators` 里有这一行。**显式**，不是推导出来的。 */
  readonly isExplicitCollaborator: boolean;
}

export interface ViewerFacts {
  readonly userId: string;
  /** 该组织内此人有成员身份的项目 id。只用于第二种投影。 */
  readonly projectIds: readonly string[];
}

/**
 * 能不能读这一场。
 *
 * 返回 boolean 而不是抛异常：拒绝是**可解释的数据**，而且调用方还要据此写审计
 * （I-31 的后半句「并写审计」）—— 异常会把「因为什么被拒」丢在半路。
 */
export function canRead(i: InterviewVisibilityFacts, viewer: ViewerFacts): boolean {
  if (i.createdBy === viewer.userId) return true;
  if (i.isExplicitCollaborator) return true;
  // ⚠ 这一段**只在有项目时**存在。`projectId === null` 时函数到此为止 ——
  // 那正是 I-31 那句「不因无项目而全组织可见」的落点。
  if (i.projectId !== null && viewer.projectIds.includes(i.projectId)) return true;
  return false;
}

/**
 * 范围选择器自身是否自洽。
 *
 * 契约的 `InterviewScope` 是 `{ kind, projectId: string|null, researchProjectId: string|null }`，
 * zod 层面**允许** `{ kind: "none", projectId: "p-1" }` 这种自相矛盾的组合 ——
 * 三个字段之间的关系不是 zod 能表达的（已在报告里作为契约缺口列出）。
 * 没有这道检查，`kind: "none"` 带着一个 projectId 进来时，实现要么忽略它、要么按它过滤，
 * 两种都是静默地做了调用方没要求的事。
 */
export function scopeIsCoherent(scope: ScopeSelector): boolean {
  switch (scope.kind) {
    case "project":
      return scope.projectId !== null && scope.researchProjectId === null;
    case "research":
      return scope.researchProjectId !== null && scope.projectId === null;
    case "none":
      return scope.projectId === null && scope.researchProjectId === null;
  }
}

/**
 * 这个档位该不该出现在切换器里。
 *
 * `SCOPE_NOT_VISIBLE` 的语义是「该档位**不显示**」而不是「显示后报错」
 * （usecases.md 失败模式表）。所以它是关于**范围**的判断，与「这一场能不能看」是两件事：
 * 一个项目成员看得见 `project:P` 这个档位，但档位里仍然只列出他能看的那几场。
 *
 * `none` 恒可见：每个人都可以有自己的独立访谈，看不到别人的**不是**「无权查看本范围」，
 * 是「本范围无访谈」—— V7 要求这两种空态文案不同，把 `none` 判成不可见会把它们混成一种。
 */
export function scopeVisibleTo(scope: ScopeSelector, viewer: ViewerFacts): boolean {
  switch (scope.kind) {
    case "project":
      return scope.projectId !== null && viewer.projectIds.includes(scope.projectId);
    case "research":
    case "none":
      return true;
  }
}

export const SOURCE_KINDS = interview.InterviewSourceKind.options;
export const SCOPE_KINDS = interview.InterviewScopeKind.options;
