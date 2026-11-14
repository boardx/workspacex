import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtHome } from "@/features/aidt/entry/home";
import { AidtProjectWorkspace } from "@/features/aidt/entry/workspace";
import { AidtCreateProjectForm } from "@/features/aidt/components/aidt-create-project-form";
import { AIDT_PROJECT_TAG } from "@/lib/project-aidt";
import { ApiError } from "@/lib/api-client";
const api = vi.hoisted(() => ({ list: vi.fn(), find: vi.fn(), overview: vi.fn(), create: vi.fn(), tag: vi.fn(), push: vi.fn(), workspace: vi.fn(), role: "lead" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: api.push }) }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "o1", userId: "u1", sessionToken: "token" } }),
  useOptionalSession: () => ({ session: { currentOrgId: "o1", userId: "u1", sessionToken: "token" }, identity: { orgRole: api.role } }),
}));
vi.mock("@/lib/live-projects", () => ({ listProjects: api.list, findProject: api.find, getProjectOverview: api.overview, createProject: api.create, updateProjectTags: api.tag }));
vi.mock("@/components/project/project-collaborators-panel", () => ({ ProjectCollaboratorsPanel: ({ readOnly }: { readOnly: boolean }) => <div data-testid="native-group-roster" data-readonly={String(readOnly)} /> }));
vi.mock("@/features/aidt/components/project-aidt", () => ({ ProjectAidt: (props: unknown) => { api.workspace(props); return <div data-testid="six-step-workspace" />; } }));
const special = { id: "p1", name: "食堂设计", kind: "general", status: "active", readOnlyReason: null, tags: [AIDT_PROJECT_TAG] };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true"); api.role = "lead"; api.list.mockResolvedValue([special, { ...special, id: "ordinary", tags: [] }]);
  api.find.mockResolvedValue(special); api.overview.mockResolvedValue({ projectId: "p1", name: "食堂设计", status: "active", kind: "general" });
  api.create.mockResolvedValue({ id: "p1" }); api.tag.mockResolvedValue({ id: "p1", tags: [AIDT_PROJECT_TAG] });
});
it("has its own AIDT list and entry, showing only the special profile", async () => {
  render(<AidtHome />);
  expect(await screen.findByTestId("aidt-project-p1")).toHaveAttribute("href", "/aidt/p1");
  expect(screen.queryByTestId("aidt-project-ordinary")).toBeNull();
  expect(screen.getByTestId("aidt-new")).toBeVisible();
});
it("shows list failure rather than pretending there are no AIDT projects", async () => {
  api.list.mockRejectedValue(new Error("offline")); render(<AidtHome />);
  expect(await screen.findByTestId("aidt-home-error")).toBeVisible();
  expect(screen.queryByTestId("aidt-home-empty")).toBeNull();
});
it("persists AIDT metadata before navigation and retries a partial creation without duplicate projects", async () => {
  api.find.mockResolvedValue({ ...special, tags: ["teacher-added"] });
  api.tag.mockRejectedValueOnce(new Error("offline"));
  render(<AidtCreateProjectForm cancel={<span />} />);
  fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "食堂设计" } });
  fireEvent.click(screen.getByTestId("project-new-create"));
  await screen.findByRole("alert");
  expect(api.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("project-new-create"));
  await waitFor(() => expect(api.push).toHaveBeenCalledWith("/aidt/p1"));
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.create).toHaveBeenCalledWith({ orgId: "o1", name: "食堂设计", kind: "general", blueprintVersionId: null });
  expect(api.tag).toHaveBeenLastCalledWith("p1", ["teacher-added", AIDT_PROJECT_TAG]);
});
it("refuses ordinary projects and requires the existing membership guard even when tags match", async () => {
  api.find.mockResolvedValue({ ...special, tags: [] });
  const { rerender } = render(<AidtProjectWorkspace projectId="p1" />);
  expect(await screen.findByTestId("aidt-profile-required")).toBeVisible();
  expect(api.workspace).not.toHaveBeenCalled();
  api.find.mockResolvedValue(special);
  api.overview.mockRejectedValue(new ApiError(403, "NO_PROJECT_ROLE", "NO_PROJECT_ROLE"));
  rerender(<AidtProjectWorkspace projectId="p2" />);
  expect(await screen.findByTestId("aidt-access-denied")).toBeVisible();
  expect(api.workspace).not.toHaveBeenCalled();
});
it("opens archived AIDT projects as readonly while retaining the native project ID", async () => {
  api.overview.mockResolvedValue({ projectId: "p1", name: "食堂设计", status: "archived", kind: "general" });
  render(<AidtProjectWorkspace projectId="p1" />);
  await screen.findByTestId("six-step-workspace");
  expect(api.workspace).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "p1", sub: "aidt", canWrite: false }));
  expect(screen.getByTestId("native-group-roster")).toHaveAttribute("data-readonly", "true");
});

it("does not offer profile creation to a member without the existing tag-save permission", async () => {
  api.role = "consultant";
  render(<AidtHome />);
  await screen.findByTestId("aidt-project-p1");
  expect(screen.queryByTestId("aidt-new")).toBeNull();
  expect(api.create).not.toHaveBeenCalled();
});

it("describes the real project boundary as one learning group rather than a fake internal groupId", async () => {
  render(<AidtHome />);
  await screen.findByTestId("aidt-project-p1");
  expect(screen.getByText(/每个小组一个学习空间/)).toBeVisible();
  expect(screen.getByRole("button", { name: "新建小组空间" })).toBeVisible();
});

it("allows the active administrator role to create groups, matching current server rules", async () => {
  api.role = "admin";
  render(<AidtHome />);
  await screen.findByTestId("aidt-project-p1");
  expect(screen.getByTestId("aidt-new")).toBeVisible();
});
