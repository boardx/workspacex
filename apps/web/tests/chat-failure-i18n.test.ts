import { expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { describeMutateFailure } from "@/lib/chat-failure-copy";

it.each([
  ["NO_WRITE_ROLE", "The current identity cannot write to this conversation (NO_WRITE_ROLE)."],
  ["VERSION_CHANGED", "This conversation was modified by someone else (VERSION_CHANGED). Refresh and try again."],
  ["TITLE_INVALID", "The title is invalid (TITLE_INVALID)."],
  ["THREAD_ARCHIVED_READONLY", "This conversation is archived and read-only (THREAD_ARCHIVED_READONLY)."],
])("localizes the semantic %s reason without rewriting its wire value", (reason, english) => {
  const failure = new ApiError(403, reason, "raw 服务端消息");
  expect(describeMutateFailure(failure, "en")).toBe(english);
  expect(failure.reasonCode).toBe(reason);
  expect(describeMutateFailure(failure)).toContain(reason);
});
it("preserves unrecognized error content verbatim and localizes only application fallback", () => {
  expect(describeMutateFailure(new Error("原始 upstream message 🌍"), "en")).toBe("原始 upstream message 🌍");
  expect(describeMutateFailure(new ApiError(503, "UNKNOWN_REASON", "raw"), "en")).toBe("UNKNOWN_REASON (HTTP 503)");
  expect(describeMutateFailure(null, "en")).toBe("The operation failed. Try again later.");
});
