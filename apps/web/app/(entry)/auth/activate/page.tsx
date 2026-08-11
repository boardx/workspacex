import { InviteActivation } from "@/components/entry/invite-activation";
import { ACTIVATION_TOKEN_PARAM } from "@/lib/activation-link";

/**
 * 组织邀请激活落地页（invite-link-and-reads delta ①）。
 * 路由字符串的唯一事实源在 `lib/activation-link.ts`（管理端拼链接 import 同一份）。
 */
export default function ActivatePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const raw = searchParams[ACTIVATION_TOKEN_PARAM];
  const token = typeof raw === "string" && raw.length > 0 ? raw : null;
  return <InviteActivation token={token} />;
}
