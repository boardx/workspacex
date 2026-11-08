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
  it("lets an ordinary organization member discover both catalogs through the organization entry", () => {
    const entry = navSegmentsForViewer({
      orgRole: "consultant",
      platformOperator: false,
      orgName: "Example",
    })
      .flatMap((s) => s.items)
      .find((i) => i.key === "admin");
    expect(entry?.href).toBe("/org-admin/agent");
    const items = adminNavForViewer("org", "consultant").flatMap(
      (g) => g.items,
    );
    expect(items.map((i) => i.href)).toEqual([
      "/org-admin/agent",
      "/org-admin/skill",
    ]);
    expect(
      items.some((i) => i.key === "org-invites" || i.key === "members"),
    ).toBe(false);
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
