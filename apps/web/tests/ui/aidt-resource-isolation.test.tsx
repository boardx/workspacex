import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtHome } from "@/features/aidt/entry/home";
import { AidtProjectWorkspace } from "@/features/aidt/entry/workspace";
import { AidtMaterials } from "@/features/aidt/components/aidt-materials";
import { AidtBoardReturn } from "@/features/aidt/entry/board-return";
import { ApiError } from "@/lib/api-client";
import { AIDT_PROJECT_TAG } from "@/lib/project-aidt";

const mocks = vi.hoisted(() => ({
  session: { currentOrgId: "org", userId: "student-a", sessionToken: "token" },
  identity: { orgRole: "admin" },
  search: "", request: vi.fn(), roster: vi.fn(), list: vi.fn(), find: vi.fn(), overview: vi.fn(), materials: vi.fn(), workspace: vi.fn(), membership: vi.fn(), breadcrumb: vi.fn(),
}));
const aidtConfig = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({
  isAidtModuleEnabled: () => aidtConfig.enabled,
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...await original<typeof import("@/lib/api-client")>(), apiRequest: mocks.request,
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.search), useParams: () => ({ boardId: "board/1" }) }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: mocks.session, identity: mocks.identity }), useSession: () => ({ session: mocks.session, identity: mocks.identity }) }));
vi.mock("@/features/aidt/lib/aidt-project-membership", () => ({ readAidtProjectMembership: mocks.membership }));
vi.mock("@/lib/live-projects", () => ({ listProjects: mocks.list, findProject: mocks.find, getProjectOverview: mocks.overview }));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mocks.materials, PROJECT_RESOURCE_KIND_LABEL_ZH: { design: "设计", personal_transcription: "个人转录" } }));
vi.mock("@/components/project/project-resource-section", () => ({ projectResourceHref: (_kind: string, id: string) => `/source/${encodeURIComponent(id)}`, describeProjectResourceFailure: () => "资料读取失败，访问资格需重新核对" }));
vi.mock("@/components/project/project-collaborators-panel", () => ({ ProjectCollaboratorsPanel: (props: { readOnly: boolean }) => <div data-testid="native-roster" data-readonly={String(props.readOnly)} /> }));
vi.mock("@/features/aidt/components/project-aidt", () => ({ ProjectAidt: (props: unknown) => { mocks.workspace(props); return <div data-testid="native-aidt-workspace" />; } }));
vi.mock("@/components/project/create-project-form", () => ({ CreateProjectForm: () => <input aria-label="创建表单草稿" defaultValue="" /> }));
vi.mock("@/components/project/project-breadcrumb", () => ({ ProjectBreadcrumb: (props: unknown) => { mocks.breadcrumb(props); return <nav data-testid="native-board-return" />; } }));

const project = { id: "group", name: "本组", kind: "general", status: "active", readOnlyReason: null, tags: [AIDT_PROJECT_TAG] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.clearAllMocks(); aidtConfig.enabled = true;
  mocks.session = { currentOrgId: "org", userId: "student-a", sessionToken: "token" }; mocks.identity.orgRole = "admin"; mocks.search = "";
  mocks.list.mockResolvedValue([project]); mocks.find.mockResolvedValue(project);
  // Exercise the real member-filtering loader. Organization management alone is not membership.
  mocks.roster.mockResolvedValue({ members: [
    { userId: "student-a", displayName: "学生A", role: "owner" },
    { userId: "student-b", displayName: "学生B", role: "collaborator" },
  ] });
  mocks.request.mockImplementation((path: string, options: unknown) => {
    if (path === "/projects") return mocks.list(options);
    if (/^\/projects\/[^/]+\/collaborators$/.test(path)) return mocks.roster(path, options);
    if (path === "/aidt/courses") return Promise.resolve({ items: [], nextCursor: null });
    throw new Error("Unexpected resource-isolation fixture request");
  });
  mocks.overview.mockResolvedValue({ projectId: "group", name: "本组", status: "active", kind: "general" });
  mocks.membership.mockResolvedValue("owner");
  mocks.materials.mockResolvedValue({ items: [] });
});


it("closes and discards a group's creation form on actor or organization change", async () => {
  const { rerender } = render(<AidtHome />);
  await screen.findByTestId("aidt-project-group"); fireEvent.click(screen.getByTestId("aidt-new"));
  fireEvent.change(screen.getByLabelText("创建表单草稿"), { target: { value: "只属于学生A的草稿" } });
  mocks.session = { ...mocks.session, userId: "student-b" }; rerender(<AidtHome />);
  expect(screen.queryByLabelText("创建表单草稿")).toBeNull();
  await screen.findByTestId("aidt-project-group"); fireEvent.click(screen.getByTestId("aidt-new"));
  expect(screen.getByLabelText("创建表单草稿")).toHaveValue("");
  mocks.session = { ...mocks.session, currentOrgId: "other-org" }; rerender(<AidtHome />);
  expect(screen.queryByLabelText("创建表单草稿")).toBeNull();
});

it("does not restore a previous user's late group list in the same organization", async () => {
  const old = deferred<unknown>(); mocks.list.mockImplementationOnce(() => old.promise);
  const { rerender } = render(<AidtHome />);
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
  const oldSignal = mocks.list.mock.calls[0]![0].signal as AbortSignal;
  mocks.session = { ...mocks.session, userId: "student-b" };
  mocks.list.mockResolvedValue([{ ...project, id: "current", name: "当前学生的小组" }]); rerender(<AidtHome />);
  expect(await screen.findByTestId("aidt-project-current")).toBeVisible();
  await act(async () => { old.resolve([{ ...project, id: "private-old", name: "前一学生的小组" }]); });
  expect(screen.queryByTestId("aidt-project-private-old")).toBeNull();
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(oldSignal.aborted).toBe(true);
});

it("hides the old workspace synchronously while the new actor's membership is unresolved", async () => {
  const { rerender } = render(<AidtProjectWorkspace projectId="group" />);
  await screen.findByTestId("native-aidt-workspace");
  const access = deferred<unknown>(); mocks.overview.mockImplementationOnce(() => access.promise);
  mocks.session = { ...mocks.session, userId: "student-b" }; rerender(<AidtProjectWorkspace projectId="group" />);
  expect(screen.queryByTestId("native-aidt-workspace")).toBeNull();
  expect(screen.getByTestId("aidt-project-loading")).toBeVisible();
  await act(async () => { access.reject(new ApiError(403, "NO_PROJECT_ROLE", "NO_PROJECT_ROLE")); });
  expect(await screen.findByTestId("aidt-access-denied")).toBeVisible();
  expect(mocks.workspace).toHaveBeenCalledTimes(1);
});

it.each(["currentOrgId", "userId", "sessionToken"] as const)("does not call project/resource services with missing %s", async (key) => {
  mocks.session = { ...mocks.session, [key]: "" };
  render(<><AidtHome /><AidtProjectWorkspace projectId="group" /><AidtMaterials projectId="group" /></>);
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.find).not.toHaveBeenCalled();
  expect(mocks.overview).not.toHaveBeenCalled(); expect(mocks.materials).not.toHaveBeenCalled();
  expect(screen.queryByTestId("aidt-new")).toBeNull();
});

it("does not display a former actor's resources or hide an access read failure as an empty list", async () => {
  mocks.materials.mockResolvedValueOnce({ items: [{ kind: "design", id: "private", title: "旧用户的原型", status: "draft", updatedAt: "2026-11-15T00:00:00Z" }] });
  const { rerender } = render(<AidtMaterials projectId="group" />); await screen.findByRole("link", { name: "旧用户的原型" });
  const read = deferred<unknown>(); mocks.materials.mockImplementationOnce(() => read.promise);
  mocks.session = { ...mocks.session, userId: "student-b" }; rerender(<AidtMaterials projectId="group" />);
  expect(screen.queryByRole("link", { name: "旧用户的原型" })).toBeNull();
  await act(async () => { read.reject(new ApiError(403, "PROJECT_ROLE_REQUIRED", "PROJECT_ROLE_REQUIRED")); });
  expect(await screen.findByRole("alert")).toHaveTextContent("访问资格需重新核对");
  expect(screen.queryByText(/当前没有已关联资料/)).toBeNull();
});

it("keeps native design/transcription references and states their evidence boundary", async () => {
  mocks.materials.mockResolvedValue({ items: [
    { kind: "design", id: "design/1", title: "静态原型", status: "draft", updatedAt: "2026-11-15T00:00:00Z" },
    { kind: "personal_transcription", id: "record/1", title: "个人笔记", status: "completed", updatedAt: "2026-11-15T00:00:00Z" },
  ] });
  render(<AidtMaterials projectId="group/1" />);
  expect(await screen.findByRole("link", { name: "静态原型" })).toHaveAttribute("href", "/aidt/group%2F1?step=5&tool=design&resource=design%2F1");
  expect(screen.getByRole("link", { name: "个人笔记" })).toHaveAttribute("href", "/aidt/group%2F1?step=2&tool=transcript&resource=record%2F1");
  expect(screen.getByText(/关联不代表材料已核实/)).toBeVisible();
});

it("leaves ordinary Board navigation untouched unless AIDT is enabled with an explicit valid context", async () => {
  mocks.search = "projectId=group&aidtStep=2"; aidtConfig.enabled = false;
  const { rerender } = render(<AidtBoardReturn />); expect(mocks.breadcrumb).not.toHaveBeenCalled();
  aidtConfig.enabled = true;
  for (const query of ["projectId=group&step=2", "projectId=group&aidtStep=unknown", "projectId=group&aidtStep=7", "aidtStep=2", "projectId=%20&aidtStep=2"]) {
    mocks.search = query; rerender(<AidtBoardReturn />); expect(screen.queryByTestId("native-board-return")).toBeNull();
  }
  mocks.search = "projectId=group%2F1&aidtStep=2"; rerender(<AidtBoardReturn />);
  expect(screen.getByTestId("native-board-return")).toBeVisible();
  await waitFor(() => expect(mocks.breadcrumb).toHaveBeenLastCalledWith({ projectId: "group/1", sub: "whiteboard", hrefOverride: "/aidt/group%2F1?step=2&tool=whiteboard&resource=board%2F1", labelOverride: "返回 AIDT 步骤" }));
});


it("does not revive a previous actor roster result after the actor leaves and returns", async () => {
  const late = deferred<"owner">(); mocks.membership.mockImplementationOnce(() => late.promise);
  const original = {...mocks.session};const {rerender}=render(<AidtProjectWorkspace projectId="group" />);
  await waitFor(()=>expect(mocks.membership).toHaveBeenCalledTimes(1));
  mocks.session={...original,userId:"student-b"};rerender(<AidtProjectWorkspace projectId="group" />);
  await screen.findByTestId("native-aidt-workspace");
  mocks.membership.mockResolvedValue(null);mocks.session=original;rerender(<AidtProjectWorkspace projectId="group" />);
  await screen.findByTestId("aidt-access-denied");
  await act(async()=>{late.resolve("owner");});expect(screen.queryByTestId("native-aidt-workspace")).toBeNull();
});

it("does not turn organization-admin visibility into actual group membership", async () => {
  mocks.roster.mockResolvedValue({ members: [{ userId: "other-owner", displayName: "其他成员", role: "owner" }] });
  render(<AidtHome />);
  await screen.findByTestId("aidt-home-empty");
  expect(screen.queryByTestId("aidt-project-group")).toBeNull();
  expect(mocks.roster).toHaveBeenCalledWith("/projects/group/collaborators", expect.objectContaining({ sessionToken: "token", signal: expect.any(AbortSignal) }));
});


it("opens members in a focused settings dialog and removes it immediately when the actor changes", async () => {
  const { rerender } = render(<AidtProjectWorkspace projectId="group" />);
  await screen.findByTestId("native-aidt-workspace");
  expect(screen.queryByTestId("native-roster")).toBeNull();
  const trigger = screen.getByTestId("aidt-project-settings");
  fireEvent.click(trigger);
  expect(await screen.findByRole("dialog", { name: "小组设置" })).toBeVisible();
  expect(screen.getByTestId("native-roster")).toHaveAttribute("data-readonly", "false");
  fireEvent.click(screen.getByTestId("dialog-close"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
  fireEvent.click(trigger);
  await screen.findByTestId("native-roster");
  mocks.session = { ...mocks.session, userId: "student-b" };
  rerender(<AidtProjectWorkspace projectId="group" />);
  expect(screen.queryByTestId("native-roster")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  await screen.findByTestId("native-aidt-workspace");
  expect(screen.queryByTestId("native-roster")).toBeNull();
});

it("keeps archived group members viewable in settings with the native panel read-only", async () => {
  mocks.find.mockResolvedValue({ ...project, status: "archived", readOnlyReason: "archived" });
  mocks.overview.mockResolvedValue({ projectId: "group", name: "本组", status: "archived", kind: "general" });
  render(<AidtProjectWorkspace projectId="group" />);
  await screen.findByTestId("native-aidt-workspace");
  fireEvent.click(screen.getByTestId("aidt-project-settings"));
  expect(await screen.findByTestId("native-roster")).toHaveAttribute("data-readonly", "true");
});
