import { AssetGovernanceApp } from "@/components/asset-governance/asset-governance-app";
import { mockIdentity } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveAgScreen, resolveAgView, agViewToProjectRole } from "@/lib/mock/asset-governance";

/**
 * asset-governance 能力域（phase-01 第 11 个契约束「外来资产的导入与生命周期治理」）
 * —— UI 先行原型：后台外壳 + 六资产 IA + 公共治理机制（导入六道关 / 治理与发布 /
 *    文件树编辑器 / 试跑台 / 蓝本列表）。
 *
 * ⚠ 服务端组件：只解析 URL、组装身份，把可序列化 props 交给客户端 App。
 *    真实权限在服务端（NestJS Guard + PostgreSQL RLS）；`?as=` / `?state=` / `?screen=`
 *    只是预览手段，生产构建不可达。
 *
 * 路由放**顶层 `/asset-governance`**（并行安全，不与项目内路由冲突）。
 */
export default function AssetGovernancePage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; screen?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const view = resolveAgView(searchParams.as);
  const projectRole = agViewToProjectRole(view);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", projectRole);
  const screen = resolveAgScreen(searchParams.screen);

  return (
    <AssetGovernanceApp
      identity={identity}
      uiState={uiState}
      screen={screen}
      view={view}
      qs={{ as: searchParams.as, org: searchParams.org }}
    />
  );
}
