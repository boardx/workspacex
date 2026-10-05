import { afterEach, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useAuthedImageSrc } from "@/lib/use-authed-image-src";

vi.mock("@/lib/api-client", () => ({ getStoredSessionToken: () => "synthetic-token" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("clears the previous file while a new fetch is pending and after it fails", async () => {
  let rejectB!: (error: Error) => void;
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["A"]) })
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectB = reject; }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:A"), revokeObjectURL: vi.fn() });
  const { result, rerender } = renderHook(({ url }) => useAuthedImageSrc(url), { initialProps: { url: "/A" } });
  await waitFor(() => expect(result.current.src).toBe("blob:A"));
  rerender({ url: "/B" });
  expect(result.current.src).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:A");
  rejectB(new Error("403"));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.src).toBeNull();
});
