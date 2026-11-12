"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ADMIN_NAV } from "@/lib/admin-nav-metadata";
import { ALL_NAV_ITEMS } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";

const moduleTitles = [
  ...ADMIN_NAV.flatMap(group => group.items.map(item => ({
    path: item.href, key: `adminNavigation.item.${item.key}` as MessageKey,
  }))),
  ...ALL_NAV_ITEMS.map(item => ({ path: item.href, key: `navigation.${item.key}` as MessageKey })),
].filter(item => item.path.startsWith("/") && !item.path.includes("?"))
 .sort((a, b) => b.path.length - a.path.length);

const specialTitles: Record<string, readonly [string, string]> = {
  "/": ["首页", "Home"],
  "/login": ["登录", "Sign in"],
  "/join": ["加入组织", "Join organization"],
  "/auth/register": ["注册账号", "Create account"],
  "/auth/verify-email": ["验证邮箱", "Verify email"],
  "/auth/reset-password": ["重置密码", "Reset password"],
  "/auth/activate": ["确认组织邀请", "Confirm organization invitation"],
  "/session": ["会话管理", "Sessions"],
  "/group": ["小组", "Group"],
  "/consent": ["同意确认", "Consent"],
  "/project/new": ["新建项目", "New project"],
  "/project": ["项目", "Project"],
  "/agent": ["智能体", "Agents"],
  "/org-admin": ["组织后台", "Organization"],
  "/billing": ["额度与订阅", "Credits and subscription"],
  "/usage": ["用量", "Usage"],
  "/studio": ["工作室", "Studio"],
  "/surveys": ["问卷", "Surveys"],
  "/share/chat": ["共享对话", "Shared conversation"],
  "/share": ["共享内容", "Shared content"],
  "/d": ["文档", "Document"],
};

type RegisterTitle = (title: string) => () => void;
const TitleContext = React.createContext<RegisterTitle | null>(null);

export function BrowserTitleProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { t, locale } = useI18n();
  const [overrides, setOverrides] = React.useState<{ path: string; title: string }[]>([]);
  const register = React.useCallback<RegisterTitle>((title) => {
    const entry = { path: pathname, title };
    setOverrides(current => [...current, entry]);
    return () => setOverrides(current => current.filter(item => item !== entry));
  }, [pathname]);
  const matchedModule = moduleTitles.find(item => pathname === item.path || pathname.startsWith(item.path + "/"));
  const specialPath = Object.keys(specialTitles).filter(path => pathname === path || pathname.startsWith(path + "/"))
    .sort((a, b) => b.length - a.length)[0];
  const special = specialPath && (!matchedModule || specialPath.length >= matchedModule.path.length) ? specialTitles[specialPath] : null;
  const fallback = pathname === "/rec" || pathname.startsWith("/rec/")
    ? t("rec.tabTitle")
    : pathname === "/inbox" ? t("notifications.inbox")
    : pathname === "/profile" ? t("profile.title")
    : special ? special[locale === "en" ? 1 : 0]
    : matchedModule ? t(matchedModule.key)
    : locale === "en" ? "Workspace" : "工作台";
  const title = overrides.slice().reverse().find(item => item.path === pathname)?.title ?? fallback;

  return <TitleContext.Provider value={register}>
    <React.Suspense fallback={null}><BrowserTitleWriter title={title} pathname={pathname} /></React.Suspense>
    {children}
  </TitleContext.Provider>;
}

function BrowserTitleWriter({ title, pathname }: { title: string; pathname: string }) {
  const search = useSearchParams()?.toString();
  React.useEffect(() => { document.title = title; }, [pathname, search, title]);
  return null;
}

/** Provide the saved name of the content currently open in the tab. */
export function useBrowserTitle(value: string | null | undefined) {
  const register = React.useContext(TitleContext);
  const title = value?.trim();
  React.useEffect(() => {
    if (!title) return;
    if (register) return register(title);
    const previous = document.title;
    document.title = title;
    return () => { if (document.title === title) document.title = previous; };
  }, [register, title]);
}
