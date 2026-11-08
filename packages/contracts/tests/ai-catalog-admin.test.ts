import { describe, expect, it } from "vitest";
import { Enable, Entry, List } from "../src/ai-catalog-admin";
describe("scoped AI catalog contract", () => {
  it("requires an immutable version and idempotency key to enable", () => {
    expect(Enable.safeParse({ kind: "agent", id: "a" }).success).toBe(false);
    expect(
      Enable.parse({
        kind: "agent",
        id: "a",
        versionId: "v",
        idempotencyKey: "k",
      }).versionId,
    ).toBe("v");
  });
  it("bounds list sizes and rejects user-supplied authorization", () => {
    expect(List.safeParse({ kind: "skill", limit: 101 }).success).toBe(false);
    expect(
      List.safeParse({ kind: "skill", platformAuthorized: true }).success,
    ).toBe(false);
  });
  it("requires explicit public versus organization provenance", () => {
    expect(
      Entry.safeParse({
        orgId: "org-a",
        id: "a",
        kind: "agent",
        name: "A",
        description: "A",
      }).success,
    ).toBe(false);
  });
});
