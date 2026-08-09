/**
 * 主题（浅色/深色）—— 纯前端投影，无后端概念。
 *
 * `.dark` class 的完整 token 集合已经在 `app/globals.css` 里定义好，本文件只负责
 * “谁来切”：读/写 `localStorage`，给 `<html>` 加减 `.dark` class。
 *
 * ⚠ 避免刷新闪烁：真正生效的第一次切换发生在 `app/layout.tsx` 的内联阻塞脚本里
 *   （在 hydration 之前跑），不是这个模块——这个模块只服务于「用户点击切换」之后
 *   的运行期调用，以及各处组件读取「当前是哪个」时的口径统一。
 */
export const THEME_STORAGE_KEY = "wsx.theme";

export type ThemeMode = "light" | "dark";

export function getStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === "dark" || raw === "light" ? raw : null;
}

export function prefersDarkColorScheme(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 首屏应该用哪个主题：优先用户存过的选择，其次操作系统偏好，否则浅色。 */
export function resolveInitialTheme(): ThemeMode {
  return getStoredTheme() ?? (prefersDarkColorScheme() ? "dark" : "light");
}

export function readCurrentTheme(): ThemeMode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  }
}

/** 内联进 `<head>` 的阻塞脚本源码——早于 hydration 执行，避免「先亮后暗」闪烁。 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k);if(t!=='dark'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;
