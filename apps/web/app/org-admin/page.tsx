import { OrgAdminScreen } from "@/components/org-admin/org-admin-screen";

/**
 * #639 delta，迭代 1 —— 组织管理页。左上角组织管理入口的落点。
 * 本轮只带"团队"标签页的只读列表；CRUD 动作留空/禁用态，迭代 2 再接。
 *
 * ⚠ 与 `/org-admin/preview`（mock 数据的既有原型）是两条独立路径——本页是
 *   session 驱动的真实数据页，不是那个原型的替换。
 */
export default function OrgAdminPage() {
  return <OrgAdminScreen />;
}
