import { describe, it, expect, vi } from "vitest";
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/components/skill/skill-app", () => ({ SkillApp: () => null }));
import AgentPage from "@/app/agent/page";
import SkillPage from "@/app/skill/page";
describe("legacy production catalog links", () => {
  it("moves the member Agent directory into the organization entry", () =>
    expect(() => AgentPage()).toThrow("redirect:/org-admin/agent"));
  it.each(["library", "catalog", "work-catalog"])(
    "preserves the %s Skill directory link",
    (screen) =>
      expect(() =>
        SkillPage({ searchParams: { screen, org: "org-a" } }),
      ).toThrow(`redirect:/org-admin/skill?screen=${screen}&org=org-a`),
  );
  it("keeps the legacy prototype only when explicitly requested", () =>
    expect(() =>
      SkillPage({
        searchParams: { screen: "library-prototype", state: "empty" },
      }),
    ).not.toThrow());
});
