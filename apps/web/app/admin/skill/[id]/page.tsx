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
 */
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { CapabilityEditPage } from "@/components/admin/capability-edit-page";
import { SkillContentEditorSection } from "@/components/admin/skill-content-editor";
import { resolvePreviewRole } from "@/lib/identity";

export default function SkillEditRoutePage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { as?: string };
}) {
  const previewRole = resolvePreviewRole(searchParams.as);
  return (
    <AppShell previewRole={previewRole} left={<AdminNav active="skill" />}>
      <CapabilityEditPage
        kind="skill"
        id={params.id}
        renderEditExtra={(row) => <SkillContentEditorSection id={`admin-skill-row-${row.id}`} row={row} />}
      />
    </AppShell>
  );
}
