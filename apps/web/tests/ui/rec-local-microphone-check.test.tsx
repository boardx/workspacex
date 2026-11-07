import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeTranscriptionWorkspace } from "@/components/rec/realtime-transcription-workspace";
import { startCapture, TARGET_SAMPLE_RATE, type CaptureHandle } from "@/lib/live-recording";
import { useLocalMicrophoneCheck, pcmCheckWav } from "@/components/rec/use-local-microphone-check";
vi.mock("@/lib/live-recording", () => ({ startCapture: vi.fn(), TARGET_SAMPLE_RATE: 16000 }));
let frame: (pcm: Int16Array) => void;
let handle: CaptureHandle;
beforeEach(() => {
  vi.useRealTimers();
  handle = { sourceSampleRate: 48000, onFrame: (cb) => { frame = cb; }, stop: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(startCapture).mockReset().mockResolvedValue(handle);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:local-check"), revokeObjectURL: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("local microphone check", () => {
  it("never captures on mount; explicitly captures the selected device, uses real PCM level, and releases before playback", async () => {
    const { result, unmount } = renderHook(() => useLocalMicrophoneCheck("usb-mic"));
    expect(startCapture).not.toHaveBeenCalled();
    await act(async () => { await result.current.start(); });
    expect(startCapture).toHaveBeenCalledWith({ deviceId: "usb-mic" });
    act(() => frame(new Int16Array([16000, -16000])));
    expect(result.current.level).toBeGreaterThan(0.5);
    await act(async () => { await result.current.finish(); });
    expect(handle.stop).toHaveBeenCalledOnce();
    expect(result.current.previewUrl).toBe("blob:local-check");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-check");
  });
  it.each(["device", "unmount", "cancel"])("stops late permission handles after %s and ignores late frames", async (action) => {
    let grant!: (value: CaptureHandle) => void;
    vi.mocked(startCapture).mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    const { result, rerender, unmount } = renderHook(({ device }) => useLocalMicrophoneCheck(device), { initialProps: { device: "first" } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.start(); });
    if (action === "device") rerender({ device: "second" });
    if (action === "unmount") unmount();
    if (action === "cancel") await act(async () => { await result.current.clear(); });
    await act(async () => { grant(handle); await pending; });
    expect(handle.stop).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("caps PCM at 8 seconds and ignores subsequent frames", async () => {
    const { result, unmount } = renderHook(() => useLocalMicrophoneCheck(null));
    await act(async () => { await result.current.start(); });
    await act(async () => { frame(new Int16Array(TARGET_SAMPLE_RATE * 12).fill(6000)); });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(handle.stop).toHaveBeenCalledOnce();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(blob.size).toBe(44 + TARGET_SAMPLE_RATE * 8 * 2);
    act(() => frame(new Int16Array(100)));
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    unmount();
  });
  it("stops at the wall-clock deadline even if the device emits no frames", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useLocalMicrophoneCheck(null));
    await act(async () => { await result.current.start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(handle.stop).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("empty");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    unmount();
  });
  it("clears old previews on retry/device changes and exposes permission failure", async () => {
    const { result, rerender, unmount } = renderHook(({ device }) => useLocalMicrophoneCheck(device), { initialProps: { device: "a" } });
    await act(async () => { await result.current.start(); frame(new Int16Array([1])); await result.current.finish(); });
    rerender({ device: "b" });
    expect(result.current.previewUrl).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-check");
    vi.mocked(startCapture).mockRejectedValue({ kind: "permission-denied" });
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("permission-denied");
    unmount();
  });
  it("writes mono PCM16 WAV with the target sample rate", async () => {
    const wav = pcmCheckWav([new Int16Array([32767, -32768])], 2);
    const bytes = await new Promise<ArrayBuffer>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(wav); });
    const data = new DataView(bytes);
    expect(String.fromCharCode(...new Uint8Array(bytes, 0, 4))).toBe("RIFF");
    expect(data.getUint32(24, true)).toBe(TARGET_SAMPLE_RATE);
    expect(data.getUint16(22, true)).toBe(1);
    expect(data.getInt16(44, true)).toBe(32767);
    expect(data.getInt16(46, true)).toBe(-32768);
  });
});


it("shows full input labels and keeps local check separate from formal transcription", async () => {
  const onStart = vi.fn();
  render(<RealtimeTranscriptionWorkspace session={{sessionId: "local", name: "本地检查", tags: [], status: "idle", durationMs: 0, createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z", content: ""}} onBack={vi.fn()} onStart={onStart} onStop={vi.fn()}
    selectedDeviceId="usb" devices={[{deviceId:"usb",label:"USB Microphone Full Device Name"}]} />);
  expect(screen.getByTestId("rec-input-device-name")).toHaveTextContent("USB Microphone Full Device Name");
  fireEvent.click(screen.getByRole("button", {name:"检查麦克风"}));
  expect(startCapture).not.toHaveBeenCalled();
  expect(screen.getByTestId("rec-live-toggle")).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole("button", {name:"开始本地检查"})); });
  expect(startCapture).toHaveBeenCalledWith({deviceId:"usb"});
  expect(onStart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"关闭检查并清除"}));
  expect(handle.stop).toHaveBeenCalledOnce();
  expect(screen.getByTestId("rec-live-toggle")).toBeEnabled();
  fireEvent.click(screen.getByTestId("rec-live-toggle"));
  expect(onStart).toHaveBeenCalledOnce();
});
it("does not invent the system default device identity", () => {
  render(<RealtimeTranscriptionWorkspace session={{sessionId: "local", name: "检查", tags: [], status: "idle", durationMs: 0, createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z", content: ""}} onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} />);
  expect(screen.getByTestId("rec-input-device-name")).toHaveTextContent("实际设备名称尚未确认");
});
