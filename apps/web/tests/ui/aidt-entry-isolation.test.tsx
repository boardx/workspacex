import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateProjectForm } from "@/components/project/create-project-form";
import { AidtCreateProjectForm } from "@/features/aidt/components/aidt-create-project-form";
import { ProjectsScreen } from "@/components/projects/projects-screen";
import { ProjectBreadcrumb } from "@/components/project/project-breadcrumb";
import { ProjectCard } from "@/components/home/home-work-cards";
import AidtPage from "@/app/aidt/page";
import AidtProjectPage from "@/app/aidt/[projectId]/page";

const api = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), find: vi.fn(), tag: vi.fn(), push: vi.fn(), home: vi.fn(), workspace: vi.fn(), loadHome: vi.fn(), loadWorkspace: vi.fn(), search: "",
  session: { userId: "student-a", currentOrgId: "org-a", sessionToken: "token-a" }, role: "lead",
}));
const aidtConfig = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({
  isAidtModuleEnabled: () => aidtConfig.enabled,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: api.push }), useSearchParams: () => new URLSearchParams(api.search),
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/components/shell/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/features/aidt/entry/home", () => { api.loadHome(); return { AidtHome: () => { api.home(); return <div data-testid="enabled-aidt-home" />; } }; });
vi.mock("@/features/aidt/entry/workspace", () => { api.loadWorkspace(); return { AidtProjectWorkspace: ({ projectId }: { projectId: string }) => { api.workspace(projectId); return <div data-testid="enabled-aidt-workspace" />; } }; });
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: api.session, identity: { orgRole: api.role } }),
  useOptionalSession: () => ({ session: api.session, identity: { orgRole: api.role } }),
}));
vi.mock("@/lib/live-projects", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/live-projects")>(),
  listProjects: api.list, createProject: api.create, findProject: api.find, updateProjectTags: api.tag,
}));
const tagged = { id: "teaching", name: "已有教学项目", kind: "general" as const, status: "active", readOnlyReason: null, tags: ["workspacex:aidt"], collaborators: null };
const regular = { ...tagged, id: "regular", name: "原有普通项目", tags: [] };
beforeEach(() => {
  vi.clearAllMocks(); aidtConfig.enabled = false; localStorage.clear(); api.search = "";
  api.session = { userId: "student-a", currentOrgId: "org-a", sessionToken: "token-a" };
  api.role = "lead";
  api.list.mockResolvedValue([tagged, regular]); api.create.mockResolvedValue({ id: "created" });
  api.find.mockResolvedValue({ ...tagged, id: "created" }); api.tag.mockResolvedValue({ tags: ["workspacex:aidt"] });
});


it("rejects both disabled routes before importing or mounting teaching workspaces", async () => {
  await expect(AidtPage()).rejects.toThrow("NOT_FOUND");
  await expect(AidtProjectPage({ params: { projectId: "teaching" } })).rejects.toThrow("NOT_FOUND");
  expect(api.loadHome).not.toHaveBeenCalled(); expect(api.loadWorkspace).not.toHaveBeenCalled();
  expect(api.list).not.toHaveBeenCalled(); expect(api.find).not.toHaveBeenCalled();
});
it("loads the independent home and group route only when explicitly enabled", async () => {
  aidtConfig.enabled = true;
  render(await AidtPage()); render(await AidtProjectPage({ params: { projectId: "group/one" } }));
  expect(screen.getByTestId("enabled-aidt-home")).toBeVisible(); expect(api.workspace).toHaveBeenCalledWith("group/one");
});
it("keeps tagged projects in the ordinary list while the module is off", async () => {
  render(<ProjectsScreen />);
  expect(await screen.findByTestId("projects-card-teaching-name")).toHaveTextContent("已有教学项目");
  expect(screen.getByTestId("projects-card-regular-name")).toBeVisible();
});
it("separates teaching projects only after the module is enabled", async () => {
  aidtConfig.enabled = true; render(<ProjectsScreen />);
  await screen.findByTestId("projects-card-regular-name"); expect(screen.queryByTestId("projects-card-teaching-name")).toBeNull();
});
it("keeps a tagged Home card on the ordinary project path while disabled", () => {
  render(<ProjectCard project={tagged} />);
  expect(screen.getByRole("link")).toHaveAttribute("href", "/projects/teaching");
  expect(screen.getByRole("link")).not.toHaveTextContent("AIDT");
});
it("does not let disabled aidtStep or unrelated step parameters hijack a Studio return", () => {
  api.search = "aidtStep=2&step=3&thread=private";
  const { rerender } = render(<ProjectBreadcrumb projectId="group/one" sub="transcript" />);
  expect(screen.getByTestId("project-breadcrumb-back")).toHaveAttribute("href", "/projects/group%2Fone?tab=research&sub=transcript");
  aidtConfig.enabled = true; api.search = "step=3";
  rerender(<ProjectBreadcrumb projectId="group/one" sub="transcript" />);
  expect(screen.getByTestId("project-breadcrumb-back")).toHaveAttribute("href", "/projects/group%2Fone?tab=research&sub=transcript");
  api.search = "aidtStep=2&aidtThread=thread-a"; rerender(<ProjectBreadcrumb projectId="group/one" sub="transcript" />);
  expect(screen.getByTestId("project-breadcrumb-back")).toHaveAttribute("href", "/aidt/group%2Fone?step=2&tool=transcript&thread=thread-a");
});
it("blocks a disabled profile without creating or retagging an ordinary project", () => {
  render(<AidtCreateProjectForm cancel={<span />} />);
  expect(screen.getByTestId("aidt-create-disabled")).toBeVisible(); expect(screen.queryByTestId("project-new-create")).toBeNull();
  expect(api.create).not.toHaveBeenCalled(); expect(api.tag).not.toHaveBeenCalled();
});
it("preserves the ordinary creation contract with the module disabled", async () => {
  render(<CreateProjectForm cancel={<span />} />);
  fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "普通项目" } }); fireEvent.click(screen.getByTestId("project-new-create"));
  await waitFor(() => expect(api.push).toHaveBeenCalledWith("/projects/created?org=org-a"));
  expect(api.create).toHaveBeenCalledWith({ orgId: "org-a", name: "普通项目", kind: "general", blueprintVersionId: null });
  expect(api.find).not.toHaveBeenCalled(); expect(api.tag).not.toHaveBeenCalled();
});
it("does not continue an AIDT metadata chain after its actor changes", async () => {
  aidtConfig.enabled = true; let finish!: (value: { id: string }) => void;
  api.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const tree = <AidtCreateProjectForm cancel={<span />} />;
  const { rerender } = render(tree); fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "A组" } }); fireEvent.click(screen.getByTestId("project-new-create"));
  expect(api.create).toHaveBeenCalledTimes(1); api.session = { userId: "student-b", currentOrgId: "org-b", sessionToken: "token-b" }; rerender(<AidtCreateProjectForm cancel={<span />} />);
  await act(async () => { finish({ id: "old-created" }); });
  expect(api.find).not.toHaveBeenCalled(); expect(api.tag).not.toHaveBeenCalled(); expect(api.push).not.toHaveBeenCalled(); expect(screen.getByTestId("project-new-name")).toHaveValue("");
});
it("does not retag a project when an unmounted AIDT creation finishes late", async () => {
  aidtConfig.enabled = true; let finish!: (value: { id: string }) => void;
  api.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { unmount } = render(<AidtCreateProjectForm cancel={<span />} />);
  fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "A组" } }); fireEvent.click(screen.getByTestId("project-new-create")); unmount();
  await act(async () => { finish({ id: "old-created" }); }); expect(api.find).not.toHaveBeenCalled(); expect(api.tag).not.toHaveBeenCalled(); expect(api.push).not.toHaveBeenCalled();
});

it("ignores a metadata lookup that returns for an old token", async () => {
  aidtConfig.enabled = true; let finish!: (value: typeof tagged) => void;
  api.find.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<AidtCreateProjectForm cancel={<span />} />);
  fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "A组" } }); fireEvent.click(screen.getByTestId("project-new-create"));
  await waitFor(() => expect(api.find).toHaveBeenCalledWith("org-a", "created"));
  api.session = { ...api.session, sessionToken: "rotated-token" }; rerender(<AidtCreateProjectForm cancel={<span />} />);
  await act(async () => { finish(tagged); }); expect(api.tag).not.toHaveBeenCalled(); expect(api.push).not.toHaveBeenCalled();
});
it("ignores an old profile readback after the acting user changes", async () => {
  aidtConfig.enabled = true; let finish!: (value: typeof tagged) => void;
  api.find.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<AidtCreateProjectForm cancel={<span />} />);
  fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "A组" } }); fireEvent.click(screen.getByTestId("project-new-create"));
  await waitFor(() => expect(api.find).toHaveBeenCalledTimes(1));
  api.session = { ...api.session, userId: "another-student" }; rerender(<AidtCreateProjectForm cancel={<span />} />);
  await act(async () => { finish({ ...tagged, id: "created" }); }); expect(api.tag).not.toHaveBeenCalled(); expect(api.push).not.toHaveBeenCalled(); expect(screen.getByTestId("project-new-name")).toHaveValue("");
});


it("does not revive an old creation after the actor leaves and returns to the same scope", async () => {
  aidtConfig.enabled = true; let finish!: (value: { id: string }) => void;
  api.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const original = { ...api.session }; const { rerender } = render(<AidtCreateProjectForm cancel={<span />} />);
  fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "旧A组请求" } }); fireEvent.click(screen.getByTestId("project-new-create"));
  api.session = { ...original, userId: "student-b" }; rerender(<AidtCreateProjectForm cancel={<span />} />);
  api.session = original; rerender(<AidtCreateProjectForm cancel={<span />} />);
  await act(async () => { finish({ id: "old-created" }); });
  expect(api.find).not.toHaveBeenCalled(); expect(api.tag).not.toHaveBeenCalled(); expect(api.push).not.toHaveBeenCalled();
  expect(screen.getByTestId("project-new-name")).toHaveValue("");
});

it("rejects a late creation readback after a same-token role change", async () => {
  aidtConfig.enabled = true; let finish!: (value: typeof tagged) => void;
  api.find.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<AidtCreateProjectForm cancel={<span />} />);
  fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "第三组" } });
  fireEvent.click(screen.getByTestId("project-new-create"));
  await waitFor(() => expect(api.find).toHaveBeenCalledTimes(1));
  api.role = "compliance"; rerender(<AidtCreateProjectForm cancel={<span />} />);
  await act(async () => { finish({ ...tagged, id: "created" }); });
  expect(api.push).not.toHaveBeenCalled(); expect(api.tag).not.toHaveBeenCalled();
  expect(screen.getByTestId("project-new-name")).toHaveValue("");
});
