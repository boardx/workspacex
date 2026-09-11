import { recording as C } from "@repo/contracts";
import { apiUrl, getStoredSessionToken } from "./api-client";

/** Explicit file submission only: this does not start capture or retain live PCM audio. */
export async function materializeRecordingFiles(input: {
  sessionId: string; idempotencyKey: string; audio?: Blob; notesMarkdown?: string;
}, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (input.audio) C.operations.materializeRecordingFiles.in.shape.audio.unwrap().shape.sizeBytes.parse(input.audio.size);
  const audio = input.audio ? { contentType: "audio/webm" as const, sizeBytes: input.audio.size,
    sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await input.audio.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("") } : undefined;
  const request = C.operations.materializeRecordingFiles.in.parse({ sessionId: input.sessionId,
    idempotencyKey: input.idempotencyKey, audio, notesMarkdown: input.notesMarkdown });
  const token = getStoredSessionToken();
  if (!token) throw new Error("需要先登录");
  const form = new FormData(); form.append("request", JSON.stringify(request));
  if (input.audio) form.append("audio", new Blob([input.audio], { type: "audio/webm" }), "recording.webm");
  signal?.throwIfAborted();
  const response = await fetch(apiUrl(C.operations.materializeRecordingFiles.path.replace(":sessionId", encodeURIComponent(input.sessionId))), {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, signal, redirect: "error",
  });
  if (!response.ok) throw new Error(`录音文件保存失败（HTTP ${response.status}）`);
  return C.operations.materializeRecordingFiles.out.parse(await response.json());
}
