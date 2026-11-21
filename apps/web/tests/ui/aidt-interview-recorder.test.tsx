import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtInterviewRecorder } from "@/features/aidt/components/aidt-interview-recorder";

const mocks = vi.hoisted(() => ({ start: vi.fn(), asr: vi.fn(), upload: vi.fn(), read: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/live-recording", () => ({ TARGET_SAMPLE_RATE: 16000, startCapture: mocks.start }));
vi.mock("@/lib/live-asr-draft", () => ({ openAsrDraftStream: mocks.asr }));
vi.mock("@/features/aidt/lib/aidt-research-materials", () => ({
  readAidtResearchMaterial: mocks.read,
  uploadAidtResearchMaterial: mocks.upload,
}));

let feed: (frame: Int16Array) => void;
const source = { projectId: "group-a", runId: "run-a", artifactId: "artifact", versionId: "version", mime: "audio/wav", name: "U01.wav", sha256: "a".repeat(64), bytes: 52 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:recorded"; } static revokeObjectURL() {} });
  mocks.start.mockResolvedValue({ sourceSampleRate: 48000, onFrame: (listener: typeof feed) => { feed = listener; }, stop: mocks.stop });
  mocks.stop.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue(source);
  mocks.read.mockResolvedValue({ reference: source });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("never opens the microphone without permission and stops it when leaving the recipient", async () => {
  const onAttached = vi.fn();
  const props = { projectId: "group-a", participantCode: "U01", sessionToken: "session", asrAllowed: false, onAttached };
  const view = render(<AidtInterviewRecorder {...props} disabled />);
  fireEvent.click(screen.getByRole("button", { name: "开始录音" }));
  expect(mocks.start).not.toHaveBeenCalled();
  view.rerender(<AidtInterviewRecorder {...props} disabled={false} />);
  fireEvent.click(screen.getByRole("button", { name: "开始录音" }));
  await screen.findByText("正在录音 · U01");
  view.unmount();
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("keeps the WAV when live transcription fails and retries a stored receipt without another upload", async () => {
  mocks.asr.mockRejectedValue(new Error("supplier unavailable"));
  mocks.read.mockRejectedValueOnce(new Error("temporary read failure"));
  const onAttached = vi.fn();
  render(<AidtInterviewRecorder projectId="group-a" participantCode="U01" sessionToken="session" asrAllowed disabled={false} onAttached={onAttached} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "本次录音同时请求实时转写" }));
  fireEvent.click(screen.getByRole("button", { name: "开始录音" }));
  await screen.findByText("正在录音 · U01");
  act(() => feed(new Int16Array(16000).fill(141)));
  fireEvent.click(screen.getByRole("button", { name: "停止录音" }));
  expect(await screen.findByText(/转写服务未返回完整结果/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "保存本次录音原件" }));
  await screen.findByText(/录音保存或回读未通过/);
  expect(onAttached).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重试录音回读" }));
  await waitFor(() => expect(onAttached).toHaveBeenCalledOnce());
  expect(mocks.upload).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.upload.mock.calls[0]?.[1]).toMatchObject({ type: "audio/wav", size: 32044 });
  expect(onAttached).toHaveBeenCalledWith(expect.objectContaining({ source, durationMs: 1000, draftTranscript: "" }));
});
