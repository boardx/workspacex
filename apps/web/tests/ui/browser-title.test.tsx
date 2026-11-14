import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MobileTabs } from "@/components/shell/mobile-tabs";
import { I18nProvider } from "@/lib/i18n/provider";
import { BrowserTitleProvider, useBrowserTitle } from "@/components/system/browser-title";

// This suite exercises the explicitly enabled teaching navigation; default-off behavior is covered by module compatibility tests.
vi.mock("@/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => true }));

const route = vi.hoisted(() => ({ pathname: "/projects", search: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useSearchParams: () => new URLSearchParams(route.search) }));
afterEach(cleanup);

function ContentTitle({ name }: { name?: string }) {
  useBrowserTitle(name);
  return null;
}
function app(name?: string) {
  return <I18nProvider initialLocale="zh-CN"><BrowserTitleProvider><ContentTitle name={name} /></BrowserTitleProvider></I18nProvider>;
}

it("uses module names and replaces them with saved content names when available", () => {
  route.pathname = "/projects";
  const view = render(app());
  expect(document.title).toBe("项目");
  route.pathname = "/projects/project-1";
  view.rerender(app("课程项目"));
  expect(document.title).toBe("课程项目");
  view.rerender(app("改名后的项目"));
  expect(document.title).toBe("改名后的项目");
  route.pathname = "/inbox";
  view.rerender(app());
  expect(document.title).toBe("站内信");
  route.pathname = "/org-admin/invites";
  view.rerender(app());
  expect(document.title).toBe("邀请");
});

it("restores the content name after query-only navigation replaces server metadata", () => {
  route.pathname = "/projects/project-1";
  route.search = "tab=overview";
  const view = render(app("课程项目"));
  expect(document.title).toBe("课程项目");
  document.title = "工作台";
  route.search = "tab=content";
  view.rerender(app("课程项目"));
  expect(document.title).toBe("课程项目");
});

it("resolves the separate AIDT navigation title in both languages without crashing", () => {
  route.pathname = "/aidt/p1";
  const view = render(<I18nProvider initialLocale="zh-CN"><BrowserTitleProvider><span>AIDT</span></BrowserTitleProvider></I18nProvider>);
  expect(document.title).toBe("AIDT");
  view.unmount();
  render(<I18nProvider initialLocale="en"><BrowserTitleProvider><span>AIDT</span></BrowserTitleProvider></I18nProvider>);
  expect(document.title).toBe("AIDT");
});

it("keeps AIDT independently reachable in mobile navigation", () => {
  route.pathname = "/aidt/p1";
  render(<I18nProvider initialLocale="zh-CN"><MobileTabs /></I18nProvider>);
  expect(screen.getByTestId("mobile-tab-aidt")).toHaveAttribute("href", "/aidt");
  expect(screen.getByTestId("mobile-tab-aidt")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("mobile-tab-projects")).toHaveAttribute("href", "/projects");
});
