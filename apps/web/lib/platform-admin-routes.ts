import type { AdminModuleKey } from "@/lib/mock/admin";

/**
 * 平台后台 `/platform-admin/<segment>` 的路由段 → 模块键（2026-09-02 后台切成两面，
 * 见 `lib/mock/admin.ts` 的 `AdminScope`）。
 *
 * 放在 lib 而不是 page 文件里：Next app router 的 page 文件不许导出额外符号，而测试要
 * 机械核对「平台面左栏每一项的 href 都有落点」（只补左栏不给落点 = 点进去 404）。
 *
 * ⚠ 路由段是**路径段**而不是模块键：`members` → 模块 `platform`——键名沿用旧的
 *   `admin-nav-platform` testid 与计数来源，不为改路由重命名一整串锚点。
 */
export const PLATFORM_ADMIN_ROUTES: Record<string, AdminModuleKey> = {
  // AI 能力（2026-09-02 第二次裁决：AI 能力归平台后台）
  agent: "agent",
  model: "model",
  mcp: "mcp",
  // 平台 / 运营
  members: "platform",
  feedback: "feedback",
};

export const PLATFORM_ADMIN_ROOT = "/platform-admin";

export function platformAdminHref(segment: string): string {
  return `${PLATFORM_ADMIN_ROOT}/${segment}`;
}
