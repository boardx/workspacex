import { translate } from "./i18n/messages";
import { chatShare as C } from "@repo/contracts";
import { apiRequest, apiUrl } from "./api-client";

const pathFor = (template: string, values: Record<string, string>) =>
  template.replace(/:([a-zA-Z]+)/g, (_, name: string) => encodeURIComponent(values[name]!));
export async function previewChatShare(threadId: string, bearer: string, signal?: AbortSignal) {
  return C.Preview.parse(await apiRequest(pathFor(C.paths.preview, { threadId }), { sessionToken: bearer, signal }));
}
export async function createChatShare(threadId: string, bearer: string, revision: string, signal?: AbortSignal) {
  return C.Created.parse(await apiRequest(pathFor(C.paths.manage, { threadId }), {
    method: "POST", sessionToken: bearer, body: { revision }, signal,
  }));
}
export async function listChatShares(threadId: string, bearer: string, signal?: AbortSignal): Promise<C.ShareValue[]> {
  const result = await apiRequest<{ shares: unknown[] }>(pathFor(C.paths.manage, { threadId }), { sessionToken: bearer, signal });
  return result.shares.map(s => C.Share.parse(s));
}
export async function revokeChatShare(threadId: string, bearer: string, shareId: string, signal?: AbortSignal) {
  await apiRequest(pathFor(C.paths.revoke, { threadId, shareId }), {
    method: "DELETE", sessionToken: bearer, signal,
  });
}
/** Stable failure code lets mounted readers retranslate without repeating anonymous reads. */
export class ChatShareReadError extends Error {
  constructor(readonly kind: "missing" | "unavailable") {
    super(translate("zh-CN", kind === "missing" ? "chatShare.missing" : "chatShare.unavailable"));
    this.name = "ChatShareReadError";
  }
}
export async function readChatShare(token: string, signal?: AbortSignal) {
  const response = await fetch(apiUrl(pathFor(C.paths.read, { token })), {
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal,
  });
  if (response.status === 404) throw new ChatShareReadError("missing");
  if (!response.ok) throw new ChatShareReadError("unavailable");
  return C.PublicSnapshot.parse(await response.json());
}
