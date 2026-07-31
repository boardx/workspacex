/**
 * `GuestIdentity` 的域规则（F12 / UC-1.2 免注册进场）—— 最内层，纯函数，没有库、没有 HTTP。
 *
 * ## 为什么这个文件几乎是空的
 *
 * I-19（令牌有效 ∧ 手机号在名单内才建身份）与 I-18（不建账号）都是**一串写操作**的性质，
 * 不是一次计算的性质——恰好一次、同一事务、条件 UPDATE，这些纯函数托不住。
 * 它们被断言在真正住着它们的地方：`pg-join-repository.ts` 的一条事务，
 * 由 `tests/auth/join-token-phone-roster.test.ts` / `join-no-account-created.test.ts`
 * 对真实事务断言。这里只放**不依赖任何写操作**就能判定的东西：id 生成、展示代称。
 */
import { randomBytes } from "node:crypto";

/** 免注册身份 id。**与正式账号共用同一套操作者标识空间**（domain.md `GuestIdentity`）—— */
export function newGuestIdentityId(): string {
  return `gi-${randomBytes(12).toString("hex")}`;
}

/**
 * 展示层代称——`domain.md [待定 D]`：生成规则未裁决。
 *
 * ⚠ 这里落地的是一条**可预测、可断言的占位实现**（「访客」+ 手机号后 4 位），
 * 不是对 [待定 D] 的裁决：真正的规则一旦定下来，改的是这一个函数的函数体，
 * `GuestIdentity` 的结构与它在别处的用法不需要跟着变。
 * ⚠ 只取后 4 位、不取前 3 位：`alias` 会出现在其他组员能看到的到场名单里，
 *   与 I-22（手机号不以完整形式出现）不同，这里更进一步——**连掩码形态也不用**，
 *   避免「访客138••••2049」看起来像是完整手机号的变体。
 */
export function guestAliasFor(displayAlias: string | null, normalizedPhone: string): string {
  if (displayAlias !== null && displayAlias.trim() !== "") return displayAlias;
  const tail = normalizedPhone.slice(-4).padStart(4, "0");
  return `访客${tail}`;
}
