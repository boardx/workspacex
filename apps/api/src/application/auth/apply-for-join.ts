/**
 * `ApplyForJoin`（F13 / UC-1.2 R4，「三种意外」之二）—— 名单外访客申请加入。
 *
 * ⚠ **不建身份、不写名单**——这条用例只登记一份待批单据。「批准前该访客不进入任何组、
 *   读不到任何内容」（I-21）由 `JoinApplicationRepository.apply` 从不触碰
 *   `project_participants` 这件事本身保证，不是靠这里多判一次。
 * ⚠ 关于 `JOIN_PENDING_APPROVAL`：见 `join-application-ports.ts` 文件头——
 *   契约错误码枚举与 usecases.md 的文字描述互相矛盾，本实现照 usecases.md 走（幂等成功）。
 */
import { normalizePhone } from "./upsert-participant-roster";
import { OrgAdminError } from "./org-invite-errors";
import type { JoinApplicationRepository } from "./join-application-ports";

export interface ApplyForJoinDeps {
  readonly repo: JoinApplicationRepository;
  readonly newApplicationId: () => string;
  readonly now?: () => Date;
}

export interface ApplyForJoinUseCaseInput {
  /** ⚠ `null` / 空串 = 请求里根本没带 `?t=`（同 F12 的 I-10）。 */
  readonly linkToken: string | null;
  readonly phone: string | null;
}

export interface ApplyForJoinOutput {
  readonly applicationId: string;
  readonly status: "pending";
}

export async function applyForJoin(
  deps: ApplyForJoinDeps,
  input: ApplyForJoinUseCaseInput,
): Promise<ApplyForJoinOutput> {
  if (input.linkToken === null || input.linkToken === "") {
    throw new OrgAdminError("LINK_TOKEN_REQUIRED");
  }
  if (input.phone === null || input.phone.trim() === "") {
    // 契约的 `phone` 是 `z.string().min(1)`，interface 层的 ValidationPipe 已经会拒绝空串；
    // 这里仍防御性判一次而不 silently 传空字符串下去，但没有专门的错误码可用——
    // 这条路径在契约校验通过后不应该被触达。
    throw new Error("applyForJoin: phone 为空——契约校验应已在此之前拦下。");
  }

  const result = await deps.repo.apply({
    token: input.linkToken,
    phone: normalizePhone(input.phone),
    candidateApplicationId: deps.newApplicationId(),
    now: (deps.now ?? (() => new Date()))(),
  });

  if (!result.ok) {
    const CODE = {
      "not-found": "LINK_REVOKED",
      revoked: "LINK_REVOKED",
      expired: "LINK_EXPIRED",
      // 契约 `applyForJoin.err` 没有 `LINK_ALREADY_USED`——群发/主链接的 once 档理论上
      // 可能撞到这个分支，但申请加入场景走的是分组/主链接（24h/7d），保守映射到 LINK_REVOKED。
      used: "LINK_REVOKED",
    } as const;
    throw new OrgAdminError(CODE[result.reason]);
  }

  return { applicationId: result.grant.applicationId, status: "pending" };
}
