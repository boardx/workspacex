/**
 * `getEvidenceMatrix` —— 证据矩阵读路径 + 观察者脱敏只读投影（F02，phase-11，
 * uc-6-5 R3 step4 / R5，`packages/contracts/src/interview.ts` `EvidenceMatrix`）。
 *
 * ## 这个 feature 补的是什么、复用的是什么
 *
 * `domain/interview/evidence-matrix.ts` 的 `computeCellStrength`/`cellToContractShape`
 * 已经把「给定一格的事实，该显示五取值里的哪一个」判完了——本文件**不重写**那道判定，
 * 只负责「事实从哪来」：把 F01 已经落库的 `interview_insights` +
 * `interview_insight_source_snapshots` 投影成那道判定需要的 `EvidenceCellFacts`。
 *
 * ## ⚠ 已知范围边界（如实报告，不是绕过）
 *
 * 1. **`themeId` 用 `rqId` 代理**——F01 没有建独立的「主题」实体（`mergeThemes`/
 *    `splitThemes` 是 F04 的范围），矩阵的行键借用了已persist的 `rqId`
 *    （`generateCandidateInsights` 默认实现本就按它分组），见
 *    `evidence-matrix-ports.ts` `EvidenceQuoteRow.rqId` 的头注。
 * 2. **`反例`/`附和` 恒为 `false`**——F01 的写路径没有采集"这条证据是反例/是附和"这两个
 *    标记（`interview_quotes`/快照 schema 都没有这两列），本读端如实按"未采集"处理，
 *    不臆造。`computeCellStrength` 依旧被完整调用、五取值的判定逻辑依旧被复用——只是
 *    在这两个输入维度上，本 feature 目前只能喂给它恒定的 `false`。哪个 feature 补上
 *    这两个标记的采集，矩阵就自动开始显示它们，不需要再改这个文件。
 * 3. **矩阵是稀疏的**——只输出至少有一条证据的 (主题, 受访者) 格子，不为 scope 内每个
 *    受访者补齐 `not-mentioned` 占位格。补齐需要该 scope 的完整受访者名单（跨
 *    `interview_subjects`/`groups`/`projects` 的又一次连接），不是"把持久化数据投影
 *    成矩阵"这句 notes 原话要求的东西。`not-mentioned` 这一取值本身仍然可达（见
 *    `evidence-matrix-five-values.test.ts` 的纯逻辑覆盖），只是本读端目前不主动构造它。
 *
 * ## 权限两层
 *
 * ① scope 本身可不可见——复用 `listInterviews` 同一套 `scopeVisibleTo` +
 *    `decideInterviewVisibility`/`discloseDecided` 双重判定（SQL 一次、纯函数再判一次），
 *    不合格一律 `NO_INTERVIEW_ACCESS`（契约本操作没有声明 `SCOPE_NOT_VISIBLE`，两种
 *    拒绝原因在这里合并成契约允许的那一个码）。
 * ② 观察者脱敏——`scope.kind === "project"` 时查看的人若在该项目的 `project_role`
 *    是 `observer`，矩阵格子的 `quoteIds` 一律清空（原始证据的可回链路径，等价于
 *    R5"原始洞察库不可见"这条规则在矩阵上的落点），`strength`/`counterexample`/
 *    `sessionCount`/`subjectCount` 这些**聚合**信号原样保留（沿用
 *    `apps/web/components/project/tab-research.tsx` 的观察者态注释：整块内部过程不可见，
 *    脱敏聚合仍可见）。`research`/`none` 两档没有项目角色模型（与
 *    `domain/interview/scope.ts` 文件头"research 没有成员模型"同一个已知缺口），
 *    本读端对这两档不脱敏。
 */
import { interview as C } from "@repo/contracts";
import type { z } from "zod";
import {
  scopeIsCoherent,
  scopeVisibleTo,
  type ScopeSelector,
} from "../../domain/interview/scope";
import { decideInterviewVisibility } from "../../domain/interview/visibility-decision";
import type { InterviewVisibilityFacts } from "../../domain/interview/scope";
import { cellToContractShape } from "../../domain/interview/evidence-matrix";
import type { OrgRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { DecisionIdFactory } from "../identity/ports";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { NoInterviewAccessError } from "./errors";
import type { InterviewScopeRepository } from "./ports";
import type { EvidenceMatrixReader, EvidenceQuoteRow, ProjectRoleReader } from "./evidence-matrix-ports";

export type GetEvidenceMatrixResult = z.infer<typeof C.operations.getEvidenceMatrix.out>;

export interface GetEvidenceMatrixDeps {
  readonly scope: InterviewScopeRepository;
  readonly decisions: DecisionIdFactory;
  readonly evidence: EvidenceMatrixReader;
  readonly projectRole: ProjectRoleReader;
}

export interface GetEvidenceMatrixInput {
  readonly orgId: OrgId;
  readonly viewerUserId: string;
  readonly scope: ScopeSelector;
}

/** 分页上限的安全阀——见 `list-interviews.ts` 同一立场，不给一个没有上限的循环。 */
const MAX_PAGES = 50;
const PAGE_SIZE = 200;

/** `themeId` 在 `rqId` 为空时的显式兜底键——见文件头「已知范围边界①」。 */
const UNTHEMED_ROW_ID = "unthemed";

function scopeDescriptor(scope: ScopeSelector): string {
  return scope.kind === "project"
    ? `project:${scope.projectId}`
    : scope.kind === "research"
      ? `research:${scope.researchProjectId}`
      : "none";
}

interface VisibleInterviewContext {
  readonly ids: readonly string[];
  /** 按 `interviewId` 缓存的可见性事实——证据行的第二次判定复用同一份，不重新查一次。 */
  readonly factsById: ReadonlyMap<string, InterviewVisibilityFacts>;
}

/**
 * 收集调用者在这个 scope 下可见的全部 `interviewId`——与 `listInterviews` 同一双重判定
 * 手法：仓储 SQL 先过滤一次，`decideInterviewVisibility` 拿同一份事实再判一次，
 * 只可能把可见集合收紧。
 */
async function collectVisibleInterviewContext(
  deps: GetEvidenceMatrixDeps,
  orgId: OrgId,
  viewerUserId: string,
  scope: ScopeSelector,
  viewer: { readonly projectIds: readonly string[] },
  membership: { readonly orgRole: string | null; readonly teamId: string | null },
): Promise<VisibleInterviewContext> {
  const ids: string[] = [];
  const factsById = new Map<string, InterviewVisibilityFacts>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const got = await deps.scope.listVisible({
      orgId, viewerUserId, scope, limit: PAGE_SIZE, cursor,
    });
    for (const { item, facts } of got.rows) {
      const disclosed = discloseDecided(
        item,
        decideInterviewVisibility({
          decisionId: deps.decisions.next(),
          interview: facts,
          viewer: { userId: viewerUserId, projectIds: viewer.projectIds },
          orgRole: membership.orgRole as OrgRole | null,
          viewerTeamId: membership.teamId,
        }),
      );
      if (isDisclosed(disclosed)) {
        ids.push(disclosed.payload.interviewId);
        factsById.set(disclosed.payload.interviewId, facts);
      }
    }
    if (got.nextCursor === null) break;
    cursor = got.nextCursor;
  }
  return { ids, factsById };
}

/**
 * 证据行的第二次判定——`listConfirmedEvidence` 只按 `interviewId ∈ ids` 过滤（RLS + 那一层
 * WHERE），可见性规则本身要在这里用 `decideInterviewVisibility` 再判一遍，与
 * `collectVisibleInterviewContext` 判 `interview_sessions` 行同一套函数、同一份事实——
 * 证据行的可见性绑定的就是它所属那场访谈的可见性，不是另一套规则。
 */
function discloseEvidenceRows(
  deps: GetEvidenceMatrixDeps,
  rows: readonly Guarded<EvidenceQuoteRow>[],
  context: VisibleInterviewContext,
  viewer: { readonly userId: string; readonly projectIds: readonly string[] },
  membership: { readonly orgRole: string | null; readonly teamId: string | null },
): readonly EvidenceQuoteRow[] {
  const out: EvidenceQuoteRow[] = [];
  for (const row of rows) {
    const facts = context.factsById.get(row.ref.id);
    // 不在已收集的可见集合里——仓储层过滤本该已经排除了这种行，这里只可能收紧，不放宽。
    if (facts === undefined) continue;
    const disclosed = discloseDecided(
      row,
      decideInterviewVisibility({
        decisionId: deps.decisions.next(),
        interview: facts,
        viewer,
        orgRole: membership.orgRole as OrgRole | null,
        viewerTeamId: membership.teamId,
      }),
    );
    if (isDisclosed(disclosed)) out.push(disclosed.payload);
  }
  return out;
}

interface CellAccumulator {
  readonly quoteIds: string[];
  anyStrong: boolean;
}

/** 把证据行投影成矩阵——`redact: true` 时清空每个格子的 `quoteIds`（观察者脱敏）。 */
function projectMatrix(rows: readonly EvidenceQuoteRow[], redact: boolean): GetEvidenceMatrixResult {
  const sessionIds = new Set<string>();
  const subjectIds = new Set<string>();
  const byTheme = new Map<string, Map<string, CellAccumulator>>();

  for (const row of rows) {
    sessionIds.add(row.interviewId);
    if (row.subjectId === null) continue; // 无法归属受访者列，见文件头「已知范围边界③」
    subjectIds.add(row.subjectId);

    const themeId = row.rqId ?? UNTHEMED_ROW_ID;
    let bySubject = byTheme.get(themeId);
    if (bySubject === undefined) {
      bySubject = new Map();
      byTheme.set(themeId, bySubject);
    }
    let cell = bySubject.get(row.subjectId);
    if (cell === undefined) {
      cell = { quoteIds: [], anyStrong: false };
      bySubject.set(row.subjectId, cell);
    }
    if (!cell.quoteIds.includes(row.quoteId)) cell.quoteIds.push(row.quoteId);
    if (row.strong) cell.anyStrong = true;
  }

  const themeIds = [...byTheme.keys()].sort();
  const resultRows = themeIds.map((themeId) => {
    const bySubject = byTheme.get(themeId);
    if (bySubject === undefined) throw new Error(`getEvidenceMatrix: theme ${themeId} vanished mid-projection`);
    const subjectKeys = [...bySubject.keys()].sort();
    return {
      themeId,
      cells: subjectKeys.map((subjectId) => {
        const cell = bySubject.get(subjectId);
        if (cell === undefined) throw new Error(`getEvidenceMatrix: cell ${themeId}/${subjectId} vanished mid-projection`);
        const shape = cellToContractShape(subjectId, cell.quoteIds, {
          hasQuotes: cell.quoteIds.length > 0,
          // 见文件头「已知范围边界②」——F01 未采集这两个标记，如实喂 false。
          isCounterexample: false,
          isAppeasement: false,
          rawStrength: cell.anyStrong ? "strong" : "weak",
        });
        return redact ? { ...shape, quoteIds: [] } : shape;
      }),
    };
  });

  return { sessionCount: sessionIds.size, subjectCount: subjectIds.size, rows: resultRows };
}

export async function getEvidenceMatrix(
  deps: GetEvidenceMatrixDeps,
  input: GetEvidenceMatrixInput,
): Promise<GetEvidenceMatrixResult> {
  if (!scopeIsCoherent(input.scope)) throw new NoInterviewAccessError(scopeDescriptor(input.scope));

  const [projectIds, membership] = await Promise.all([
    deps.scope.projectIdsOf(input.orgId, input.viewerUserId),
    deps.scope.orgMembershipOf(input.orgId, input.viewerUserId),
  ]);

  if (membership.orgRole === null) throw new NoInterviewAccessError(scopeDescriptor(input.scope));
  if (!scopeVisibleTo(input.scope, { userId: input.viewerUserId, projectIds })) {
    throw new NoInterviewAccessError(scopeDescriptor(input.scope));
  }

  const context = await collectVisibleInterviewContext(
    deps, input.orgId, input.viewerUserId, input.scope, { projectIds }, membership,
  );

  if (context.ids.length === 0) {
    return { sessionCount: 0, subjectCount: 0, rows: [] }; // A1：真实空态，不编造示例数据
  }

  let isObserver = false;
  if (input.scope.kind === "project" && input.scope.projectId !== null) {
    const role = await deps.projectRole.roleOf(input.orgId, input.viewerUserId, input.scope.projectId);
    isObserver = role === "observer";
  }

  const guardedRows = await deps.evidence.listConfirmedEvidence(input.orgId, context.ids);
  const evidenceRows = discloseEvidenceRows(
    deps, guardedRows, context,
    { userId: input.viewerUserId, projectIds }, membership,
  );
  return projectMatrix(evidenceRows, isObserver);
}
