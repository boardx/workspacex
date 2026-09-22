import { InviteActivation } from "@/components/entry/invite-activation";
import { LinkActivation } from "@/components/entry/link-activation";
import { ACTIVATION_TOKEN_PARAM, SHARED_LINK_TOKEN_PARAM, readActivationClaims } from "@/lib/activation-link";

/**
 * 组织邀请激活落地页（invite-link-and-reads delta ① + shared-invite-links delta）。
 * 路由字符串与两个参数名的唯一事实源在 `lib/activation-link.ts`。
 *
 * 两种模式按参数名分发：`?t=` 单人一次性邀请（邮箱在邀请记录里）；`?lt=` 共享链接
 * （多次使用，受邀人自填邮箱）。两个参数都带时单人 token 赢——它更具体。
 *
 * ⚠ 单人邀请这一条还要把链接上**实际带着的** `?org=&role=&team=` 声明值原样交给
 *   `InviteActivation`（issue #592）：它们对授予没有任何影响，但服务端要靠它们往
 *   `org_invite_tamper_attempts` 留痕。落地页丢掉 = 审计表永远收不到一行。
 *   共享链接那一条没有这个面（`POST /org-invites/activate-via-link` 不读查询串）。
 */
export default function ActivatePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const raw = searchParams[ACTIVATION_TOKEN_PARAM];
  const token = typeof raw === "string" && raw.length > 0 ? raw : null;
  const rawLink = searchParams[SHARED_LINK_TOKEN_PARAM];
  const linkToken = typeof rawLink === "string" && rawLink.length > 0 ? rawLink : null;
  if (token === null && linkToken !== null) return <LinkActivation token={linkToken} />;
  return <InviteActivation token={token} claims={readActivationClaims(searchParams)} />;
}
