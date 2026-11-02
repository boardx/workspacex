import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/locale";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
function Example() { const { t } = useI18n(); return <><LanguageSwitcher /><p>{t("home.greeting", { name: "<Alice>" })}</p></>; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.cookie = `${LOCALE_COOKIE}=; Max-Age=0; Path=/`; vi.restoreAllMocks(); });
describe("application language", () => {
 it("uses only supported cookie values", () => { expect(resolveLocale("en")).toBe("en"); expect(resolveLocale("en-US")).toBe("zh-CN"); expect(resolveLocale('<script>')).toBe("zh-CN"); });
 it("switches immediately, preserves content as text and persists for refresh", () => {
  const view = render(<I18nProvider initialLocale="zh-CN"><Example /></I18nProvider>);
  expect(screen.getByText("你好，<Alice>")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
  expect(screen.getByText("Hello, <Alice>")).toBeInTheDocument();
  expect(document.documentElement.lang).toBe("en"); expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`);
  view.unmount(); render(<I18nProvider initialLocale="en"><Example /></I18nProvider>);
  expect(screen.getByText("Hello, <Alice>")).toBeInTheDocument();
 });
 it("still switches when cookie access is denied", () => {
  vi.spyOn(document, "cookie", "set").mockImplementation(() => { throw Error("denied"); });
  render(<I18nProvider initialLocale="zh-CN"><Example /></I18nProvider>);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
  expect(screen.getByText("Hello, <Alice>")).toBeInTheDocument();
 });
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/home" }));
import { AgentsStrip, QuickActionsGrid } from "@/components/home/home-sections";
import { MobileTabs } from "@/components/shell/mobile-tabs";
import { AuthShell } from "@/components/entry/auth-shell";
import { I18nText } from "@/lib/i18n/text";
vi.mock("@/lib/use-authed-image-src", () => ({ useAuthedImageSrc: () => ({ src: null, failed: false }) }));
it("translates home actions, mobile navigation and accessible agent labels while preserving API content", () => {
 render(<I18nProvider initialLocale="en"><QuickActionsGrid actions={[{key: "research", enabled: true, order: 0}]} /><AgentsStrip agents={[{agentId:"a1",name:"研究伙伴",roleLabel:null,note:"组织原文",avatarKey:null}]} /><MobileTabs /></I18nProvider>);
 expect(screen.getByTestId("home-quick-action-research")).toHaveTextContent("Deep research");
 expect(screen.getByRole("link", {name: "Chat with 研究伙伴"})).toHaveTextContent("组织原文");
 expect(screen.getByTestId("mobile-tab-chat")).toHaveTextContent("Chats");
 expect(screen.getByTestId("mobile-tab-me")).toHaveTextContent("Me");
});
it("switches login heading and brand without a navigation", () => {
 render(<I18nProvider initialLocale="zh-CN"><AuthShell title={<I18nText message="ui.signInToWorkspacex" />} /></I18nProvider>);
 fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
 expect(screen.getByRole("heading", {name: "Sign in to WorkspaceX"})).toBeInTheDocument();
 expect(screen.getByRole("heading", { name: /Do great work/ })).toBeInTheDocument();
});

import { PersonalMenu } from "@/components/shell/personal-menu";
import { waitFor } from "@testing-library/react";
it("lets keyboard users reach and choose the account menu language", async () => {
 render(<I18nProvider initialLocale="zh-CN"><PersonalMenu avatarInitial="A" /></I18nProvider>);
 fireEvent.keyDown(screen.getByTestId("rail-profile-menu"), { key: "Enter" });
 const chinese = await screen.findByRole("menuitemradio", { name: "简体中文" });
 const english = screen.getByRole("menuitemradio", { name: "English" });
 const billing = screen.getByTestId("personal-menu-billing");
 billing.focus();
 fireEvent.keyDown(billing, { key: "ArrowDown" });
 await waitFor(() => expect(chinese).toHaveFocus());
 fireEvent.keyDown(chinese, { key: "ArrowDown" });
 await waitFor(() => expect(english).toHaveFocus());
 fireEvent.keyDown(english, { key: "Enter" });
 await waitFor(() => expect(document.documentElement.lang).toBe("en"));
 expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`);
});
