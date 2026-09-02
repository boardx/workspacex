"use client";

/**
 * 人类反馈（2026-08-17）：点击「编辑」应该打开一个新的界面。`skill` 的编辑页
 * 单独一个文件（不与 `admin/agent/[id]/page.tsx` 共用），理由见那个文件的头注——
 * 这里才是唯一允许 import `SkillContentEditorSection` 的地方之一
 * （另一处是 `skill-app.tsx` 用的旧内联路径，现已改成不再用它，见该文件改动）。
 *
 * ⚠ `/admin/skill`（不带 `[id]`）本身仍然重定向到 `/skill?screen=catalog`
 *   （`app/admin/[module]/page.tsx` 的 `REDIRECTS`）——那条重定向只对**恰好两段**
 *   的路径生效，`/admin/skill/<id>` 是三段，不经过那段 `redirect()` 逻辑，
 *   直接落到这个文件。
 *
 * 人类截图实测反馈（2026-08-24，#1971）：点开一个 skill 卡片后进入的这个编辑页，
 * 应该是全屏专注编辑模式——不带治理后台的左侧导航栏，也不带顶栏 chrome。改用
 * `AppShell` 已有的 `hideTopBar` 沉浸式工作台模式（`rec-app.tsx` 已有先例：
 * 同样是「进入即全屏，不需要用户手动点收起」，不是复用左右栏的可收起/展开
 * toggle——那套是用户自己选择要不要收起，这里是这个路由本身就该是全屏）。
 * 不传 `left`（即不渲染 `AdminNav`）——图标栏仍保留，返回入口在页面自己的
 * 「‹ Skill 目录」链接（`CapabilityEditPage` 的 `compact` 头部）。
 */
import { AppShell } from "@/components/shell/app-shell";
import { CapabilityEditPage } from "@/components/admin/capability-edit-page";
import { SkillContentEditorSection } from "@/components/admin/skill-content-editor";
import { resolvePreviewRole } from "@/lib/identity";
import { safeRelativePath } from "@/lib/safe-relative-path";

export default function SkillEditRoutePage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { as?: string; from?: string };
}) {
  const previewRole = resolvePreviewRole(searchParams.as);
  /**
   * 人类实测反馈（2026-08-30）：「返回」曾经写死回 `/skill?screen=catalog`——
   * `/skill`（screen=library，「Skill 库」真实数据屏）的「编辑源码」按钮
   * （`skill-catalog-live.tsx`）与 `/admin/skill`（治理目录屏，经由重定向落到
   * `/skill?screen=catalog`）都能到达这个编辑页，「返回」必须回到**这次真实
   * 点进来的那个界面**，不是按 kind 猜的唯一目的地。两个入口都把自己当前的
   * URL 编码进 `?from=`，这里解析、校验成同源相对路径后透传下去；没有合法值
   * （比如直接粘贴这个 URL 打开，没有"之前的界面"）时 `CapabilityEditPage`
   * 落回它自己的默认目的地。
   */
  const backHref = safeRelativePath(searchParams.from) ?? undefined;
  return (
    <AppShell previewRole={previewRole} hideTopBar>
      <CapabilityEditPage
        kind="skill"
        id={params.id}
        renderEditExtra={(row) => <SkillContentEditorSection id={`admin-skill-row-${row.id}`} row={row} />}
        compact
        backHref={backHref}
      />
    </AppShell>
  );
}
