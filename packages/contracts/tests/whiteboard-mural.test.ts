import { describe, expect, it } from "vitest";
import * as C from "../src/whiteboard-mural";
describe("Mural direct import contracts", () => {
  it("accepts only bounded Board return paths and opaque bounded pagination", () => {
    expect(
      C.StartMuralOAuthInput.parse({ returnTo: "/studio/board/a?tab=import" })
        .returnTo,
    ).toContain("/studio/board");
    for (const returnTo of [
      "https://evil.example/studio/board",
      "//evil.example",
      "/chat",
      "#x",
    ])
      expect(C.StartMuralOAuthInput.safeParse({ returnTo }).success).toBe(
        false,
      );
    expect(C.PageQuery.parse({ limit: "50", next: "opaque" })).toEqual({
      limit: 50,
      next: "opaque",
    });
    expect(C.PageQuery.safeParse({ limit: 51 }).success).toBe(false);
  });
  it("requires a selected mural and a fresh destination identity", () => {
    expect(
      C.PreviewMuralInput.safeParse({
        muralId: "m",
        packageBoardId: "57d83843-21e2-40ae-8c1c-571d0ad63c80",
      }).success,
    ).toBe(true);
    expect(
      C.PreviewMuralInput.safeParse({
        packageBoardId: "57d83843-21e2-40ae-8c1c-571d0ad63c80",
      }).success,
    ).toBe(false);
    expect(C.MURAL_DIRECT_IMPORT.scopes).toEqual([
      "workspaces:read",
      "murals:read",
    ]);
  });
});
