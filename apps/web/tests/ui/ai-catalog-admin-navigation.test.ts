import { describe, expect, it } from "vitest";
import { NAV_SEGMENTS, navSegmentsForViewer } from "@/lib/navigation";
import { adminNavForViewer } from "@/lib/admin-nav-metadata";
import { PLATFORM_ADMIN_ROUTES } from "@/lib/platform-admin-routes";

describe("AI catalog administration entry points", () => {
  it("removes standalone Agent and Skill entries from primary and overflow navigation", () => {
    const items = NAV_SEGMENTS.flatMap((s) => s.items);
    expect(
      items.some(
        (i) => i.key === "agent-directory" || i.key === "work-skill-catalog",
      ),
    ).toBe(false);
  });
  it("does not show the organization administration entry to members", () => {
    const entries = navSegmentsForViewer({ orgRole: "consultant", orgName: "Example" });
    expect(entries.flatMap((group) => group.items).some((item) => item.key === "admin")).toBe(false);
  });
  it("retains organization administration for admins and independent platform access", () => {
    const items = adminNavForViewer("org", "admin").flatMap((g) => g.items);
    expect(items.some((i) => i.key === "org-invites")).toBe(true);
    expect(items.some((i) => i.key === "org-agent")).toBe(true);
    expect(
      adminNavForViewer("platform", "consultant")
        .flatMap((g) => g.items)
        .find((i) => i.key === "skill")?.href,
    ).toBe("/platform-admin/skill");
    expect(PLATFORM_ADMIN_ROUTES.skill).toBe("skill");
    expect(
      navSegmentsForViewer({
        orgName: "Example",
        orgRole: "consultant",
        platformOperator: false,
      })
        .flatMap((s) => s.items)
        .some((i) => i.key === "platform-admin"),
    ).toBe(false);
  });
});
