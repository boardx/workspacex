/**
 * `listInbox` —— UC-17.8 B3.2「统一收件箱」聚合读。
 *
 * ⚠ 契约 `@repo/contracts` 的 `inbox.ts` 是这份实现**唯一**照的口径——排序键、
 *   `stage` 映射、`code` 编号算法、`sources.exception` 判定、`github` 派生公式全部
 *   在那份文件头注里写死了，本文件不重新发明，只落地。
 *
 * ## 为什么不是一条跨两张表的 SQL JOIN
 *
 * `error_logs` 的诊断内容只有 `app_diag_ro` 能读（见 `error-log.port.ts` 与迁移
 * `20260901024515_error_logs.sql` 头注），`product_feedback` 走的是 `app_rw` +
 * RLS 租户会话（`withTenant`）——两张表天然不在同一个数据库角色/会话能一起查的
 * 范围内。这里改为**在应用层聚合两个已有端口的结果**：反馈那一半直接复用
 * `listFeedback`（D3 可见性判定、附件门控、提交人显示名——一个字都不重写），
 * 系统异常那一半直接复用 `ErrorLogPort.list`（同一套分页/脱敏）。两处都是「已经
 * 正确的实现」，聚合层只做投影与排序，不重新判定任何一条安全规则。
 *
 * ## 分页的取舍：应用层 keyset，而不是一条能下推到数据库的游标
 *
 * 两个源分开分页、在内存里按 `createdAt`（同刻按 `kind`+`id`）做归并——这是
 * "服务端签发的不透明 cursor" 在两个物理上不共享一次查询的数据源之间唯一诚实的
 * 实现方式。**已知的取舍**：每次请求都重新拉两个源各自的一批数据再排序/切页，
 * 不是一条能利用数据库索引跳页的查询；`error_logs` 一侧额外设了
 * `INBOX_EXCEPTION_FETCH_CAP` 安全上限（见下）防止请求无界变慢。这与
 * `error_logs` 现有的分页设计（30 天留存、量级本来有界）相称；反馈一侧的
 * `listFeedback` 本来就不分页（"一周几十条"，见其文件头），这里原样复用。
 */
import type { z } from "zod";
import { inbox as C } from "@repo/contracts";
import { canTriage } from "../../domain/feedback/product-feedback";
import { listFeedback, type ListFeedbackDeps, type ListFeedbackInput } from "../feedback/list-feedback";
import type { ErrorLogPort } from "../ports/error-log.port";
import { loadOwnerNamesAndProject } from "../design-workbench/project-list-shared";
import type { DesignProjectDeps } from "../design-workbench/project-shared";
import {
  buildFeedbackInboxItems,
  buildExceptionInboxItems,
  buildDesignInboxItems,
  compareInboxDesc,
  decodeInboxCursor,
  encodeInboxCursor,
  fetchAllExceptions,
  INBOX_EXCEPTION_FETCH_CAP,
  type InboxSortKey,
} from "./inbox-projection";

export type InboxItemView = z.infer<typeof C.InboxItem>;
export type InboxSourcesView = z.infer<typeof C.InboxSources>;

export { INBOX_EXCEPTION_FETCH_CAP };

export class InboxPermissionRevokedError extends Error {}

export interface ListInboxDeps {
  readonly feedback: ListFeedbackDeps;
  /** `undefined` ⟺ 这次请求根本不该查系统异常那一半（不是超管）——见契约文件头
   *  「不报错，只是不含」；调用方（controller）按 `isPlatformOperator` 判定后决定传不传。 */
  readonly errorLog: ErrorLogPort | undefined;
  /**
   * B4.3——设计方案那一半。**恒必填**，与 `errorLog` 不同：`design_projects` 的可见性口径
   * 是「组织内全员可读」（契约 `design-workbench.ts` 头注【待确认点 1】），没有 `errorLog`
   * 那种"需要平台超管身份才查得动"的第二道门,任何过了 `canTriage` 的请求者都能看这一半。
   */
  readonly design: DesignProjectDeps;
}

export interface ListInboxInput extends Pick<ListFeedbackInput, "viewerId" | "viewerOrgRole" | "viewerTeamId"> {
  readonly kind?: z.infer<typeof C.InboxKind>;
  readonly stage?: z.infer<typeof C.InboxStage>;
  readonly q?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListInboxResult {
  readonly items: readonly InboxItemView[];
  readonly nextCursor: string | null;
  readonly sources: InboxSourcesView;
}

export async function listInbox(deps: ListInboxDeps, input: ListInboxInput): Promise<ListInboxResult> {
  // 收件箱是分诊面板的替代——同 `FeedbackController.counts` 的权限纪律：
  // 只有本组织的分诊角色能打开它（见 contracts/inbox.ts 顶部「覆盖」小节，
  // 这是替换 `/platform-admin/feedback` 三 tab 的屏，不是每个成员都能看的列表）。
  if (!canTriage(input.viewerOrgRole)) throw new InboxPermissionRevokedError();

  const sources: InboxSourcesView = { exception: deps.errorLog !== undefined ? "included" : "withheld" };

  const feedbackItems = await listFeedback(deps.feedback, {
    scope: { kind: "org" },
    viewerId: input.viewerId,
    viewerOrgRole: input.viewerOrgRole,
    viewerTeamId: input.viewerTeamId,
  });
  const exceptionItems = deps.errorLog !== undefined ? await fetchAllExceptions(deps.errorLog) : [];
  const designRows = await deps.design.projects.listForOrg();
  const designItems = await loadOwnerNamesAndProject(deps.design, designRows);

  let all = [
    ...buildFeedbackInboxItems(feedbackItems),
    ...buildExceptionInboxItems(exceptionItems),
    ...buildDesignInboxItems(designItems),
  ];

  if (input.kind !== undefined) all = all.filter((i) => i.item.kind === input.kind);
  if (input.stage !== undefined) all = all.filter((i) => i.item.stage === input.stage);
  if (input.q !== undefined && input.q.trim() !== "") {
    const q = input.q.trim().toLowerCase();
    all = all.filter(
      (i) => i.item.title.toLowerCase().includes(q) || i.item.code.toLowerCase().includes(q),
    );
  }

  all.sort((a, b) => compareInboxDesc(a.key, b.key));

  let windowed = all;
  if (input.cursor !== undefined) {
    const cursorKey = decodeInboxCursor(input.cursor);
    windowed = all.filter((i) => compareInboxDesc(cursorKey, i.key) < 0);
  }

  const page = windowed.slice(0, input.limit);
  const nextCursor = page.length === input.limit && windowed.length > input.limit
    ? encodeInboxCursor(page[page.length - 1]!.key)
    : null;

  return { items: page.map((i) => i.item), nextCursor, sources };
}

export type { InboxSortKey };
