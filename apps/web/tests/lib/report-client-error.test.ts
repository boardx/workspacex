/**
 * `reportClientError` -- review finding (PR #2475): the original `truncate()` was
 * `s.slice(0, max) + suffix`, which produces a string LONGER than `max` once the suffix is
 * appended -- deterministically violating the shared contract's `.max()` for every message
 * that actually needed truncating (the automatic reporter rejected exactly the oversized
 * errors it claimed to bound, and the failure was swallowed by `.catch(() => undefined)`).
 * This file pins the fix: the FINAL serialized field (suffix included) never exceeds the
 * contract's max.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});

import { reportClientError } from "@/lib/report-client-error";

beforeEach(() => apiRequest.mockResolvedValue(undefined));
afterEach(() => vi.clearAllMocks());

// Same bounds as `@repo/contracts`' `systemErrorLogs.operations.reportClientError.in` --
// see that file for why each number is what it is.
const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;

describe("reportClientError -- truncated fields never exceed the contract's max", () => {
  it("a message over 2000 chars is truncated to AT MOST 2000, suffix included", async () => {
    reportClientError(new Error("x".repeat(3000)));
    await Promise.resolve();

    expect(apiRequest).toHaveBeenCalledTimes(1);
    const [, opts] = apiRequest.mock.calls.at(-1) as [string, { body: { message: string } }];
    expect(opts.body.message.length).toBeLessThanOrEqual(MAX_MESSAGE_LEN);
  });

  it("a stack over 8000 chars is truncated to AT MOST 8000, suffix included", async () => {
    const err = new Error("boom");
    err.stack = "y".repeat(9000);
    reportClientError(err);
    await Promise.resolve();

    const [, opts] = apiRequest.mock.calls.at(-1) as [string, { body: { stack: string | null } }];
    expect(opts.body.stack).not.toBeNull();
    expect((opts.body.stack as string).length).toBeLessThanOrEqual(MAX_STACK_LEN);
  });

  it("a message at or under the max is sent unchanged", async () => {
    reportClientError(new Error("short message"));
    await Promise.resolve();

    const [, opts] = apiRequest.mock.calls.at(-1) as [string, { body: { message: string } }];
    expect(opts.body.message).toBe("short message");
  });

  it("reporting never throws, even if apiRequest rejects", () => {
    apiRequest.mockRejectedValueOnce(new Error("network down"));
    expect(() => reportClientError(new Error("boom"))).not.toThrow();
  });
});
