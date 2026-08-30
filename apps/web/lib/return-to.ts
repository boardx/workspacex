/**
 * 登录态跳转的 return-to（`?next=`）净化。
 *
 * 背景（画布模板后台管理刷新掉回根目录一案）：`SessionAppShell` 检测到匿名态时
 * 会 `router.replace("/login")`，`LoginSessionGate` 检测到已登录时会
 * `router.replace("/projects")`——两个跳转目标此前**都写死**，深链（如
 * `/canvas?screen=template-admin`）在链路里彻底丢失，刷新即掉回首页。
 *
 * 这里只做一件事：把「回哪」收敛成一个净化函数，两端各自只管调用，不重复实现
 * 校验规则——同一份校验分叉成两份，就是本仓 AGENTS.md 点名的重复事实源。
 *
 * 只接受**同源相对路径**：
 * - 必须以单个 `/` 开头（拒绝 `//evil.com`、`http://…` 等协议/主机注入）。
 * - 拒绝以 `/login` 开头（避免登录成功后又跳回登录页的循环）。
 * 任何不满足的输入一律回落到 `fallback`。
 */
export function sanitizeReturnTo(raw: string | null | undefined, fallback = "/projects"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (raw === "/login" || raw.startsWith("/login/") || raw.startsWith("/login?")) return fallback;
  return raw;
}
