import { redirect } from "next/navigation";

/**
 * `/org-admin` 根路由——issue #2615 拆平后不再有单一的"组织管理"落地屏，
 * 三个独立屏各自落在 `/org-admin/members` / `/org-admin/invites` / `/org-admin/profile`。
 * 旧书签/旧链接重定向到"成员"（与左栏三项里排在最前的那个一致），不留死链——
 * 同 `app/admin/[module]/page.tsx` 的 `REDIRECTS` 机制同一种处置。
 */
export default function OrgAdminPage() {
  redirect("/org-admin/members");
}
