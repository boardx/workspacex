import { OrgAdminApp } from "@/components/org-admin/org-admin-app";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveOrgAdminScreen } from "@/lib/mock/org-admin";

/**
 * org-admin 能力域 UI 先行原型（UC-1.3 / 1.4 / 1.6）—— ADR-023 签核第 ① 件材料。
 *
 * ⚠ 服务端组件：只解析 URL、组装身份，把可序列化的 props 交给客户端 OrgAdminApp。
 *    真实权限在服务端 NestJS Guard + PostgreSQL RLS；这里的视角/状态/屏切换只是预览。
 *    UC-1.2（分组链接免注册进场）已由 `components/entry/*` 画完，不在此屏。
 */
export default function OrgAdminPreviewPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; screen?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as) ?? "facilitator";
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);
  const screen = resolveOrgAdminScreen(searchParams.screen);

  return (
    <OrgAdminApp
      identity={identity}
      previewRole={previewRole}
      uiState={uiState}
      screen={screen}
      qs={{ as: searchParams.as, org: searchParams.org }}
    />
  );
}
