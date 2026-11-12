import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { BrowserTitleProvider, useBrowserTitle } from "@/components/system/browser-title";

const route = vi.hoisted(() => ({ pathname: "/projects" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
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
