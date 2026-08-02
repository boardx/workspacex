/**
 * `listSubjectRequests`（F96 / uc-6-6 R3 步骤 6）—— 受访者查自己每一项请求的状态。
 *
 * ⚠ **不能只给一句「已提交」就没有下文**（V6）——`resolveSubjectRequestView` 对每一条
 *   都现读关联撤回单据的最新五步快照，状态随流水线推进而更新，不是创建时写死的静态值。
 * ⚠ 令牌失效走 `TOKEN_SCOPE_VIOLATION`（与 `requestTranscriptCopy`/`requestErasure`
 *   同一条契约立场，见 `request-transcript-copy.ts` 文件头）。
 */
import { TokenScopeViolationError } from "./errors";
import type { PortalTokenRepository } from "./consent-token-ports";
import type { SubjectRequestRepository } from "./portal-ports";
import { resolveSubjectRequestView } from "./subject-request-view";
import type { SubjectRequestView } from "./subject-request-view";
import type { WithdrawalRepository } from "./withdrawal-ports";

export interface ListSubjectRequestsDeps {
  readonly portalTokens: PortalTokenRepository;
  readonly subjectRequests: SubjectRequestRepository;
  readonly withdrawals: WithdrawalRepository;
  readonly now?: () => Date;
}

export interface ListSubjectRequestsInput {
  readonly portalToken: string;
}

export interface ListSubjectRequestsOutput {
  readonly items: readonly SubjectRequestView[];
}

export async function listSubjectRequests(
  deps: ListSubjectRequestsDeps,
  input: ListSubjectRequestsInput,
): Promise<ListSubjectRequestsOutput> {
  const now = (deps.now ?? (() => new Date()))();

  const lookup = await deps.portalTokens.findActive(input.portalToken, now);
  if (!lookup.ok) throw new TokenScopeViolationError();

  const rows = await deps.subjectRequests.listBySubject(lookup.row.subjectId);
  const items = await Promise.all(rows.map((row) => resolveSubjectRequestView(deps, row)));
  return { items };
}
