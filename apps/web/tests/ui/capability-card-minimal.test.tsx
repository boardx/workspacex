import { describe, it, expect } from "vitest";
import { capabilityCardSpec } from "../../components/admin/capability-card";
describe("minimal capability directory card", () => {
  it("keeps identity and description but moves operational content out of the card", () => {
    const spec = capabilityCardSpec("skill", {title:"Example", description:"Short description", actions:"Edit", badges:"Enabled", meta:"technical-id", tags:"tag"});
    expect(spec.title).toBe("Example");
    expect(spec.leading).toBeTruthy();
    expect(spec.description).toBeTruthy();
    expect(spec.actions).toBeUndefined();
    expect(spec.badges).toBeUndefined();
    expect(spec.meta).toBeUndefined();
    expect(spec.tags).toBeUndefined();
  });
});
