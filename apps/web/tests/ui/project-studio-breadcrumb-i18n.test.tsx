import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { ProjectBreadcrumb } from "@/components/project/project-breadcrumb";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";

function Language() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale("zh-CN")}>ZH test</button><button onClick={() => setLocale("en")}>EN test</button></>;
}
beforeEach(() => localStorage.clear());

it.each(["survey", "itv", "research", "transcript", "whiteboard", "design"] as const)("localizes the %s project return without replacing its DOM or encoded destination", sub => {
  render(<I18nProvider initialLocale="en"><Language /><ProjectBreadcrumb projectId="raw/project {count}" sub={sub} className="raw-class" /></I18nProvider>);
  const nav = screen.getByRole("navigation", { name: "Back to project" });
  const link = screen.getByRole("link", { name: "Back to project" });
  const href = `/projects/raw%2Fproject%20%7Bcount%7D?tab=research&sub=${sub}`;
  expect(link).toHaveAttribute("href", href);
  expect(nav).toHaveClass("raw-class");
  fireEvent.click(screen.getByText("ZH test"));
  expect(screen.getByRole("navigation", { name: "返回项目" })).toBe(nav);
  expect(screen.getByRole("link", { name: "返回项目" })).toBe(link);
  expect(link).toHaveAttribute("href", href);
  fireEvent.click(screen.getByText("EN test"));
  expect(screen.getByRole("link", { name: "Back to project" })).toBe(link);
  expect(link).toHaveAttribute("href", href);
});

it("retains optional project context across rerenders and locale changes", () => {
  const tree = (projectId: string | null | undefined) => <I18nProvider initialLocale="en"><Language /><ProjectBreadcrumb projectId={projectId} sub="transcript" /></I18nProvider>;
  const { rerender } = render(tree(undefined));
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  rerender(tree("project-raw"));
  expect(screen.getByRole("link", { name: "Back to project" })).toHaveAttribute("href", "/projects/project-raw?tab=research&sub=transcript");
  rerender(tree(null));
  fireEvent.click(screen.getByText("ZH test"));
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
