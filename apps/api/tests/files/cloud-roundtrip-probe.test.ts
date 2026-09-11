import { afterEach, expect, it, vi } from "vitest";
import { verifyCloudFileRoundtrip } from "../../scripts/cloud-file-roundtrip";
afterEach(() => vi.unstubAllGlobals());
function fixture(mode: "success" | "upload-failed" | "corrupt" = "success") {
  const mutations: { op: string; threadId: string | null }[] = []; let bytes = new Uint8Array();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/chat/threads/mutate")) {
      const input = JSON.parse(init.body as string); mutations.push(input);
      return Response.json({ threadId: "only-created-thread", version: 1, auditEventId: "audit", impactScope: null });
    }
    if (init.method === "POST") {
      if (mode === "upload-failed") return new Response(null, { status: 503 });
      const blob = (init.body as FormData).get("file") as Blob; bytes = new Uint8Array(await blob.arrayBuffer());
      return Response.json({ id: "attachment", filename: "provision-probe.txt", mime: "text/plain", bytes: bytes.length, createdAt: new Date().toISOString() });
    }
    if (!(init.headers as Record<string, string>).Authorization) return new Response(null, { status: 401 });
    return new Response(mode === "corrupt" ? "wrong" : bytes);
  }));
  return mutations;
}
it("uses business upload/download routes and only logically removes its own generated thread", async () => {
  const mutations = fixture();
  const result = await verifyCloudFileRoundtrip("https://service.test", "session", "org-test");
  expect(result).toMatchObject({ fileRoundtripVerified: true, ossProviderVerified: false,
    cleanup: "thread-logically-deleted; object-retained-under-policy" });
  expect(mutations.map(item => [item.op, item.threadId])).toEqual([["create", null], ["delete", "only-created-thread"]]);
});
it.each(["upload-failed", "corrupt"] as const)("fails closed and cleans only its own thread on %s", async mode => {
  const mutations = fixture(mode);
  await expect(verifyCloudFileRoundtrip("https://service.test", "session", "org-test")).rejects.toThrow();
  expect(mutations.at(-1)).toMatchObject({ op: "delete", threadId: "only-created-thread" });
});
it("honors an already expired shared deadline before any network or cleanup work", async () => {
  const mutations = fixture(); const controller = new AbortController(); controller.abort();
  await expect(verifyCloudFileRoundtrip("https://service.test", "session", "org-test", controller.signal)).rejects.toThrow();
  expect(mutations).toEqual([]); expect(fetch).not.toHaveBeenCalled();
});
