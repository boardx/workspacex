import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
const api = vi.hoisted(() => ({ listProjects: vi.fn() }));
const nav = vi.hoisted(() => ({ pathname: "/studio/survey/new", query: "projectId=p-1" }));
vi.mock("@/lib/live-projects", () => api);
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(nav.query) }));
import { TopBar } from "@/components/shell/top-bar";
import { mockIdentity } from "@/lib/identity";
const identity = mockIdentity("org-yuanyang", "facilitator");
function bar(orgId = identity.org.id) { return <TopBar identity={{ ...identity, org: { ...identity.org, id: orgId } }} previewRole={null} organizations={[]} onSwitchOrganization={() => {}} />; }
afterEach(() => { cleanup(); api.listProjects.mockReset(); nav.query = "projectId=p-1"; });
it.each(["/studio/survey/new", "/studio/survey/saved/design", "/rec", "/studio/design-workbench", "/itv/new", "/research/new", "/studio/research"])("%s displays only the authorized project name on initial load", async pathname => {
 nav.pathname = pathname;
 api.listProjects.mockResolvedValue([{ id: "p-1", name: "授权项目甲" }]);
 render(bar());
 expect(await screen.findByText("授权项目甲")).toBeVisible();
 expect(api.listProjects).toHaveBeenCalledWith(identity.org.id);
 expect(screen.queryByTestId("topbar-no-project-hint")).toBeNull();
 expect(screen.queryByTestId("role-bar-project")).toBeNull();
 expect(screen.queryByTestId("role-preview-switcher")).toBeNull();
});
it.each([[], [{ id: "other", name: "另一个项目" }]])("unlisted project never creates context or a role", async items => {
 nav.pathname = "/studio/survey/new";
 api.listProjects.mockResolvedValue(items);
 render(bar());
 await act(async () => {});
 expect(api.listProjects).toHaveBeenCalled();
 expect(screen.queryByTestId("topbar-project-context")).toBeNull();
 expect(screen.queryByTestId("role-bar-project")).toBeNull();
 expect(screen.queryByText("p-1")).toBeNull();
});
it("request failure fails closed", async () => {
 nav.pathname = "/studio/survey/new"; api.listProjects.mockRejectedValue(new Error("forbidden"));
 render(bar()); await act(async () => {});
 expect(api.listProjects).toHaveBeenCalled();
 expect(screen.queryByTestId("topbar-project-context")).toBeNull();
});
it("global tool and unrelated query do not fetch or invent context", () => {
 nav.pathname = "/studio/survey/new"; nav.query = "";
 const view = render(bar());
 expect(screen.getByTestId("topbar-no-project-hint")).toBeVisible();
 expect(api.listProjects).not.toHaveBeenCalled();
 nav.pathname = "/settings"; nav.query = "projectId=p-1"; view.rerender(bar());
 expect(screen.queryByTestId("topbar-project-context")).toBeNull();
 expect(api.listProjects).not.toHaveBeenCalled();
});
it("query/org changes discard old names and ignore late authorization results", async () => {
 nav.pathname = "/studio/survey/new";
 api.listProjects.mockResolvedValueOnce([{ id: "p-1", name: "授权项目甲" }]);
 const view = render(bar()); expect(await screen.findByText("授权项目甲")).toBeVisible();
 let resolve!: (items: {id:string;name:string}[]) => void;
 api.listProjects.mockReturnValueOnce(new Promise(r => {resolve=r;}));
 nav.query = "projectId=p-2"; view.rerender(bar());
 expect(screen.queryByText("授权项目甲")).toBeNull();
 api.listProjects.mockResolvedValueOnce([]); view.rerender(bar("different-org"));
 await act(async () => { resolve([{id:"p-2",name:"旧组织迟到项目"}]); });
 expect(screen.queryByTestId("topbar-project-context")).toBeNull();
});

it("project chat retains its existing project context", async () => {
 nav.pathname = "/chat"; api.listProjects.mockResolvedValue([{ id: "p-1", name: "授权对话项目" }]);
 render(bar()); expect(await screen.findByText("授权对话项目")).toBeVisible();
 expect(screen.getByTestId("role-bar-project")).toBeVisible();
});
