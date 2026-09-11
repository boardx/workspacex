import { afterEach, expect, it, vi } from "vitest";
import { fetchExportArchive, saveExportArchive } from "@/lib/live-files";
vi.mock("@/lib/api-client", () => ({ apiRequest: vi.fn(), apiUrl: (path: string) => `https://api.example.test${path}`,
  getStoredSessionToken: () => "test-session" }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("fetches ZIP with the current bearer token from a locally constructed API URL", async () => {
  const fetcher = vi.fn(async () => new Response("archive", { headers: { "Content-Type": "application/zip" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await (await fetchExportArchive("exp/unsafe?url=https://evil.test")).text()).toBe("archive");
  expect(fetcher).toHaveBeenCalledWith("https://api.example.test/export-jobs/exp%2Funsafe%3Furl%3Dhttps%3A%2F%2Fevil.test/content",
    expect.objectContaining({ headers: { Authorization: "Bearer test-session" } }));
});
it("turns successful bytes into a real download and releases the blob URL", async () => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(async () => new Response("zip")));
  const createObjectURL = vi.fn(() => "blob:test"), revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await saveExportArchive("job"); expect(click).toHaveBeenCalledOnce(); expect(createObjectURL).toHaveBeenCalledOnce();
  await vi.runAllTimersAsync(); expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  expect(document.querySelector("a[download='export.zip']")).toBeNull();
});
it("never reports an error response as a downloaded ZIP", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
  await expect(fetchExportArchive("job")).rejects.toThrow("HTTP 403");
});
