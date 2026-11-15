import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  enabled: false, request: vi.fn(), pathname: "/aidt/group-a", query: "step=1",
  session: { status: "authenticated", session: { currentOrgId: "org", userId: "student", sessionToken: "token" } } as { status: string; session: { currentOrgId: string; userId: string; sessionToken: string } | null },
}));
vi.mock("@/lib/project-member-chat-config", () => ({ isProjectMemberChatEnabled: () => mocks.enabled }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => mocks.session }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock("next/dynamic", () => ({ default: () => function FakeMemberChat({ projectId, active }: { projectId: string; active: boolean }) {
  const [draft, change] = React.useState("");
  return <div data-testid="live-member-component" data-project={projectId} data-active={String(active)}><textarea aria-label="unsent member draft" value={draft} onChange={(event) => change(event.currentTarget.value)} /></div>;
} }));
import { ProjectMemberChatLauncher } from "@/components/project/project-member-chat-launcher";

const projects = ["a", "b"].map((id) => ({ id: `group-${id}`, name: `小组 ${id}`, kind: "general", status: "active", readOnlyReason: null, tags: [] }));
beforeEach(() => {
  mocks.enabled = true; mocks.pathname = "/aidt/group-a"; mocks.query = "step=1";
  mocks.session = { status: "authenticated", session: { currentOrgId: "org", userId: "student", sessionToken: "token" } };
  mocks.request.mockReset(); mocks.request.mockResolvedValue(projects);
});
it("does not render or request when disabled or unauthenticated, and stays idle until opened", async () => {
  mocks.enabled = false;
  const { rerender } = render(<ProjectMemberChatLauncher />);
  expect(screen.queryByTestId("global-member-chat-open")).toBeNull(); expect(mocks.request).not.toHaveBeenCalled();
  mocks.enabled = true; mocks.session.status = "anonymous";
  rerender(<ProjectMemberChatLauncher />);
  expect(screen.queryByTestId("global-member-chat-open")).toBeNull(); expect(mocks.request).not.toHaveBeenCalled();
  mocks.session.status = "authenticated"; rerender(<ProjectMemberChatLauncher />);
  expect(screen.getByTestId("global-member-chat-open")).toBeVisible();
  expect(mocks.request).not.toHaveBeenCalled();
});
it("preserves the active project and unsent draft across route changes and close/reopen, pausing its child", async () => {
  const { rerender } = render(<ProjectMemberChatLauncher />);
  fireEvent.click(screen.getByTestId("global-member-chat-open"));
  await screen.findByRole("option", { name: "小组 a" });
  const input = screen.getByLabelText("unsent member draft");
  fireEvent.change(input, { target: { value: "不要丢掉这段尚未发送的讨论" } });
  mocks.pathname = "/studio/board/board-1"; mocks.query = "projectId=group-b";
  rerender(<ProjectMemberChatLauncher />);
  expect(screen.getByTestId("live-member-component")).toHaveAttribute("data-project", "group-a");
  expect(input).toHaveValue("不要丢掉这段尚未发送的讨论");
  fireEvent.click(screen.getByTestId("global-member-chat-close"));
  expect(screen.getByTestId("live-member-component")).toHaveAttribute("data-active", "false");
  expect(screen.getByTestId("global-member-chat-panel")).not.toBeVisible();
  fireEvent.click(screen.getByTestId("global-member-chat-open"));
  expect(screen.getByLabelText("unsent member draft")).toHaveValue("不要丢掉这段尚未发送的讨论");
  expect(screen.getByTestId("live-member-component")).toHaveAttribute("data-active", "true");
  fireEvent.click(screen.getByTestId("global-member-chat-current-project"));
  expect(screen.getByTestId("live-member-component")).toHaveAttribute("data-project", "group-b");
});
it("clears old actor UI immediately and ignores a late project list from the previous actor", async () => {
  let resolve!: (value: unknown) => void;
  mocks.request.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const { rerender } = render(<ProjectMemberChatLauncher />);
  fireEvent.click(screen.getByTestId("global-member-chat-open"));
  mocks.session = { status: "authenticated", session: { currentOrgId: "other-org", userId: "other-student", sessionToken: "other-token" } };
  mocks.pathname = "/home"; mocks.query = ""; rerender(<ProjectMemberChatLauncher />);
  expect(screen.getByTestId("global-member-chat-panel")).not.toBeVisible();
  resolve(projects);
  await waitFor(() => expect(screen.queryByRole("option", { name: "小组 a" })).toBeNull());
  expect(screen.queryByTestId("live-member-component")).toBeNull();
});
it("keeps project-list failure distinct from an empty list and restores trigger focus on Escape", async () => {
  mocks.request.mockRejectedValueOnce(new Error("offline"));
  render(<ProjectMemberChatLauncher />);
  fireEvent.click(screen.getByTestId("global-member-chat-open"));
  expect(await screen.findByRole("alert")).toHaveTextContent("项目列表读取失败");
  expect(screen.queryByText("当前没有可访问的项目，请先创建或加入小组。")).toBeNull();
  fireEvent.click(screen.getByTestId("global-member-chat-project-retry"));
  await screen.findByRole("option", { name: "小组 a" });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByTestId("global-member-chat-open")).toHaveFocus();
  expect(screen.getByTestId("global-member-chat-panel")).not.toBeVisible();
});

it("keeps a nonmodal discussion open when Escape belongs to another page control",async()=>{render(<><input aria-label="页面其它工具"/><ProjectMemberChatLauncher/></>);fireEvent.click(screen.getByTestId("global-member-chat-open"));await screen.findByRole("option",{name:"小组 a"});const outside=screen.getByLabelText("页面其它工具");outside.focus();fireEvent.keyDown(outside,{key:"Escape"});expect(screen.getByTestId("global-member-chat-panel")).toBeVisible();expect(outside).toHaveFocus();});
it("does not close on Safari IME Escape with keyCode229 and isComposing false",async()=>{render(<ProjectMemberChatLauncher/>);fireEvent.click(screen.getByTestId("global-member-chat-open"));await screen.findByRole("option",{name:"小组 a"});const inside=screen.getByTestId("global-member-chat-project");inside.focus();fireEvent.keyDown(inside,{key:"Escape",keyCode:229,isComposing:false});expect(screen.getByTestId("global-member-chat-panel")).toBeVisible();fireEvent.keyDown(inside,{key:"Escape",keyCode:27,isComposing:false});expect(screen.getByTestId("global-member-chat-panel")).not.toBeVisible();expect(screen.getByTestId("global-member-chat-open")).toHaveFocus();});
