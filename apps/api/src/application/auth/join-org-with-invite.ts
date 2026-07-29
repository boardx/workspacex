/**
 * `JoinOrgWithInvite` (F22) -- O-12 / UC-1.5 R10 / V10.
 *
 * 已登录账号用**一枚新邀请码**创建第二个组织。O-12 逐字：
 *
 *   > **已有账号再次使用一枚新邀请码创建第二个组织是合法路径**，
 *   > 不得因「该邮箱已注册」而拒绝；此时**不新建账号**，
 *   > 只新建组织并把该账号设为其管理员（否则会出现同邮箱多账号，
 *   > 与 UC-1.1「同一人登录进的是同一账号」冲突）。
 *
 * ## 与 `registerWithInvite` 的关系：不是它的分支
 *
 * `registerWithInvite` 对已注册邮箱回答 `EMAIL_TAKEN`，而且**必须**这么答——
 * 那条路径的调用者是匿名访客，凭一个邮箱就把新组织挂到已有账号上，
 * 等于「知道你的邮箱 + 有一枚码 = 成为你的组织的管理员」。
 * 两条路径的区别是**调用者是谁**，不是参数。合并会让那件事由请求体里的字段决定。
 *
 * ## 为什么这里校验邮箱已验证，而注册那条不校验
 *
 * 注册时账号刚建出来，本来就是未验证的（I-8 靠这一点成立）。
 * 而这里的调用者已经**登录了**——`Login` 的第 4 步已经挡掉未验证账号，
 * 所以正常情况下这条检查是恒真的。留着它是因为它挡的不是正常情况：
 * 会话是 30 天的，而「验证状态在会话有效期内被撤销」是可发生的
 * （管理员纠正邮箱、合规要求重验）。少了这条，一个被撤销验证的账号
 * 还能凭旧会话继续**创建新组织**，而它连登录都不该能。
 */
import { newOrgId } from "../../domain/auth/registration";
import { AuthError, InviteCodeInvalidError } from "./errors";
import type { CredentialRepository, RegistrationRepository } from "./ports";

export interface JoinOrgDeps {
  readonly repo: RegistrationRepository;
  readonly credentials: CredentialRepository;
}

export interface JoinOrgInput {
  /** 已由 Guard 认证过。⚠ 绝不从请求体里取——那正是 C9 注里说的可伪造字段。 */
  readonly userId: string;
  readonly code: string;
  readonly orgName: string;
}

export interface JoinOrgOutput {
  readonly orgId: string;
}

export async function joinOrgWithInvite(
  deps: JoinOrgDeps,
  input: JoinOrgInput,
): Promise<JoinOrgOutput> {
  const cred = await deps.credentials.findByUserId(input.userId);
  // 会话有效但账号不在了：不是「邀请码无效」，也不该是 500。
  // 用 SESSION_REVOKED——从调用者的角度这就是发生的事，凭据已经不能代表任何人了。
  if (cred === null) throw new AuthError("SESSION_REVOKED");
  if (cred.emailVerifiedAt === null) throw new AuthError("EMAIL_NOT_VERIFIED");

  const result = await deps.repo.joinExistingUserToNewOrg({
    code: input.code,
    userId: input.userId,
    // ⚠ 与注册同一个生成器。组织 id 是 RLS 的输入（`app.current_org`），
    // 两条路径各生成一种形态的 id，就会有一半的组织在某条 RLS 断言下形状不对。
    orgId: newOrgId(),
    orgName: input.orgName,
  });

  // 不存在 / 已核销 / 已过期 / 已吊销 —— 四种情形一个码。
  // 分开就是把 14 位码的爆破空间按命中率剪枝（usecases.md）。
  if (!result.ok) throw new InviteCodeInvalidError();

  return { orgId: result.orgId };
}
