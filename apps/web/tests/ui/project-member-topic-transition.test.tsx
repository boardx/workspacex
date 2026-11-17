import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MemberChatPage, MemberChatPost, MemberChatReplies, ProjectMemberMessage } from "@/lib/live-project-member-chat";

const mocks = vi.hoisted(() => ({ list: vi.fn(), replies: vi.fn(), post: vi.fn(), names: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ status: "authenticated", session: { currentOrgId: "org", userId: "alice", sessionToken: "token" } }) }));
vi.mock("@/lib/project-member-chat-config", () => ({ isProjectMemberChatEnabled: () => true }));
vi.mock("@/lib/live-project-member-chat", () => ({ listProjectMemberMessages: mocks.list, listProjectMemberReplies: mocks.replies, postProjectMemberMessage: mocks.post, listProjectMemberNames: mocks.names }));
import { ProjectMemberChat } from "@/components/project/project-member-chat";

const rootId = "10000000-0000-4000-8000-000000000001";
const root: ProjectMemberMessage = { id: rootId, projectId: "p", sequence: 1, authorId: "bob", clientMessageId: "20000000-0000-4000-8000-000000000001", text: "已缓存的真实话题根", threadRootId: null, stageReference: null, createdAt: "2026-11-16T02:00:00.000Z" };
const page: MemberChatPage = { items: [root], nextBeforeSequence: null, nextAfterSequence: 1, latestSequence: 1, canWrite: true, readOnlyReason: null, threadUpdates: [] };
function visibility(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  fireEvent(document, new Event("visibilitychange"));
}
beforeEach(() => {
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  mocks.list.mockReset().mockResolvedValue(page);
  mocks.names.mockReset().mockResolvedValue(new Map());
  mocks.replies.mockReset();
  mocks.post.mockReset().mockImplementation(async (input: MemberChatPost) => ({ replayed: false, message: { ...root, id: "10000000-0000-4000-8000-000000000002", sequence: 2, authorId: "alice", clientMessageId: input.clientMessageId, text: input.text, threadRootId: input.threadRootId ?? null } }));
});
afterEach(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); });

it("commits a disabled pending topic instead of an editable channel composer while hidden, then preserves both destinations", async () => {
  let resolveTopic!: (value: MemberChatReplies) => void;
  const topicResponse = new Promise<MemberChatReplies>(resolve => { resolveTopic = resolve; });
  mocks.replies.mockReturnValue(topicResponse);
  render(<ProjectMemberChat projectId="p" />);
  const channel = screen.getByRole("textbox", { name: /^发给项目成员$/ });
  await waitFor(() => expect(channel).toBeEnabled());
  fireEvent.change(channel, { target: { value: "频道自己的未发送草稿" } });

  // A cached root can be selected before the hidden page is foregrounded. Its
  // topic read is deliberately paused by the real visibility listener/guard,
  // so this is an actual committed UI state, not a mocked React effect/render.
  visibility(true);
  fireEvent.click(screen.getByTestId(`project-member-topic-${rootId}`));
  expect(mocks.replies).not.toHaveBeenCalled();
  expect(screen.getByTestId("project-member-input")).toBeDisabled();
  expect(screen.getByTestId("project-member-input")).toHaveValue("");
  expect(screen.getByTestId("project-member-readonly")).toHaveTextContent("正在读取话题");
  expect(screen.getByTestId("project-member-topic-close")).toBeVisible();
  fireEvent.keyDown(screen.getByTestId("project-member-input"), { key: "Enter" });
  expect(mocks.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("project-member-topic-close"));
  expect(screen.getByRole("textbox", { name: /^发给项目成员$/ })).toHaveValue("频道自己的未发送草稿");

  visibility(false);
  fireEvent.click(screen.getByTestId(`project-member-topic-${rootId}`));
  await waitFor(() => expect(mocks.replies).toHaveBeenCalledTimes(1));
  const reply = screen.getByRole("textbox", { name: /^回复此话题$/ });
  expect(reply).toBeDisabled();
  const { threadUpdates: _updates, ...base } = page;
  await act(async () => resolveTopic({ ...base, items: [], root }));
  await waitFor(() => expect(reply).toBeEnabled());
  expect(reply).toHaveValue("");
  fireEvent.change(reply, { target: { value: "只属于当前话题的回复" } });
  fireEvent.click(screen.getByTestId("project-member-send"));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  expect(mocks.post.mock.calls[0]?.[0]).toMatchObject({ projectId: "p", text: "只属于当前话题的回复", threadRootId: rootId });
  fireEvent.click(screen.getByTestId("project-member-topic-close"));
  expect(screen.getByRole("textbox", { name: /^发给项目成员$/ })).toHaveValue("频道自己的未发送草稿");
});
