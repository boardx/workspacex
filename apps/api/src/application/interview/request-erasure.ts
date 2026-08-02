/**
 * `requestErasure`（F96 / uc-6-6 R3 能力三）—— 请求删除全部记录。
 *
 * ⚠ 返回体**必须含四段说明**（会删/不会删/时限/不可逆），缺任一段视为失败（V10）——
 *   `buildErasureDisclosure`（domain 纯函数）是这四段说明唯一的来源，这里不重写内容。
 * ⚠ 确认后**执行与 uc-6-3/A4 同一条五步撤回流水线**（复用 `requestWithdrawal`），
 *   范围＝**全部四个同意位**——"删除全部记录"字面意思就是四位一起撤（对照
 *   `updateConsentFromPortal` 的"只撤被收紧的那几位"，这里没有"部分删除"的概念）。
 * ⚠ **幂等而非报错**：契约 `requestErasure.err` 里**没有** `WITHDRAWAL_IN_PROGRESS`
 *   （只有 `TOKEN_SCOPE_VIOLATION` / `DEPENDENCY_UNAVAILABLE`）——受访者对着同一条
 *   在途删除请求重复点击，不应该看到一个契约里不存在的错误码。这里的做法是：
 *   发起前先查**这个受访者自己名下、kind 恰为 `erasure` 且第 05 步尚未完成**的请求——
 *   有就直接复用那张单据，不再起第二次 `requestWithdrawal`。
 *   ⚠ 这里刻意**不**用 `WithdrawalRepository.findActiveForSubject(subjectId, ALL_CONSENT_KEYS)`
 *   做这个判断——那个方法按"范围有交集"匹配，会把"只收紧了一位、仍在途"的
 *   `updateConsentFromPortal` 撤回也当成"已有删除在途"而错误复用，两件事的粒度不同：
 *   改选择触发的撤回**只覆盖被收紧的那几位**，删除全部记录是**独立的、覆盖全部四位**的
 *   另一次撤回，两者并存时应该都各自跑完，不是后者顶替前者。
 * ⚠ 令牌失效在这三个"门户内动作"端口统一走 `TOKEN_SCOPE_VIOLATION`
 *   （见 `request-transcript-copy.ts` 文件头的同一条理由）。
 *
 * ⚠ **已知未覆盖的边角**：若受访者名下还有一条由 `updateConsentFromPortal` 收紧触发、
 *   范围有交集且尚未走完第 05 步的撤回，`requestWithdrawal` 会按 F89 既有的规则抛
 *   `WithdrawalInProgressError`——这个码**不在** `requestErasure.err` 里。本函数不吞掉
 *   它（吞掉等于假装两个撤回真的合并成功了），如实让它抛出；这是契约本身没有覆盖到的
 *   并发场景，记在这里而不是悄悄编一个新分支掩盖。
 */
import { buildErasureDisclosure, ALL_CONSENT_KEYS } from "../../domain/interview/portal-request";
import { TokenScopeViolationError } from "./errors";
import type { PortalTokenRepository } from "./consent-token-ports";
import type { SubjectRequestRepository } from "./portal-ports";
import { requestWithdrawal } from "./request-withdrawal";
import type { RequestWithdrawalDeps } from "./request-withdrawal";

export interface RequestErasureDeps extends RequestWithdrawalDeps {
  readonly portalTokens: PortalTokenRepository;
  readonly subjectRequests: SubjectRequestRepository;
}

export interface RequestErasureInput {
  readonly portalToken: string;
  readonly acknowledged: true;
}

export interface RequestErasureOutput {
  readonly requestId: string;
  readonly willDelete: readonly string[];
  readonly willNotDelete: readonly string[];
  readonly slaText: string;
  readonly irreversible: true;
}

export async function requestErasure(
  deps: RequestErasureDeps,
  input: RequestErasureInput,
): Promise<RequestErasureOutput> {
  const now = (deps.now ?? (() => new Date()))();

  const lookup = await deps.portalTokens.findActive(input.portalToken, now);
  if (!lookup.ok) throw new TokenScopeViolationError();
  const { subjectId } = lookup.row;

  const existingRequests = await deps.subjectRequests.listBySubject(subjectId);
  let activeErasureWithdrawalId: string | null = null;
  for (const row of existingRequests) {
    if (row.kind !== "erasure" || row.withdrawalId === null) continue;
    const record = await deps.withdrawals.findById(row.withdrawalId);
    const step5 = record?.steps.find((s) => s.no === 5);
    if (step5?.state !== "done") {
      activeErasureWithdrawalId = row.withdrawalId;
      break;
    }
  }

  const withdrawalId =
    activeErasureWithdrawalId ??
    (
      await requestWithdrawal(deps, {
        subjectId,
        scope: ALL_CONSENT_KEYS,
        reason: "受访者通过自助门户请求删除全部记录",
        origin: "portal",
      })
    ).withdrawalId;

  if (activeErasureWithdrawalId === null) {
    await deps.subjectRequests.create({
      requestId: withdrawalId,
      subjectId,
      kind: "erasure",
      createdAt: now,
      withdrawalId,
      fixedStatus: null,
      fixedEtaAt: null,
    });
  }

  const disclosure = buildErasureDisclosure();
  return {
    requestId: withdrawalId,
    willDelete: disclosure.willDelete,
    willNotDelete: disclosure.willNotDelete,
    slaText: disclosure.slaText,
    irreversible: disclosure.irreversible,
  };
}
