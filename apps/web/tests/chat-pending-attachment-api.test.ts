import { afterEach, expect, it, vi } from "vitest";
import { cancelPendingAttachment } from "@/lib/live-chat";
afterEach(() => vi.unstubAllGlobals());
it("calls the implemented cancellation route with the captured session and accepts204", async () => {
  const fetch = vi.fn(async () => new Response(null,{status:204})); vi.stubGlobal("fetch", fetch);
  await expect(cancelPendingAttachment("original thread", "pending/id", "original-session")).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledOnce();
  const [url,options] = fetch.mock.calls[0] as unknown as [string,RequestInit];
  expect(String(url)).toContain("/chat/threads/original%20thread/attachments/pending%2Fid");
  expect(options.method).toBe("DELETE");
  expect(new Headers(options.headers).get("Authorization")).toBe("Bearer original-session");
  expect(options.body).toBeUndefined();
});
