import type { z } from "zod";
import type { ImageAttachment } from "@repo/contracts/aidt-stages";
import { chatFileUpload } from "@repo/contracts";
import { getThread, listThreadAttachments, listThreads, type ChatAttachment } from "@/lib/live-chat";
import { apiUrl } from "@/lib/api-client";
import { isAidtModuleEnabled } from "./aidt-module-config";

export type AidtImageAttachmentReference = Readonly<z.infer<typeof ImageAttachment>>;
export type AidtImageAttachmentOption = AidtImageAttachmentReference & Pick<ChatAttachment, "mime" | "bytes" | "createdAt"> & Readonly<{ messageId: string }>;
const validIdentifier = (id: string) => !!id.trim() && id !== "." && id !== ".." && !/[\u0000-\u001f\u007f]/.test(id);
const imageMimes: ReadonlySet<string> = new Set(chatFileUpload.ATTACHMENT_MIME_ALLOWLIST.filter((mime) => mime.startsWith("image/")));

/** Native authorized project list; choosing a card still rechecks full thread scope. */
export async function loadAidtProjectImageThreads(projectId: string, sessionToken: string, signal?: AbortSignal) {
  if (!isAidtModuleEnabled() || signal?.aborted || !projectId || !sessionToken) throw new Error("AIDT_CONTEXT_CHANGED");
  const result = await listThreads(projectId, { filter: "project" }, sessionToken, signal);
  if (signal?.aborted || !isAidtModuleEnabled()) throw new Error("AIDT_CONTEXT_CHANGED");
  const seen = new Set<string>();
  return result.groups.flatMap(group => group.cards).filter(card => {
    if (!validIdentifier(card.id) || card.visibilityScope !== "plenary" || seen.has(card.id)) return false;
    seen.add(card.id); return true;
  }).map(card => ({ id: card.id, title: card.title }));
}

/** Fixed authenticated API route; no caller-supplied remote URL or embedded image bytes. */
export function aidtImageAttachmentContentUrl(reference: AidtImageAttachmentReference): string {
  if (![reference.threadId, reference.attachmentId].every(validIdentifier)) throw new Error("AIDT_IMAGE_UNAVAILABLE");
  return apiUrl(`/chat/threads/${encodeURIComponent(reference.threadId)}/attachments/${encodeURIComponent(reference.attachmentId)}/content`);
}

/** Read existing sent materials only; never uploads or invokes an agent. Server repeats validation on save. */
export async function loadAidtImageAttachments({ projectId, threadId, sessionToken, signal }: {
  projectId: string; threadId: string; sessionToken: string; signal?: AbortSignal;
}): Promise<readonly AidtImageAttachmentOption[]> {
  const assertCurrent = () => { if (!isAidtModuleEnabled() || signal?.aborted) throw new Error("AIDT_CONTEXT_CHANGED"); };
  assertCurrent();
  if (!projectId || !validIdentifier(threadId) || !sessionToken) throw new Error("AIDT_IMAGE_UNAVAILABLE");
  const detail = await getThread(threadId, projectId, sessionToken); assertCurrent();
  if (detail.thread.id !== threadId || detail.thread.projectId !== projectId || detail.thread.visibilityScope !== "plenary" || detail.thread.groupId !== null) throw new Error("AIDT_IMAGE_UNAVAILABLE");
  const messageIds = new Set(detail.messages.map((message) => message.id));
  const listed = chatFileUpload.operations.listThreadAttachments.out.parse(await listThreadAttachments(threadId, projectId, sessionToken)); assertCurrent();
  const seen = new Set<string>();
  return listed.items.filter((item) => {
    if (!validIdentifier(item.id) || !item.messageId || !messageIds.has(item.messageId) || !imageMimes.has(item.mime) || seen.has(item.id)) return false;
    seen.add(item.id); return true;
  }).map((item) => ({ attachmentId: item.id, threadId, name: item.filename, mime: item.mime, bytes: item.bytes, createdAt: item.createdAt, messageId: item.messageId }));
}
