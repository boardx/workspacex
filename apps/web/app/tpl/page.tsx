import { TplApp } from "@/components/tpl/tpl-app";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveTplScreen } from "@/lib/mock/tpl";

/**
 * `tpl`（蓝本 / 项目模板）能力域原型 —— ADR-023 签核第 ① 件的材料。
 *
 * ⚠ 服务端组件：只解析 URL、组装身份，把可序列化的 props 交给客户端 TplApp。
 *    纯 mock、零后端。视角/状态/屏切换只是预览手段，真实权限在服务端 RLS。
 *
 * 覆盖 UC-2.1（设计器）/ UC-2.2（套用 + 筹备 + 编排）/ UC-2.3（提回）/ UC-2.4（版本与锁定）。
 */
export default function TplPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; screen?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);
  const screen = resolveTplScreen(searchParams.screen);

  return (
    <TplApp
      identity={identity}
      previewRole={previewRole}
      uiState={uiState}
      screen={screen}
      qs={{ as: searchParams.as, org: searchParams.org }}
    />
  );
}
