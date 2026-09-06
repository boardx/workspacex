import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useComposerDraft } from "@/lib/chat-workbench/use-composer-draft";
import { useRunningReply } from "@/lib/chat-workbench/use-running-reply";
import type { AbstractAgent } from "@ag-ui/client";
const { interject } = vi.hoisted(() => ({ interject: vi.fn() }));
vi.mock("@/lib/agent-kernel-interject", async (original) => ({ ...await original<typeof import("@/lib/agent-kernel-interject")>(), interjectAgentRun: interject }));
const scope = { orgId: "org", userId: "user", projectId: "project", threadId: "a" as string | null };
beforeEach(() => { sessionStorage.clear(); interject.mockReset(); });
it("restores A after B and isolates user/org/project drafts, including remount", () => {
  const hook = renderHook((props) => useComposerDraft(props), { initialProps: scope });
  act(() => hook.result.current.setText("draft A"));
  hook.rerender({ ...scope, threadId: "b" });
  expect(hook.result.current.text).toBe("");
  act(() => hook.result.current.setText("draft B"));
  hook.rerender(scope); expect(hook.result.current.text).toBe("draft A");
  for (const extra of [{ userId: "other" }, { orgId: "other" }, { projectId: "other" }]) {
    hook.rerender({ ...scope, ...extra }); expect(hook.result.current.text).toBe("");
  }
  hook.unmount();
  const restored = renderHook(() => useComposerDraft(scope));
  expect(restored.result.current.text).toBe("draft A");
});
it("moves a new-thread draft to its accepted thread without leaving a duplicate", () => {
  const hook = renderHook((props) => useComposerDraft(props), { initialProps: { ...scope, threadId: null } as typeof scope });
  act(() => hook.result.current.setText("new draft"));
  hook.rerender(scope); expect(hook.result.current.text).toBe("new draft");
  hook.rerender({ ...scope, threadId: null }); expect(hook.result.current.text).toBe("");
});
it("preserves edits made while an interjection awaits acknowledgement, including same-text edits", async () => {
  let resolve!: (value: { interjectionId: string }) => void;
  interject.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const hook = renderHook(() => {
    const draft = useComposerDraft(scope);
    const reply = useRunningReply({ agent: { addMessage: vi.fn() } as unknown as AbstractAgent, threadId: "a", run: { runId: "run", status: "running" }, inputDraft: draft.text, inputDraftRevision: draft.revision, clearDraft: draft.clear, enqueue: vi.fn(), sessionToken: null, setError: vi.fn() });
    return { draft, reply };
  });
  act(() => hook.result.current.draft.setText("A"));
  let sending!: Promise<void>;
  act(() => { sending = hook.result.current.reply.sendWhileRunning(); });
  act(() => hook.result.current.draft.setText("B"));
  await act(async () => { resolve({ interjectionId: "id" }); await sending; });
  expect(hook.result.current.draft.text).toBe("B");
  act(() => { sending = hook.result.current.reply.sendWhileRunning(); });
  act(() => hook.result.current.draft.setText("B"));
  await act(async () => { resolve({ interjectionId: "id2" }); await sending; });
  expect(hook.result.current.draft.text).toBe("B");
  act(() => { sending = hook.result.current.reply.sendWhileRunning(); });
  await act(async () => { resolve({ interjectionId: "id3" }); await sending; });
  await waitFor(() => expect(hook.result.current.draft.text).toBe(""));
});
it("does not let an old task's late ACK erase a remounted draft", async () => {
  let resolve!: (value: { interjectionId: string }) => void;
  interject.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const first = renderHook(() => {
    const draft = useComposerDraft(scope);
    const reply = useRunningReply({ agent: { addMessage: vi.fn() } as unknown as AbstractAgent, threadId: "a", run: { runId: "run", status: "running" }, inputDraft: draft.text, inputDraftRevision: draft.revision, clearDraft: draft.clear, enqueue: vi.fn(), sessionToken: null, setError: vi.fn() });
    return { draft, reply };
  });
  act(() => first.result.current.draft.setText("submitted"));
  let sending!: Promise<void>;
  act(() => { sending = first.result.current.reply.sendWhileRunning(); });
  first.unmount();
  const remounted = renderHook(() => useComposerDraft(scope));
  act(() => remounted.result.current.setText("new edit after returning"));
  await act(async () => { resolve({ interjectionId: "late" }); await sending; });
  remounted.unmount();
  const restored = renderHook(() => useComposerDraft(scope));
  expect(restored.result.current.text).toBe("new edit after returning");
});
