import { afterEach, describe, expect, it, vi } from "vitest";
const { rejected, fixture } = vi.hoisted(() => ({
  rejected: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  fixture: vi.fn(() => null),
}));
vi.mock("next/navigation", () => ({ notFound: rejected }));
vi.mock("@/app/dev/org-home-fixture/preview", () => ({ OrgHomeFixture: fixture }));
import Page from "@/app/dev/org-home-fixture/page";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("offline home fixture route boundary", () => {
  it("rejects production even if the fixture flag is enabled", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("WSX_HOME_FIXTURE", "1");
    expect(() => Page()).toThrow("NOT_FOUND"); expect(fixture).not.toHaveBeenCalled();
  });
  it("rejects development when the explicit fixture flag is absent", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("WSX_HOME_FIXTURE", undefined);
    expect(() => Page()).toThrow("NOT_FOUND"); expect(fixture).not.toHaveBeenCalled();
  });
  it("allows the explicit development-only preview", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("WSX_HOME_FIXTURE", "1");
    expect(Page().type).toBe(fixture); expect(rejected).not.toHaveBeenCalled();
  });
});
