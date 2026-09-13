import { describe, expect, it, vi } from "vitest";
import { waitForProducedFileDownloadReady } from "../../e2e/support/produced-file-download-ready";

describe("waitForProducedFileDownloadReady", () => {
  it("waits through the terminal-to-blob race until the authenticated blob anchor is enabled", async () => {
    const states = [
      { href: null, ariaDisabled: "true" },
      { href: null, ariaDisabled: "true" },
      { href: "blob:https://www.boardx.com.cn/report", ariaDisabled: "false" },
    ];
    let index = 0;

    const result = await waitForProducedFileDownloadReady(
      async () => states[Math.min(index++, states.length - 1)]!,
      { timeoutMs: 100, pollIntervalMs: 0 },
    );

    expect(result).toBe("blob:https://www.boardx.com.cn/report");
    expect(index).toBe(3);
  });

  it("fails within the bound when the produced-file anchor remains disabled", async () => {
    const read = vi.fn().mockResolvedValue({ href: null, ariaDisabled: "true" });
    let now = 0;

    await expect(waitForProducedFileDownloadReady(read, {
      timeoutMs: 20,
      pollIntervalMs: 10,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
    })).rejects.toThrow(/still disabled after 20ms/);

    expect(read).toHaveBeenCalledTimes(3);
  });

  it("does not accept a non-blob href as an authenticated produced-file download", async () => {
    let now = 0;

    await expect(waitForProducedFileDownloadReady(
      async () => ({ href: "javascript:alert(1)", ariaDisabled: "false" }),
      {
        timeoutMs: 10,
        pollIntervalMs: 10,
        now: () => now,
        sleep: async (milliseconds) => { now += milliseconds; },
      },
    )).rejects.toThrow(/href=javascript:/);
  });
});
