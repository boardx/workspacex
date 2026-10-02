import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBoardImageUpload } from "@/components/whiteboard/use-board-image-upload";
import { BoardImageUploadDialog } from "@/components/whiteboard/board-image-upload-dialog";

const inspect = vi.hoisted(() => ({ file: vi.fn(), url: vi.fn() }));
vi.mock("@/components/whiteboard/board-content-adapter", () => ({ verifyBoardImageBytes: inspect.file, inspectRemoteImageUrl: inspect.url }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const file = new File(["bytes"], "photo.png", { type: "image/png" });
const verified = { blob: file, url: "https://example.com/photo.png" };
const request = { source: file, point: { x: 32, y: 80 } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

it("uses the same commit for picker/drop/paste files and URL with exact frozen position and target", async () => {
  inspect.file.mockResolvedValue(verified); inspect.url.mockResolvedValue(verified);
  const commit = vi.fn().mockResolvedValue(true), onSuccess = vi.fn();
  const { result } = renderHook(() => useBoardImageUpload({ scope: "board", blocked: false, commit, onSuccess }));
  await act(() => result.current.upload({ ...request, targetId: "original" }));
  expect(commit).toHaveBeenLastCalledWith(verified, "photo.png", { ...request, targetId: "original" }, expect.any(AbortSignal));
  await act(() => result.current.upload({ ...request, source: verified.url }));
  expect(inspect.url).toHaveBeenCalledWith(verified.url, expect.any(Function), expect.any(AbortSignal));
  expect(commit).toHaveBeenCalledTimes(2); expect(onSuccess).toHaveBeenCalledTimes(2);
});

it("retains the exact replacement request for retry and never commits failed verification", async () => {
  inspect.file.mockRejectedValueOnce(new Error("IMAGE_TOO_LARGE")).mockResolvedValue(verified);
  const commit = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() => useBoardImageUpload({ scope: "board", blocked: false, commit, onSuccess: vi.fn() }));
  await act(() => result.current.upload({ ...request, targetId: "old-id" }));
  expect(commit).not.toHaveBeenCalled(); expect(result.current.error).toContain("25MB");
  act(() => result.current.retry());
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  expect(commit.mock.calls[0]?.[2]).toEqual({ ...request, targetId: "old-id" });
});

it.each(["cancel", "unmount", "revoke"])("prevents late creation after %s even if verification ignores abort", async mode => {
  const pending = deferred<typeof verified>(); inspect.file.mockReturnValue(pending.promise);
  const commit = vi.fn().mockResolvedValue(true);
  const { result, unmount, rerender } = renderHook(({ blocked }) => useBoardImageUpload({ scope: "board", blocked, commit, onSuccess: vi.fn() }), { initialProps: { blocked: false } });
  let running!: Promise<void>; act(() => { running = result.current.upload(request); });
  const signal = inspect.file.mock.calls[0]?.[3] as AbortSignal;
  if (mode === "cancel") act(() => result.current.cancel());
  if (mode === "unmount") unmount();
  if (mode === "revoke") rerender({ blocked: true });
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(verified); await running; });
  expect(commit).not.toHaveBeenCalled();
});

it("rejects overlapping requests and shows commit failure as retryable rather than success", async () => {
  inspect.file.mockResolvedValue(verified); const pending = deferred<boolean>();
  const commit = vi.fn().mockReturnValue(pending.promise), onSuccess = vi.fn();
  const { result } = renderHook(() => useBoardImageUpload({ scope: "board", blocked: false, commit, onSuccess }));
  let running!: Promise<void>; act(() => { running = result.current.upload(request); });
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  await act(() => result.current.upload({ ...request, source: "https://example.com/other.png" }));
  expect(inspect.url).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(false); await running; });
  expect(onSuccess).not.toHaveBeenCalled(); expect(result.current.error).not.toBeNull();
});

it.each(["board", "document", "user"])("invalidates a delayed verification on %s scope change without committing into the new scope", async identity => {
  const pending = deferred<typeof verified>(); inspect.file.mockReturnValue(pending.promise);
  const oldCommit = vi.fn().mockResolvedValue(true), newCommit = vi.fn().mockResolvedValue(true);
  const oldScope = { identity: "old" }, newScope = { identity };
  const { result, rerender } = renderHook(({ scope, commit }) => useBoardImageUpload({ scope, commit, blocked: false, onSuccess: vi.fn() }), { initialProps: { scope: oldScope, commit: oldCommit } });
  let running!: Promise<void>; act(() => { running = result.current.upload(request); });
  rerender({ scope: newScope, commit: newCommit });
  expect((inspect.file.mock.calls[0]?.[3] as AbortSignal).aborted).toBe(true);
  await act(async () => { pending.resolve(verified); await running; });
  expect(oldCommit).not.toHaveBeenCalled(); expect(newCommit).not.toHaveBeenCalled();
  act(() => result.current.retry()); expect(newCommit).not.toHaveBeenCalled();
});

it("dialog picker/drop and retry are real controls, busy blocks duplicates but close can cancel", () => {
  const onFile = vi.fn(), onClose = vi.fn(), onRetry = vi.fn();
  const props = { open: true, replacing: false, busy: false, error: "network", onFile, onClose, onRetry, onUrl: vi.fn() };
  const { rerender } = render(<BoardImageUploadDialog {...props} />);
  fireEvent.change(screen.getByTestId("board-image-input"), { target: { files: [file] } });
  fireEvent.drop(screen.getByTestId("board-image-dropzone"), { dataTransfer: { files: [file] } });
  expect(onFile).toHaveBeenCalledTimes(2); fireEvent.click(screen.getByText("重试")); expect(onRetry).toHaveBeenCalledTimes(1);
  rerender(<BoardImageUploadDialog {...props} busy />);
  fireEvent.drop(screen.getByTestId("board-image-dropzone"), { dataTransfer: { files: [file] } });
  expect(onFile).toHaveBeenCalledTimes(2); fireEvent.click(screen.getByTestId("board-image-close")); expect(onClose).toHaveBeenCalledTimes(1);
});
