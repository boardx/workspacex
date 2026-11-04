import { describe, expect, it } from "vitest";
import * as identity from "../src/identity";
import { listOwnActivityMock } from "../../../apps/web/lib/generated/identity.mock";
const operation = identity.operations.listOwnActivity;
const legacyEvent = { eventId: "event-1", kind: "profile-renamed", occurredAt: "2026-11-03T00:00:00Z", summary: '显示名改为"原文 Alice"' };
const response = (display?: unknown) => ({ events: [{ ...legacyEvent, ...(display === undefined ? {} : { display }) }], nextCursor: null });

describe("activity structured presentation negotiation", () => {
  it("accepts the legacy request and response without metadata", () => {
    expect(operation.in.safeParse({ cursor: null, limit: 20 }).success).toBe(true);
    expect(operation.out.safeParse(response()).success).toBe(true);
  });
  it("accepts the explicit versioned request and structured name without changing source text", () => {
    expect(operation.in.safeParse({ cursor: null, limit: 20, displayFormat: "structured-v1" }).success).toBe(true);
    const result = operation.out.safeParse(response({ code: "profile-renamed", params: { displayName: "原文 {token} Alice" } }));
    expect(result.success).toBe(true);
  });
  it.each([
    { code: "unknown", params: {} },
    { code: "profile-renamed", params: { displayName: 42 } },
    { code: "profile-renamed", params: { displayName: "Alice", password: "secret" } },
    { code: "avatar-changed", params: { cleared: "true" } },
    { code: "password-changed", params: { password: "secret" } },
  ])("rejects unknown/malformed/extra metadata %#", (display) => {
    expect(operation.out.safeParse(response(display)).success).toBe(false);
  });
  it("rejects unsupported presentation versions", () => {
    expect(operation.in.safeParse({ cursor: null, limit: 20, displayFormat: "structured-v2" }).success).toBe(false);
  });
});

it("generates an activity mock that satisfies the strict presentation contract", () => {
  expect(identity.operations.listOwnActivity.out.safeParse(listOwnActivityMock).success).toBe(true);
});
