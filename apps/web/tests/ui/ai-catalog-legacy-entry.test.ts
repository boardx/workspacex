import { describe, it, expect, vi } from "vitest";
vi.mock("@/components/admin/organization-ai-catalog", () => ({ OrganizationAiCatalog: () => null }));
vi.mock("@/components/skill/skill-app", () => ({ SkillApp: () => null }));
import AgentPage from "@/app/agent/page";
import SkillPage from "@/app/skill/page";
describe("legacy production catalog links", () => {
  it("keeps the Agent directory outside the administration shell", () =>
    expect(AgentPage({}).props).toMatchObject({ kind: "agent", standalone: true }));
  it.each(["library", "catalog", "work-catalog"])(
    "preserves the %s Skill directory link",
    (screen) =>
      expect(SkillPage({ searchParams: { screen, org: "org-a" } }).props)
        .toMatchObject({ kind: "skill", standalone: true, initialScreen: screen }),
  );
  it("keeps the legacy prototype only when explicitly requested", () =>
    expect(() =>
      SkillPage({
        searchParams: { screen: "library-prototype", state: "empty" },
      }),
    ).not.toThrow());
});
