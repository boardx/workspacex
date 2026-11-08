import { describe, expect, it } from "vitest";
import { canApplyBlueprint } from "../../src/application/templates/apply-blueprint";
describe("active organization roles for blueprint application", () => {
  it("allows administrators to create projects from blueprints", () =>
    expect(canApplyBlueprint("admin")).toBe(true));
  it.each(["consultant", "lead", "compliance", null] as const)(
    "denies %s",
    (role) => expect(canApplyBlueprint(role)).toBe(false),
  );
});
