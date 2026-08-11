/**
 * `ResendOrgInvite`（#363 / I-6）—— 编排。不知道 HTTP，不知道 PostgreSQL。
 *
 * ## 这条用例的业务规则不是我发明的，逐条给出处
 *
 * 本 feature 只是把一个**孤儿契约操作**接到路由上（契约 `org-admin.ts:334` 早就存在，
 * controller 里零命中）。规则全部已经写在仓库里，这里只是把它们接起来：
 *
 * · 「重发 = 签发新令牌 + 作废旧令牌，**不幂等**」 → `packages/contracts/src/org-admin.ts`
 *   `resendOrgInvite` 的注释，逐字；以及迁移 0022 的 `org_invite_tokens_live_uniq`
 *   注释（「否则重发之后旧链接仍然能激活，而 I-6 的整个意义就是它不能」）。
 * · 阈值 `resendCooldownSeconds` / `resendDailyMax` → 同一段契约注释点名，
 *   值在 `AUTH_POLICY`（phase-00 契约，**全仓唯一一份**）。这里**读**它，不抄它。
 * · 令牌规格与有效期 → `domain/auth/org-invite.ts` 的 `newOrgInviteToken` /
 *   `ORG_INVITE_LINK_VALIDITY_MS`。与初次邀请、与复核批准**同一个生成器、同一个常量**。
 *
 * ## 一处**没有**出处、因此如实标成裁定的地方
 *
 * 契约的 `err` 里有 `MAIL_UNAVAILABLE`，而**投递不在本仓当前范围内**——
 * `invite-org-member.ts` 的文件头已经写明「把令牌拼进邮件不在 F10 范围内」。
 * ⇒ 本用例**永远不会**产生 `MAIL_UNAVAILABLE`。它不是被忘了，是这条链上还没有
 *   会失败的发信步骤；将来接上投递时，那个码的抛出点在投递适配器，不在这里。
 */
import { auth as C } from "@repo/contracts";
import { newOrgInviteToken, ORG_INVITE_LINK_VALIDITY_MS } from "../../domain/auth/org-invite";
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { OrgInviteRepository } from "./org-invite-ports";

export interface ResendOrgInviteDeps {
  readonly repo: OrgInviteRepository;
  readonly now?: () => Date;
}

export interface ResendOrgInviteInputUc {
  readonly orgId: OrgId;
  /** 已由 Guard 认证过的调用者。绝不从请求体取。 */
  readonly actorId: string;
  /** 调用者在**本组织**的角色，由 interface 层从库里读出来传进来。 */
  readonly actorOrgRole: string;
  readonly inviteId: string;
}

export interface ResendOrgInviteOutput {
  /** ⚠ 恒为 true：走到这里就意味着新令牌已经写进库了。false 是不可达的谎。 */
  readonly newTokenIssued: boolean;
  /** 下一次可重发前还要等多少秒。 */
  readonly cooldownSec: number;
  /**
   * 新签发的令牌明文（invite-link-and-reads delta ①，coord-main 2026-08-11 裁决 A）。
   * **只在这一次响应里出现**：旧令牌在同一事务里已作废（I-6），列表与重放都拿不到它。
   * 调用方（admin）把它拼成激活链接转交受邀人，或者丢掉；不得回存。
   */
  readonly activationToken: string;
}

export async function resendOrgInvite(
  deps: ResendOrgInviteDeps,
  input: ResendOrgInviteInputUc,
): Promise<ResendOrgInviteOutput> {
  // 🔴 授权。与 `reviewAdminInvite` / `inviteOrgMember` 判的是同一层身份（组织角色）。
  //
  // ⚠ 它**必须在任何一次按 inviteId 的查库之前**：放到后面，一个非管理员就能靠
  //   「INVITE_NOT_FOUND 还是 PROJECT_ROLE_INSUFFICIENT」把别人组织的邀请 id 一个个试出来。
  //   防枚举不是错误码长得像，是**判定顺序**。
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  const now = (deps.now ?? (() => new Date()))();

  // 令牌在这里生成、写库后**由本次响应带出一次**（delta ①）——不是从库里读回来：
  // 仓储的返回值里刻意没有 token 字段，可再读的地方一个也没有增加。
  const token = newOrgInviteToken();

  const result = await deps.repo.resendOrgInvite({
    orgId: input.orgId,
    inviteId: input.inviteId,
    now,
    token,
    tokenExpiresAt: new Date(now.getTime() + ORG_INVITE_LINK_VALIDITY_MS),
    cooldownSeconds: C.AUTH_POLICY.resendCooldownSeconds,
    dailyMax: C.AUTH_POLICY.resendDailyMax,
  });

  if (!result.ok) {
    if (result.reason === "rate-limited") throw new OrgAdminError("RATE_LIMITED");
    if (result.reason === "not-found") throw new OrgAdminError("INVITE_NOT_FOUND");
    // `not-resendable`：邀请**存在**，只是状态已经翻过去了（待复核 / 已撤销 / 已用）。
    // 与 `reviewAdminInvite` 的 `already-decided` 同一处置，同一条理由。
    throw new OrgAdminError("VERSION_CHANGED");
  }

  // ⚠ 裁决 A（invite-link-and-reads delta ①）改写了旧的「令牌不进返回值」：这一次
  //   响应是令牌唯一一次离开签发路径——重发者本来就是刚触发签发的 admin，回传一次
  //   不产生任何「随时可再读」的路径（仓储返回值依旧没有 token 字段，列表也没有）。
  return {
    newTokenIssued: result.newTokenIssued,
    cooldownSec: result.cooldownSec,
    activationToken: token,
  };
}
