# `/rec` Chat ASR Draft Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/rec` temporarily reuse `/chat/asr-draft` for realtime speech recognition while persisting only session metadata and keeping transcript text in the current page.

**Architecture:** Keep the personal transcription REST APIs for list/create/read metadata, tags, rename, and delete. Replace only the live stream adapter inside `TranscriptionHistory` with the existing `openAsrDraftStream`; final and interim text remain React state, and stopping waits for the draft stream without refreshing persisted transcript content.

**Tech Stack:** React 19 client components, TypeScript, Vitest, Testing Library, existing BoardX Chat ASR draft WebSocket client.

## Global Constraints

- No new dependency.
- Do not modify the `/chat/asr-draft` backend protocol or Chat UI.
- Do not request a personal ASR ticket or write capture, segment, usage, or transcript content.
- Continue persisting transcription name, tags, history card metadata, rename, and delete operations.
- Transcript text must be labeled as current-page-only and must disappear after refresh or navigation.

---

### Task 1: Specify the transient `/rec` stream behavior

**Files:**
- Modify: `apps/web/tests/ui/realtime-transcription-history.test.tsx`

**Interfaces:**
- Consumes: `openAsrDraftStream(handlers, { sessionToken })` from `apps/web/lib/live-asr-draft.ts`.
- Produces: UI expectations for transient partial/final text, stop completion, local editing, and no transcript persistence.

- [ ] **Step 1: Replace the personal stream mock with the Chat draft stream mock**

```ts
const api = vi.hoisted(() => ({
  openAsrDraft: vi.fn(),
  draftHandlers: null as AsrDraftStreamHandlers | null,
  stopDraft: vi.fn(),
}));

vi.mock("@/lib/live-asr-draft", () => ({
  openAsrDraftStream: api.openAsrDraft,
}));
```

- [ ] **Step 2: Add a failing test for starting, displaying, and stopping transient recognition**

```ts
it("复用 Chat 草稿流并只在当前页面拼接转录正文", async () => {
  // Open a persisted metadata card, start recording, then drive partial/final callbacks.
  expect(api.openAsrDraft).toHaveBeenCalledWith(
    expect.objectContaining({ onPartial: expect.any(Function), onFinal: expect.any(Function) }),
    { sessionToken: "session-token" },
  );
  expect(screen.getByTestId("rec-live-content")).toHaveTextContent("第一句 第二句");
  expect(screen.getByTestId("rec-live-transient-notice")).toBeVisible();
  expect(api.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Add a failing test for local-only editing**

```ts
it("停止后修改正文只更新当前页面而不调用持久化 API", async () => {
  fireEvent.click(screen.getByTestId("rec-live-edit"));
  fireEvent.change(screen.getByTestId("rec-live-editor"), { target: { value: "本地修改全文" } });
  fireEvent.click(screen.getByTestId("rec-live-save"));
  expect(screen.getByTestId("rec-live-content")).toHaveTextContent("本地修改全文");
  expect(api.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter web test --run apps/web/tests/ui/realtime-transcription-history.test.tsx
```

Expected: FAIL because `/rec` still calls `openBoardxRealtimeAsr`, refreshes the persisted detail after stop, and lacks the transient notice.

- [ ] **Step 5: Commit the failing behavioral specification**

```bash
git add apps/web/tests/ui/realtime-transcription-history.test.tsx
git commit -m "test(rec): specify transient chat ASR fallback"
```

### Task 2: Switch `/rec` to the Chat draft stream

**Files:**
- Modify: `apps/web/components/rec/transcription-history.tsx`
- Modify: `apps/web/components/rec/realtime-transcription-workspace.tsx`
- Test: `apps/web/tests/ui/realtime-transcription-history.test.tsx`

**Interfaces:**
- Consumes: `AsrDraftStreamHandle`, `AsrDraftStreamHandlers`, and `openAsrDraftStream` from `apps/web/lib/live-asr-draft.ts`.
- Produces: Current-page-only transcript state using the existing `PersonalTranscriptionDetail.content` display shape.

- [ ] **Step 1: Replace the live stream import and ref type**

```ts
import { openAsrDraftStream, type AsrDraftStreamHandle } from "@/lib/live-asr-draft";

const streamRef = React.useRef<AsrDraftStreamHandle | null>(null);
```

- [ ] **Step 2: Adapt stream callbacks to component state**

```ts
streamRef.current = await openAsrDraftStream({
  onPartial: setInterimSegment,
  onFinal: (text) => {
    setInterimSegment("");
    setActiveSession((current) => appendTransientFinal(current, text));
  },
  onError: (reason) => {
    setStreamState("error");
    setStreamError(streamErrorText(reason));
    streamRef.current = null;
  },
  onFinished: () => setStreamState("idle"),
}, { sessionToken });
setStreamState("recording");
```

- [ ] **Step 3: Stop without re-reading or persisting the transcript**

```ts
await handle.stop();
setInterimSegment("");
setStreamState("idle");
```

- [ ] **Step 4: Make content editing local-only**

```ts
async function saveContentLocally(content: string) {
  setActiveSession((current) => current ? { ...current, content } : current);
}
```

- [ ] **Step 5: Render an explicit transient-content notice**

```tsx
<p data-testid="rec-live-transient-notice" className="...">
  当前文字仅保存在本页面，刷新或离开后将消失。
</p>
```

Also change saved/persisted copy to current-page-only language.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --filter web test --run apps/web/tests/ui/realtime-transcription-history.test.tsx
```

Expected: all tests pass with no personal stream call and no transcript update call.

- [ ] **Step 7: Run related client and UI regression tests**

Run:

```bash
pnpm --filter web test --run apps/web/tests/ui/chat-live-message-panel-mic.test.tsx apps/web/tests/lib/boardx-realtime-asr-client.test.ts
pnpm --filter web typecheck
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit the implementation**

```bash
git add apps/web/components/rec/transcription-history.tsx apps/web/components/rec/realtime-transcription-workspace.tsx apps/web/tests/ui/realtime-transcription-history.test.tsx
git commit -m "fix(rec): reuse chat ASR draft stream temporarily"
```

### Task 3: Verify and publish

**Files:**
- Modify only harness evidence generated by required verification commands.

**Interfaces:**
- Consumes: issue #1241 and branch `codex/rec-chat-asr-draft-1241`.
- Produces: verified commit and a draft PR with `Closes #1241`.

- [ ] **Step 1: Run repository verification appropriate to the scoped frontend change**

```bash
pnpm --filter web test --run apps/web/tests/ui/realtime-transcription-history.test.tsx apps/web/tests/ui/chat-live-message-panel-mic.test.tsx
pnpm --filter web typecheck
```

- [ ] **Step 2: Inspect the final diff and worktree status**

```bash
git diff origin/main...HEAD --check
git status --short
```

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin codex/rec-chat-asr-draft-1241
```

Create a draft PR targeting `main` whose body contains `Closes #1241`, the transient persistence limitation, and exact verification commands.
