import { randomUUID, createHash } from "node:crypto";
import { chat, chatFileUpload } from "@repo/contracts";
import { toOrgId } from "../src/domain/org-id";

/** Caller supplies a session already selected into orgId (from the login/bootstrap result).
 * Uses normal business HTTP routes. No direct ObjectStore access or object-key deletion.
 */
export async function verifyCloudFileRoundtrip(baseUrl: string, session: string, orgId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  toOrgId(orgId);
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || !session) throw new Error("invalid file probe configuration");
  const path = (suffix: string) => `${base.href.replace(/\/$/, "")}${suffix}`;
  const call = (suffix: string, init: RequestInit = {}, authenticated = true) => {
    signal?.throwIfAborted();
    return fetch(path(suffix), {
    ...init, redirect: "error", signal: signal ?? AbortSignal.timeout(30000),
    headers: { ...(authenticated ? { Authorization: `Bearer ${session}` } : {}), ...init.headers },
    });
  };
  const mutation = async (input: unknown) => {
    const response = await call(chat.operations.mutateThread.path, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chat.operations.mutateThread.in.parse(input)) });
    if (!response.ok) throw new Error(`file probe thread operation HTTP ${response.status}`);
    return chat.operations.mutateThread.out.parse(await response.json());
  };
  const common = { projectId: null, groupId: null, visibilityScope: "private", reason: null };
  const created = await mutation({ ...common, op: "create", threadId: null, title: `Provision probe ${randomUUID()}`, expectedVersion: null });
  let attachmentId: string | undefined;
  try {
    const bytes = Buffer.from(`Workspacex cloud file roundtrip ${randomUUID()}\n`, "utf8");
    const form = new FormData(); form.append("file", new Blob([bytes], { type: "text/plain" }), "provision-probe.txt");
    const upload = await call(`/chat/threads/${encodeURIComponent(created.threadId)}/attachments`, { method: "POST", body: form });
    if (!upload.ok) throw new Error(`file probe upload HTTP ${upload.status}`);
    const attachment = chatFileUpload.operations.uploadAttachment.out.parse(await upload.json()); attachmentId = attachment.id;
    if (attachment.bytes !== bytes.byteLength) throw new Error("file probe size mismatch");
    const contentPath = `/chat/threads/${encodeURIComponent(created.threadId)}/attachments/${encodeURIComponent(attachment.id)}/content`;
    const anonymous = await call(contentPath, {}, false);
    await anonymous.arrayBuffer();
    if (anonymous.status !== 401 && anonymous.status !== 403) throw new Error("file probe anonymous access accepted");
    const downloaded = await call(contentPath);
    if (!downloaded.ok) throw new Error(`file probe download HTTP ${downloaded.status}`);
    const actual = Buffer.from(await downloaded.arrayBuffer());
    if (!actual.equals(bytes)) throw new Error("file probe roundtrip mismatch");
    return { fileRoundtripVerified: true, requestedOrgId: orgId, threadId: created.threadId, attachmentId,
      sha256: createHash("sha256").update(actual).digest("hex"), sizeBytes: actual.length,
      cleanup: "thread-logically-deleted; object-retained-under-policy", ossProviderVerified: false };
  } finally {
    // Only the thread minted above is touched. Compliance retention owns physical bytes.
    // Cleanup shares the provision deadline; never initiate I/O after it expires.
    if (signal?.aborted) throw new Error(`file probe deadline; retained thread ${created.threadId}`);
    await mutation({ ...common, op: "delete", threadId: created.threadId, title: null,
      expectedVersion: created.version, reason: "Provision file probe finished" });
  }
}
