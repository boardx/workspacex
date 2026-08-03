import { SkillApp } from "@/components/skill/skill-app";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveSkillScreen, resolveSkillView, viewToProjectRole } from "@/lib/mock/skill";

/**
 * skill 能力域（03-skill · UC-3.1 ~ 3.6）—— 8 feature / 31 点的先行原型。
 *
 * ⚠ 服务端组件：只解析 URL、组装身份，把可序列化 props 交给客户端 SkillApp。
 *    真实权限在服务端（NestJS Guard + PostgreSQL RLS）；`?as=` / `?state=` / `?screen=`
 *    只是预览手段，生产构建不可达。
 *
 * 路由放**顶层 `/skill`**（并行安全，不与项目内路由冲突）。
 */
export default function SkillPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; screen?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const view = resolveSkillView(searchParams.as);
  const projectRole = viewToProjectRole(view);
  const screen = resolveSkillScreen(searchParams.screen);

  return (
    <SkillApp
      previewRole={projectRole}
      uiState={uiState}
      screen={screen}
      view={view}
      qs={{ as: searchParams.as, org: searchParams.org }}
    />
  );
}
