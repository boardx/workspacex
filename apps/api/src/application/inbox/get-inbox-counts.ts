/**
 * `getInboxCounts` —— UC-17.8 B3.2，四列条数 + 各类型条数 + 总数。
 *
 * ⚠ 不筛选，`sources` 规则与 `listInbox` 完全一样——见契约 `getInboxCounts` 头注。
 *   两个用例共享同一份聚合（`buildFeedbackInboxItems`/`buildExceptionInboxItems`），
 *   不是各自重新拉一遍数据再各写一套判定；这里只是比 `listInbox` 少了过滤/分页那几步。
 */
import { inbox as C } from "@repo/contracts";
import type { z } from "zod";
import { listFeedback, type ListFeedbackDeps, type ListFeedbackInput } from "../feedback/list-feedback";
import type { ErrorLogPort } from "../ports/error-log.port";
import { loadOwnerNamesAndProject } from "../design-workbench/project-list-shared";
import type { DesignProjectDeps } from "../design-workbench/project-shared";
import {
  buildExceptionInboxItems,
  buildFeedbackInboxItems,
  buildDesignInboxItems,
  fetchAllExceptions,
  INBOX_EXCEPTION_FETCH_CAP,
} from "./inbox-projection";
import { InboxPermissionRevokedError } from "./list-inbox";

export type InboxCountsView = {
  readonly byStage: { readonly backlog: number; readonly doing: number; readonly done: number; readonly archived: number };
  readonly byKind: { readonly feedback: number; readonly exception: number; readonly design: number };
  readonly total: number;
  readonly sources: z.infer<typeof C.InboxSources>;
};

export interface GetInboxCountsDeps {
  readonly feedback: ListFeedbackDeps;
  readonly errorLog: ErrorLogPort | undefined;
  /** 同 `ListInboxDeps.design`——恒必填,见其头注。 */
  readonly design: DesignProjectDeps;
}

export type GetInboxCountsInput = Pick<ListFeedbackInput, "viewerId" | "viewerOrgRole" | "viewerTeamId">;

export { InboxPermissionRevokedError, INBOX_EXCEPTION_FETCH_CAP };

export async function getInboxCounts(deps: GetInboxCountsDeps, input: GetInboxCountsInput): Promise<InboxCountsView> {
  // 同 `listInbox`：只挡非本组织成员（D8 ③），计数口径见契约 `getInboxCounts` 头注。
  if (input.viewerOrgRole === null) throw new InboxPermissionRevokedError();

  const sources: InboxCountsView["sources"] = { exception: deps.errorLog !== undefined ? "included" : "withheld" };

  const feedbackItems = await listFeedback(deps.feedback, {
    scope: { kind: "org" },
    viewerId: input.viewerId,
    viewerOrgRole: input.viewerOrgRole,
    viewerTeamId: input.viewerTeamId,
  });
  const exceptionItems = deps.errorLog !== undefined ? await fetchAllExceptions(deps.errorLog) : [];
  const designRows = await deps.design.projects.listForOrg();
  const designItems = await loadOwnerNamesAndProject(deps.design, designRows);

  const all = [
    ...buildFeedbackInboxItems(feedbackItems).map((i) => i.item),
    ...buildExceptionInboxItems(exceptionItems).map((i) => i.item),
    ...buildDesignInboxItems(designItems).map((i) => i.item),
  ];

  const byStage = { backlog: 0, doing: 0, done: 0, archived: 0 };
  const byKind = { feedback: 0, exception: 0, design: 0 };
  for (const item of all) {
    byStage[item.stage] += 1;
    byKind[item.kind] += 1;
  }

  return { byStage, byKind, total: all.length, sources };
}
