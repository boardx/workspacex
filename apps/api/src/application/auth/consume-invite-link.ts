/**
 * 用一条邀请链接进场（F15 的**反向断言面**）。
 *
 * F15 的 `user_visible_behavior` 里有两句只有「用一次」才能被证明的话：
 *   · 「一次性链接被用过即失效且 `invite_link.used_by` 记录使用者与时间」（I-11）
 *   · 「链接可单条撤销或 [重置全部]」——撤销的意义**全部**在于「撤销后再用会失败」
 *
 * 一个只写不读的实现能把这两句话演成绿的：签发有行、撤销有 `revoked_at`，
 * 而没有任何东西检查过那两列。所以核销路径属于 F15，**不属于** F16。
 *
 * ## 这里**不**做的事：建 `GuestIdentity` / `project_memberships`
 *
 * 免注册进场（UC-1.2 / F16）要做「令牌有效 ∧ 手机号在本场名单内」的四象限判定、
 * 建访客身份、不建账号（I-18/I-19）。那些是 F16。
 * 这里只到「令牌换到一份服务端记录的授予值」为止——**授予值本身**是 F15 的产物，
 * 谁拿它去建什么是下一个 feature 的事。
 * ⇒ 返回 `InviteLinkGrant`，不落任何成员行。写在这里而不是让下一个人从缺口里推断。
 */
import { USABILITY_REASON_TO_CODE } from "../../domain/auth/invite-link";
import { OrgAdminError } from "./org-invite-errors";
import type { InviteLinkGrant, InviteLinkRepository } from "./invite-link-ports";

export interface ConsumeInviteLinkDeps {
  readonly repo: InviteLinkRepository;
  readonly now?: () => Date;
}

export interface ConsumeInviteLinkUseCaseInput {
  /** ⚠ `null` / 空串 = 请求里根本没带 `?t=`。见下：那是一个**专门的码**。 */
  readonly token: string | null;
  readonly principalId: string;
}

export async function consumeInviteLink(
  deps: ConsumeInviteLinkDeps,
  input: ConsumeInviteLinkUseCaseInput,
): Promise<InviteLinkGrant> {
  /**
   * I-10 的另一半：「不带令牌的进场请求一律被拒」。
   *
   * ⚠ 用 `LINK_TOKEN_REQUIRED` 而不是 `INVITE_NOT_FOUND`，理由与 V10 不冲突：
   *   V10 要挡的是**拿着一枚令牌去试**能不能分辨出「不存在 / 已撤销 / 已用 / 过期」——
   *   那四种在下面确实合并了。而「你根本没带令牌」不泄露任何关于某枚令牌的信息，
   *   它泄露的只是调用者自己请求的形状。契约为它单列了一个码，正是这个意思。
   */
  if (input.token === null || input.token === "") throw new OrgAdminError("LINK_TOKEN_REQUIRED");

  const result = await deps.repo.consume({
    token: input.token,
    principalId: input.principalId,
    now: (deps.now ?? (() => new Date()))(),
  });

  if (result.ok) return result.grant;

  /**
   * ⚠ 「不存在」与另外三种的**区别在这里就被丢掉**：`not-found` 映射成 `INVITE_NOT_FOUND`，
   *   而 revoked / expired / used 各有自己的码——契约就是这么分的（E1 说的是
   *   把三码**渲染**成同一句话，不是把它们合并成同一个码）。
   *   「不存在」单独一个码不构成探测器：它与「存在但已撤销」返回的都是
   *   一个不含项目名、组号、任何成员信息的失败，参与者侧看到的字面完全一样。
   */
  if (result.reason === "not-found") throw new OrgAdminError("INVITE_NOT_FOUND");
  throw new OrgAdminError(USABILITY_REASON_TO_CODE[result.reason]);
}
