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

it("keeps successful batch tiles and retries only failed frozen requests", async () => {
  const files = [file, new File(["two"], "two.png", { type: "image/png" }), new File(["three"], "three.png", { type: "image/png" })];
  inspect.file.mockImplementation(async source => ({ ...verified, blob: source }));
  const commit = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("IMAGE_ASSET_UNAVAILABLE")).mockResolvedValueOnce(true).mockResolvedValue(true), onSuccess = vi.fn();
  const { result } = renderHook(() => useBoardImageUpload({ scope: "board", blocked: false, commit, onSuccess }));
  const requests = files.map((source, index) => ({ source, point: { x: 32 + index * 24, y: 80 + index * 24 } }));
  await act(() => result.current.uploadBatch(requests));
  expect(result.current.items.map(item => item.status)).toEqual(["succeeded", "failed", "succeeded"]);
  expect(onSuccess).not.toHaveBeenCalled();
  requests[1]!.point.x = 999;
  act(() => result.current.retry());
  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  expect(commit.mock.calls.map(call => call[1])).toEqual(["photo.png", "two.png", "three.png", "two.png"]);
  expect(commit.mock.calls[3]?.[2].point).toEqual({ x: 56, y: 104 });
  expect(result.current.items.every(item => item.status === "succeeded")).toBe(true);
});

it("rejects duplicate batch starts and repeated File entries while preserving distinct same-name files", async () => {
  const pending = deferred<typeof verified>(); inspect.file.mockReturnValueOnce(pending.promise).mockResolvedValue(verified);
  const commit = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() => useBoardImageUpload({ scope: "board", blocked: false, commit, onSuccess: vi.fn() }));
  const sameName = new File(["different"], file.name, { type: "image/png" });
  let running!: Promise<void>; act(() => { running = result.current.uploadBatch([request, request, { ...request, source: sameName }]); });
  await act(() => result.current.uploadBatch([request]));
  expect(inspect.file).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(verified); await running; });
  expect(commit).toHaveBeenCalledTimes(2);
});

it.each(["cancel", "unmount", "revoke", "scope"])("preserves a completed tile and stops all remaining batch commits after %s", async mode => {
  const pending = deferred<typeof verified>(); inspect.file.mockResolvedValueOnce(verified).mockReturnValueOnce(pending.promise).mockResolvedValue(verified);
  const commit = vi.fn().mockResolvedValue(true), onSuccess = vi.fn();
  const { result, unmount, rerender } = renderHook(({ blocked, scope }) => useBoardImageUpload({ scope, blocked, commit, onSuccess }), { initialProps: { blocked: false, scope: "board" } });
  const requests = [request, { ...request, source: new File(["second"], "second.png", { type: "image/png" }) }, { ...request, source: new File(["third"], "third.png", { type: "image/png" }) }];
  let running!: Promise<void>; act(() => { running = result.current.uploadBatch(requests); });
  await waitFor(() => expect(inspect.file).toHaveBeenCalledTimes(2));
  if (mode === "cancel") act(() => result.current.cancel());
  if (mode === "unmount") unmount();
  if (mode === "revoke") rerender({ blocked: true, scope: "board" });
  if (mode === "scope") rerender({ blocked: false, scope: "other-board" });
  expect((inspect.file.mock.calls[1]?.[3] as AbortSignal).aborted).toBe(true);
  await act(async () => { pending.resolve(verified); await running; });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(inspect.file).toHaveBeenCalledTimes(2);
  expect(onSuccess).not.toHaveBeenCalled();
});

it("keeps replacement batches single-file and retains the original target snapshot", async () => {
  inspect.file.mockResolvedValue(verified);
  const commit = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() => useBoardImageUpload({ scope: "board", blocked: false, commit, onSuccess: vi.fn() }));
  await act(() => result.current.uploadBatch([{ ...request, targetId: "original", targetState: "frozen" }, { ...request, source: new File(["other"], "other.png", { type: "image/png" }), targetId: "original" }]));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0]?.[2]).toEqual({ ...request, targetId: "original", targetState: "frozen" });
});

it("dialog accepts a full picker/drop batch, lists per-image failures, and limits replacement drops", () => {
  const second = new File(["two"], "two.png", { type: "image/png" }), onFiles = vi.fn(), onFile = vi.fn();
  const props = { open: true, replacing: false, busy: false, error: "one failed", onFiles, onFile, onClose: vi.fn(), onRetry: vi.fn(), onUrl: vi.fn(), items: [{ id: 1, name: file.name, status: "succeeded" as const, error: null }, { id: 2, name: second.name, status: "failed" as const, error: "网络错误" }] };
  const { rerender } = render(<BoardImageUploadDialog {...props} />);
  expect((screen.getByTestId("board-image-input") as HTMLInputElement).multiple).toBe(true);
  fireEvent.change(screen.getByTestId("board-image-input"), { target: { files: [file, second] } });
  fireEvent.drop(screen.getByTestId("board-image-dropzone"), { dataTransfer: { files: [file, second] } });
  expect(onFiles.mock.calls).toEqual([[[file, second]], [[file, second]]]);
  expect(screen.getByText("网络错误")).toBeTruthy();
  fireEvent.click(screen.getByText("仅重试失败图片")); expect(props.onRetry).toHaveBeenCalledOnce();
  rerender(<BoardImageUploadDialog {...props} replacing />);
  expect((screen.getByTestId("board-image-input") as HTMLInputElement).multiple).toBe(false);
  fireEvent.drop(screen.getByTestId("board-image-dropzone"), { dataTransfer: { files: [file, second] } });
  expect(onFile).toHaveBeenCalledOnce();
  expect(onFile).toHaveBeenCalledWith(file);
  expect(onFiles).toHaveBeenCalledTimes(2);
});


it("stops the queue on server access denial before a stale UI role can send further images", async () => {
  inspect.file.mockResolvedValue(verified);
  const commit = vi.fn().mockRejectedValue(new Error("IMAGE_ACCESS_DENIED"));
  const { result } = renderHook(() => useBoardImageUpload({ scope: "board", blocked: false, commit, onSuccess: vi.fn() }));
  await act(() => result.current.uploadBatch([request, { ...request, source: new File(["other"], "other.png", { type: "image/png" }) }]));
  expect(inspect.file).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(result.current.items.map(item => item.status)).toEqual(["failed", "cancelled"]);
  expect(result.current.error).toContain("访问权限");
});
