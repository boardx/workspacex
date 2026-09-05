/**
 * `systemErrorLogs.reportClientError.in` -- every field has a `.max()` (review finding,
 * PR #2475: the first version only bounded `message`; `stack`/`url`/`userAgent`/
 * `appVersion` were unbounded strings on a `@Public()` write route). Pins down that an
 * oversized field is REJECTED at the contract boundary, not silently accepted and
 * truncated later.
 */
import { describe, expect, it } from "vitest";
import * as systemErrorLogs from "../src/system-error-logs";

const schema = systemErrorLogs.operations.reportClientError.in;

const valid = {
  message: "boom",
  stack: null,
  url: null,
  userAgent: null,
  appVersion: null,
};

describe("reportClientError.in -- field length bounds", () => {
  it("accepts a request at exactly the max length for every field", () => {
    const atMax = {
      message: "m".repeat(2000),
      stack: "s".repeat(8000),
      url: "u".repeat(2000),
      userAgent: "a".repeat(500),
      appVersion: "v".repeat(100),
    };
    expect(schema.safeParse(atMax).success).toBe(true);
  });

  it("rejects message over 2000 chars", () => {
    expect(schema.safeParse({ ...valid, message: "m".repeat(2001) }).success).toBe(false);
  });

  it("rejects stack over 8000 chars", () => {
    expect(schema.safeParse({ ...valid, stack: "s".repeat(8001) }).success).toBe(false);
  });

  it("rejects url over 2000 chars", () => {
    expect(schema.safeParse({ ...valid, url: "u".repeat(2001) }).success).toBe(false);
  });

  it("rejects userAgent over 500 chars", () => {
    expect(schema.safeParse({ ...valid, userAgent: "a".repeat(501) }).success).toBe(false);
  });

  it("rejects appVersion over 100 chars", () => {
    expect(schema.safeParse({ ...valid, appVersion: "v".repeat(101) }).success).toBe(false);
  });

  it("nullable fields still accept null", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it("empty message is rejected (min(1))", () => {
    expect(schema.safeParse({ ...valid, message: "" }).success).toBe(false);
  });
});

// issue #2797 -- runId/threadId/phase/errorType, all optional+nullable so the two
// pre-existing capture points (which don't know about a run) keep validating unchanged.
describe("reportClientError.in -- agent-run context fields (issue #2797)", () => {
  it("all four are optional -- a payload without them still validates (backward compatible)", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it("all four accept null explicitly", () => {
    expect(
      schema.safeParse({ ...valid, runId: null, threadId: null, phase: null, errorType: null }).success,
    ).toBe(true);
  });

  it("accepts a request at exactly the max length for every new field", () => {
    expect(
      schema.safeParse({
        ...valid,
        runId: "r".repeat(200),
        threadId: "t".repeat(200),
        phase: "p".repeat(100),
        errorType: "e".repeat(200),
      }).success,
    ).toBe(true);
  });

  it("rejects runId over 200 chars", () => {
    expect(schema.safeParse({ ...valid, runId: "r".repeat(201) }).success).toBe(false);
  });

  it("rejects threadId over 200 chars", () => {
    expect(schema.safeParse({ ...valid, threadId: "t".repeat(201) }).success).toBe(false);
  });

  it("rejects phase over 100 chars", () => {
    expect(schema.safeParse({ ...valid, phase: "p".repeat(101) }).success).toBe(false);
  });

  it("rejects errorType over 200 chars", () => {
    expect(schema.safeParse({ ...valid, errorType: "e".repeat(201) }).success).toBe(false);
  });
});
