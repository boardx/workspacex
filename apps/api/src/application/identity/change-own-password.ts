/**
 * `changeOwnPassword`（#638 delta，迭代 2）—— 已登录用户主动改密码。
 *
 * ⚠ 与 `completePasswordReset`（`auth/password-reset.ts`）是**不同威胁模型**，不共用
 *   实现：那条走未登录邮箱令牌，"拥有令牌"本身就是授权证明；这里调用者已经有一个活的
 *   会话，`currentPassword` 才是授权证明——即使会话本身合法，也必须先验对旧密码才允许
 *   写新哈希，防的是"会话被劫持后攻击者直接改密"这种场景（delta §2 逐字）。
 * ⚠ 成功后吊销**除当前会话外**的全部会话——与密码重置"全部吊销含当前"刻意不同
 *   （那条走的是 `revokeAllForUser`，这条走 `revokeAllForUserExcept`）。
 */
import { checkPassword } from "../../domain/auth/password-policy";
import type { CredentialRepository, PasswordHasher, SessionTokenStore } from "../auth/ports";

export class ChangeOwnPasswordError extends Error {
  constructor(readonly reasonCode: "CURRENT_PASSWORD_INVALID" | "PASSWORD_POLICY_VIOLATION") {
    super(reasonCode);
  }
}

export interface ChangeOwnPasswordDeps {
  readonly credentials: CredentialRepository;
  readonly hasher: PasswordHasher;
  readonly sessions: SessionTokenStore;
  readonly clock: { now(): Date };
}

export interface ChangeOwnPasswordInput {
  readonly userId: string;
  /** 发起这次请求的那条会话——吊销时要排除它，否则用户改完密码自己也被踢下线。 */
  readonly currentSessionId: string;
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface ChangeOwnPasswordOutput {
  readonly changed: true;
  readonly revokedSessionCount: number;
}

export async function changeOwnPassword(
  deps: ChangeOwnPasswordDeps,
  input: ChangeOwnPasswordInput,
): Promise<ChangeOwnPasswordOutput> {
  // 强度先查——同 `completePasswordReset` 的顺序理由：一个人输错新密码不该先烧掉别的东西。
  // 这里没有单次令牌可烧，但先查仍然是更快的失败路径，且与旧密码校验的顺序无关。
  const rejection = checkPassword(input.newPassword);
  if (rejection) throw new ChangeOwnPasswordError("PASSWORD_POLICY_VIOLATION");

  const cred = await deps.credentials.findByUserId(input.userId);
  // 理论上不可达——调用方已认证，`userId` 来自会话主体。仍然显式处理，不对 null 解引用。
  if (!cred) throw new ChangeOwnPasswordError("CURRENT_PASSWORD_INVALID");

  const ok = await deps.hasher.verify(input.currentPassword, cred.passwordHash);
  if (!ok) throw new ChangeOwnPasswordError("CURRENT_PASSWORD_INVALID");

  await deps.credentials.updatePasswordHash(input.userId, await deps.hasher.hash(input.newPassword));

  const revokedSessionCount = await deps.sessions.revokeAllForUserExcept(
    input.userId,
    input.currentSessionId,
    deps.clock.now(),
  );

  return { changed: true, revokedSessionCount };
}
