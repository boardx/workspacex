import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const COVERED_ROUTES = [
  "app/projects/page.tsx",
  "app/chat/page.tsx",
  "app/chat/landing/page.tsx",
  "app/chat/preset/page.tsx",
  "app/skill/page.tsx",
  "app/admin/page.tsx",
  "app/admin/[module]/page.tsx",
];

describe("Wave 1 authenticated routes", () => {
  it.each(COVERED_ROUTES)("%s delegates identity to the real session provider", (file) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(source).not.toContain("mockIdentity");
    expect(source).not.toMatch(/<AppShell[\s\S]*?identity=/);
  });

  it("projects no longer asks the signed-in user to type an org id or log in twice", () => {
    const source = readFileSync(resolve(process.cwd(), "components/projects/projects-screen.tsx"), "utf8");
    expect(source).not.toContain("projects-login-card");
    expect(source).not.toContain("projects-org-id");
    expect(source).toContain("useSession");
  });
});
