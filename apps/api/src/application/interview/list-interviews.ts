/**
 * `listInterviews` —— 跨项目列表 + 范围过滤（uc-6-0 V1 / V7 / V8）。
 *
 * ## 这个 use case 刻意什么都不过滤
 *
 * 它只做三件事：判范围档位可不可见、把参数交给仓储、把行拼成契约的 `out`。
 * 中间**没有任何一行 `filter`** —— 这不是省事，是本 feature 的主张：
 * 可见性判定在数据库里发生一次，之后不再有第二处判定，
 * 因此也不可能出现「SQL 漏了一条，JS 又补上了」这种两处规则各说各话、
 * 而抓包能看见越权数据的局面（V2）。
 *
 * 想验证这一点：把 `pg-interview-scope-repository.ts` 的 `VISIBILITY_PREDICATE` 去掉，
 * 本文件一个字不改，`scope-server-side-filter-no-leak.test.ts` 必须当场红。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import { scopeIsCoherent, scopeVisibleTo, type ScopeSelector } from "../../domain/interview/scope";
import { decideInterviewVisibility } from "../../domain/interview/visibility-decision";
import type { OrgRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { DecisionIdFactory } from "../identity/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { IncoherentScopeError, ScopeNotVisibleError } from "./errors";
import type { InterviewScopeRepository, StoredInterviewRow } from "./ports";

export type ListInterviewsResult = z.infer<typeof interview.operations.listInterviews.out>;

export interface ListInterviewsDeps {
  readonly repo: InterviewScopeRepository;
  readonly decisions: DecisionIdFactory;
}

export interface ListInterviewsInput {
  readonly orgId: OrgId;
  readonly viewerUserId: string;
  readonly scope: ScopeSelector;
  readonly filters?: { readonly tags?: readonly string[] | null; readonly archived?: boolean | null };
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * 默认页大小。
 *
 * 有上限而不是「不传就取全部」：一个没有上限的列表接口，在越权判定出错时
 * 一次就把整个组织的访谈发出去，而在判定正确时你永远看不出它有没有上限。
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const toRow = (r: StoredInterviewRow): z.infer<typeof interview.InterviewRow> => ({
  interviewId: r.interviewId,
  title: r.title,
  sourceKind: r.sourceKind,
  scope: {
    // 行上的范围是**存出来的**，不是把入参 scope 抄一份回去。
    // 抄入参会让「按 project 档位查却混进一条无项目访谈」这种漏在响应体里看不出来。
    kind: r.projectId !== null ? "project" : r.researchProjectId !== null ? "research" : "none",
    projectId: r.projectId,
    researchProjectId: r.researchProjectId,
  },
  tags: [...r.tags],
  archived: r.archived,
  whenAt: r.whenAt,
});

export async function listInterviews(
  deps: ListInterviewsDeps,
  input: ListInterviewsInput,
): Promise<ListInterviewsResult> {
  if (!scopeIsCoherent(input.scope)) throw new IncoherentScopeError();

  const projectIds = await deps.repo.projectIdsOf(input.orgId, input.viewerUserId);
  // 档位可见性先判：`SCOPE_NOT_VISIBLE` 的语义是「该档位不显示」，
  // 而不是「显示一个空列表」。两者在 V7 里是两种不同的空态文案。
  if (!scopeVisibleTo(input.scope, { userId: input.viewerUserId, projectIds })) {
    throw new ScopeNotVisibleError();
  }

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = await deps.repo.listVisible({
    orgId: input.orgId,
    viewerUserId: input.viewerUserId,
    scope: input.scope,
    filters: input.filters,
    limit,
    cursor: input.cursor,
  });

  const membership = await deps.repo.orgMembershipOf(input.orgId, input.viewerUserId);
  const viewer = { userId: input.viewerUserId, projectIds };

  /**
   * 第二次判定。SQL 已经过滤过一遍，这里用**另一份声明**（纯函数 `canRead`）再判一次，
   * 只有两次都说可见的才解封。
   *
   * 这不是把过滤搬回进程里 —— 进程这一侧**不会让任何一行从不可见变成可见**，
   * 只可能相反。所以「服务端过滤」这条主张没有被削弱，而两份声明的漂移
   * 从「CI 里能发现」变成了「运行时会被扣下」。
   */
  const visible: StoredInterviewRow[] = [];
  for (const { item, facts } of page.rows) {
    const r = discloseDecided(
      item,
      decideInterviewVisibility({
        decisionId: deps.decisions.next(),
        interview: facts,
        viewer,
        orgRole: membership.orgRole as OrgRole | null,
        viewerTeamId: membership.teamId,
      }),
    );
    if (isDisclosed(r)) visible.push(r.payload);
  }

  return {
    items: visible.map(toRow),
    nextCursor: page.nextCursor,
    counts: page.counts,
    // 走到这里就说明范围本身是可见的，所以空 items 只可能是「本范围确实没有」。
    // 「无权查看本范围」在上面已经作为 `SCOPE_NOT_VISIBLE` 抛出去了 —— 两种空态因此
    // 在**协议层**就是两种不同的响应，而不是靠前端读一个布尔值猜。
    emptyBecauseNoData: visible.length === 0,
  };
}
