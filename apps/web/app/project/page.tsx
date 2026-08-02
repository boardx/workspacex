import { redirect } from "next/navigation";

/**
 * ⚠ 已退役（2026-08-02，issue #317）—— project 束的六 tab 工作台（`ProjectWorkbench`）
 * 已迁到 `/projects/[projectId]`（真正按项目参数化，沿用 `canvas`/`files` 子路由的模式）。
 * 本路由是它的旧落点：**静态**，不带项目 id，只能演示写死的 mock 项目——列表卡片
 * 「进入项目」链接的一直是 `/projects/${id}`，从未指向过这里，两个实现各自长出来
 * 没人接上（同一类漂移见已退役的 `/studio/interview`、`/studio/prototype`）。
 *
 * 重定向目标的取舍：本路由**没有项目 id 可带**，无法像 `/studio/interview`→`/itv`
 * 那样 1:1 映射到同一项目的现行路由。两个候选：
 *   A) 挑一个「默认/demo」项目 id（如 `MOCK_PROJECTS[0].id`），直接落到
 *      `/projects/<id>`——但旧 `/project` 本就没让用户选过项目，代替用户悄悄选一个
 *      会把「这是哪个项目」的判断权从用户手上拿走，且以后 mock 数据一换就可能失效；
 *   B) 落到项目列表 `/projects`，让用户自己挑一个真实存在的项目再进入六 tab 工作台。
 * 选 **B**：旧书签/旧链接不再 404，也不替用户假装选定了某个项目——
 * 这与 `lib/project-context.ts` 里「列表 /projects → 工作台 /projects/[id]」的既定
 * 路由语义一致（该文件头注：只有 `/projects/<id>/...` 才算真正的项目上下文）。
 *
 * 组件 `components/project/project-workbench.tsx` 与其 `tab-*.tsx` 保留在原位、
 * 未删——它们现在被 `/projects/[projectId]/page.tsx` 引用，不是留痕废弃代码。
 */
export default function DeprecatedProjectStaticPage() {
  redirect("/projects");
}
