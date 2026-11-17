import "@testing-library/jest-dom/vitest";
import * as React from "react";
vi.mock("@/features/aidt/components/aidt-courses-panel", () => ({ AidtCoursesPanel: () => null }));
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AidtHome } from "@/features/aidt/components/aidt-home";
import { AidtCourseEntry } from "@/features/aidt/components/aidt-course-entry";
import type { AidtCourseGroup } from "@/features/aidt/lib/aidt-course-context";
const mock = vi.hoisted(() => ({ enabled: true, load: vi.fn(), session: { currentOrgId: "org", userId: "student", sessionToken: "token" } }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: mock.session, identity: { orgRole: "consultant" } }) }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mock.enabled }));
vi.mock("@/features/aidt/lib/aidt-course-context", () => ({ loadAidtCourseGroups: mock.load }));
vi.mock("@/features/aidt/components/aidt-create-project-form", () => ({ AidtCreateProjectForm: () => <span /> }));
const group = (id = "g1"): AidtCourseGroup => ({ project: { id, name: `小组${id}`, kind: "general", status: "active", readOnlyReason: null, tags: ["workspacex:aidt", "course:unverified"] }, members: [{ userId: "student", displayName: "学生甲" }, { userId: "teacher", displayName: "指导者" }] });
beforeEach(() => { vi.resetAllMocks(); mock.enabled = true; mock.session = { currentOrgId: "org", userId: "student", sessionToken: "token" }; mock.load.mockResolvedValue([group()]); });
it("renders real member names and native group destinations without pretending tags are course enrollment", () => {
  const { container } = render(<AidtCourseEntry groups={[group()]} />);
  expect(screen.getByRole("link", { name: /小组g1/ })).toHaveAttribute("href", "/aidt/g1");
  expect(screen.getByTestId("aidt-group-members-g1")).toHaveTextContent("学生甲、指导者");
  expect(container).not.toHaveTextContent("unverified"); expect(container).not.toHaveTextContent("已加入课程");
});
it("preserves native archived and organization-disabled readonly facts", () => {
  const archived = group("archived"), disabled = group("disabled"); archived.project.status = "archived"; disabled.project.readOnlyReason = "org-disabled";
  render(<AidtCourseEntry groups={[archived, disabled]} />);
  expect(screen.getByTestId("aidt-project-archived")).toHaveTextContent("已归档 · 只读");
  expect(screen.getByTestId("aidt-project-disabled")).toHaveTextContent("组织已停用 · 只读");
});
it("treats membership failure as retryable instead of an empty or fake course list", async () => {
  mock.load.mockRejectedValueOnce(new Error("403")); render(<AidtHome />);
  await screen.findByTestId("aidt-home-error"); expect(screen.queryByTestId("aidt-home-empty")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试" })); await screen.findByTestId("aidt-project-g1");
  expect(mock.load).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org", userId: "student", sessionToken: "token", signal: expect.any(AbortSignal) }));
});
it.each(["org", "user", "token", "aba"])("cancels and isolates a late group list after %s changes", async change => {
  let finish!: (value: readonly AidtCourseGroup[]) => void;
  mock.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue([group("current")]);
  const { rerender } = render(<AidtHome />); await waitFor(() => expect(mock.load).toHaveBeenCalledTimes(1));
  const signal = mock.load.mock.calls[0]![0].signal as AbortSignal;
  if (change === "org" || change === "aba") mock.session = { ...mock.session, currentOrgId: "other-org" };
  if (change === "user") mock.session = { ...mock.session, userId: "other-student" };
  if (change === "token") mock.session = { ...mock.session, sessionToken: "refreshed-token" };
  rerender(<AidtHome />); await screen.findByTestId("aidt-project-current"); expect(signal.aborted).toBe(true);
  if (change === "aba") { mock.session = { currentOrgId: "org", userId: "student", sessionToken: "token" }; rerender(<AidtHome />); await waitFor(() => expect(mock.load).toHaveBeenCalledTimes(3)); }
  await act(async () => finish([group("old-private")]));
  expect(screen.queryByTestId("aidt-project-old-private")).toBeNull(); expect(screen.getByTestId("aidt-project-current")).toBeVisible();
});
it("keeps the optional module off and clears/aborts reads on unmount", async () => {
  mock.enabled = false; const { rerender, unmount } = render(<AidtHome />); expect(mock.load).not.toHaveBeenCalled();
  mock.enabled = true; rerender(<AidtHome />); await screen.findByTestId("aidt-project-g1");
  const signal = mock.load.mock.calls[0]![0].signal as AbortSignal; unmount(); expect(signal.aborted).toBe(true);
});
