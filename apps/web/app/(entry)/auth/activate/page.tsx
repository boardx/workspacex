import { InviteActivation } from "@/components/entry/invite-activation";
import { LinkActivation } from "@/components/entry/link-activation";
import { ACTIVATION_TOKEN_PARAM, SHARED_LINK_TOKEN_PARAM } from "@/lib/activation-link";

/**
 * 组织邀请激活落地页（invite-link-and-reads delta ① + shared-invite-links delta）。
 * 路由字符串与两个参数名的唯一事实源在 `lib/activation-link.ts`。
 *
 * 两种模式按参数名分发：`?t=` 单人一次性邀请（邮箱在邀请记录里）；`?lt=` 共享链接
 * （多次使用，受邀人自填邮箱）。两个参数都带时单人 token 赢——它更具体。
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
  return <InviteActivation token={token} />;
}
