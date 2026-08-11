import { SkillApp } from "@/components/skill/skill-app";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveSkillScreen, resolveSkillView, viewToProjectRole } from "@/lib/mock/skill";

/**
 * skill 能力域（03-skill · UC-3.1 ~ 3.6）—— 8 feature / 31 点，共 8 屏（`?screen=`）。
 *
 * ⚠ 2026-08-11（菜单去重复查）订正：本行原先写「先行原型」，跟
 *   `lib/navigation.ts` 「skills 唯一默认屏已接真实后端」的说法矛盾——两处各写各的，
 *   从没人第一手核实过。核实结果：**不是整页一句话能说清的**，8 屏里
 *   **默认屏 `library`（#520/PR#518 `SkillController`，`components/skill/
 *   skill-catalog-live.tsx`）已接真实后端**；其余 7 屏（`library-prototype` /
 *   tryrun / binding / temp / versioning / promotion / feedback）仍是零后端的
 *   UI 先行原型，供 ADR-023 签核材料使用。「8 feature / 31 点」描述的是全部 8 屏
 *   的总规模，不代表 8 屏都是原型——按屏而不是按页判断虚实。
 *
 * ⚠ 服务端组件：只解析 URL、组装身份，把可序列化 props 交给客户端 SkillApp。
 *    真实权限在服务端（NestJS Guard + PostgreSQL RLS）；`?as=` / `?state=` / `?screen=`
 *    只是预览手段，生产构建不可达（`library` 屏内部的真实请求除外——那是运行时行为，
 *    不受这几个预览参数影响）。
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
