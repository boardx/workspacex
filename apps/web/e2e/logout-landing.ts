/**
 * 登出落点的判定（#2499）——纯函数，spec 与单测共用同一份规则。
 *
 * 背景：#2413 起，登出后有两条跳转在竞争——菜单登出按钮 `router.replace("/login")`，
 * AppShell 察觉会话转匿名时 `router.replace("/login?next=<当前路径>")`（保留深链跳回，
 * 见 `components/shell/app-shell.tsx`）。谁后到谁说了算，所以**有意**的落点恰好两种：
 * `/login`，或 `/login?next=<登出时所在路径>`。
 *
 * 只接受这两种，不接受「任意查询串」也不接受「任意 origin」：外域落点、错误的回跳目标、
 * 外域回跳值、指回 /login 的循环值、重复的 `next`、多余参数、hash——都应在登出这一步红，而不是被登录后的
 * `sanitizeReturnTo` 静默收敛成 `/projects` 掩盖（独立审对 PR #2536 的两轮意见）。
 *
 * 规则本身抽成纯函数，是为了让反例能在 vitest 里红给人看（`tests/e2e/logout-landing.test.ts`），
 * 而不是只写在注释里。
 */
import { sanitizeReturnTo } from "../lib/return-to";

export interface LogoutLandingVerdict {
  ok: boolean;
  reason: string;
}

export function judgeLogoutLanding(rawUrl: string, allowedNext: string, expectedOrigin: string): LogoutLandingVerdict {
  const url = new URL(rawUrl);
  // 先看 origin：`https://evil.example/login?next=%2Fprofile` 的 pathname / 查询串全部合规，
  // 只有 origin 能把它拦下（独立审三轮）。expectedOrigin 来自 Playwright 的 baseURL，不从 page.url() 反推。
  const origin = new URL(expectedOrigin).origin;
  if (url.origin !== origin) return { ok: false, reason: `登出落点在外域 ${url.origin}，应为 ${origin}` };
  if (url.pathname !== "/login") return { ok: false, reason: `pathname 是 ${url.pathname}，不是 /login` };
  if (url.hash !== "") return { ok: false, reason: `登出落点不该带 hash：${url.hash}` };
  const extra = [...new Set(url.searchParams.keys())].filter((k) => k !== "next");
  if (extra.length > 0) return { ok: false, reason: `多余的查询参数：${extra.join(", ")}` };
  const nexts = url.searchParams.getAll("next");
  if (nexts.length === 0) return { ok: true, reason: "无 next（登出按钮的跳转先到）" };
  if (nexts.length > 1) return { ok: false, reason: `next 出现了 ${nexts.length} 次：${nexts.join(" | ")}` };
  if (nexts[0] !== allowedNext) return { ok: false, reason: `next=${nexts[0]}，应为 ${allowedNext}` };
  return { ok: true, reason: `next=${allowedNext}（匿名守卫的跳转先到）` };
}

/**
 * 从登出后落点上的登录页再登录，会落到哪：登录成功后 `login-form.tsx` 走
 * `window.location.assign(sanitizeReturnTo(next))`——带 `?next=/profile` 就回 /profile，
 * 不带就 /projects。第一次真栈复核（run 33662212857）正是在这里红的：登出落点判定放行了
 * `?next=%2Fprofile`，下一行却写死 `/projects`。期望值必须由**提交那一刻的 URL** 算出来，
 * 规则直接复用产品代码的 sanitizeReturnTo，不另抄一份（同一事实不得声明在两处）。
 */
export function expectedPostLoginLanding(rawLoginUrl: string): string {
  return sanitizeReturnTo(new URL(rawLoginUrl).searchParams.get("next"));
}
