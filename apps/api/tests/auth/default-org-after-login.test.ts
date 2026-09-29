import { describe, expect, it } from "vitest";
import { pickDefaultOrgId } from "../../src/application/auth/issue-authenticated-session";

describe("pickDefaultOrgId: login's default org is independent of membership row order", () => {
  it("prefers the invited org over the F16 personal-local org, in either order", () => {
    const local = "org-local-0000aaaa";
    expect(pickDefaultOrgId([local, "org-b"])).toBe("org-b");
    expect(pickDefaultOrgId(["org-b", local])).toBe("org-b");
  });

  it("is deterministic across every permutation of several orgs", () => {
    const ids = ["org-local-1", "org-z", "org-c", "org-m"];
    const perms = (xs: string[]): string[][] =>
      xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    const picks = new Set(perms(ids).map((p) => pickDefaultOrgId(p)));
    expect([...picks]).toEqual(["org-c"]);
  });

  it("falls back to the local org when it is the only membership, and null when none", () => {
    expect(pickDefaultOrgId(["org-local-1"])).toBe("org-local-1");
    expect(pickDefaultOrgId([])).toBeNull();
  });
});
