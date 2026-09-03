import { redirect } from "next/navigation";
import { platformAdminHref } from "@/lib/platform-admin-routes";

/**
 * 平台后台根路径（2026-09-02 人类直接裁决：后台切成「组织后台」与「平台后台」两个一级入口，
 * 见 `lib/mock/admin.ts` 的 `AdminScope`）。
 *
 * 平台面今天没有单独的「总览」屏——没有就不编一个空壳页，直接落到平台面的第一个模块
 * （Agent 目录；2026-09-02 第二次裁决 AI 能力归平台后台之前这里是平台成员）。左栏由 `AdminNav scope="platform"` 渲染，见 `[module]/page.tsx`。
 */
export default function PlatformAdminRootPage() {
  redirect(platformAdminHref("agent"));
}
