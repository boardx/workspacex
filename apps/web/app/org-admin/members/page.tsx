import { OrgMembersScreen } from "@/components/org-admin/org-admin-screen";

/**
 * `/org-admin/members`——issue #2615：原「组织管理」标签页拆平后的「成员」独立路由，
 * 与 `/admin`（总览）同层级挂在组织后台左栏「组织」组下。
 */
export default function OrgAdminMembersPage() {
  return <OrgMembersScreen />;
}
