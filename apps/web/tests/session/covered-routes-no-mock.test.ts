import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const COVERED_ROUTES = [
  "app/page.tsx",
  "app/projects/page.tsx",
  "app/chat/page.tsx",
  "app/chat/landing/page.tsx",
  "app/chat/preset/page.tsx",
  "app/skill/page.tsx",
  "app/admin/page.tsx",
  "app/admin/[module]/page.tsx",
];

describe("authenticated routes", () => {
  it.each(COVERED_ROUTES)("%s delegates identity to the real session provider", (file) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(source).not.toContain("mockIdentity");
    expect(source).not.toMatch(/<AppShell[\s\S]*?identity=/);
  });

  it("keeps the root server response fail-closed and delegates an existing session from login", () => {
    const root = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");
    const login = readFileSync(resolve(process.cwd(), "app/(entry)/login/page.tsx"), "utf8");

    expect(root).toContain('redirect("/login")');
    expect(root).not.toContain("AppShell");
    expect(root).not.toContain("前端内核已就绪");
    expect(login).toContain("LoginSessionGate");
  });

  it("projects no longer asks the signed-in user to type an org id or log in twice", () => {
    const source = readFileSync(resolve(process.cwd(), "components/projects/projects-screen.tsx"), "utf8");
    expect(source).not.toContain("projects-login-card");
    expect(source).not.toContain("projects-org-id");
    expect(source).toContain("useSession");
  });

  it("formal chat delegates to the read-only live screen without a demo project or mock fallback", () => {
    const page = readFileSync(resolve(process.cwd(), "app/chat/page.tsx"), "utf8");
    const projectContext = readFileSync(resolve(process.cwd(), "lib/project-context.ts"), "utf8");
    expect(page).toContain("ChatReadScreen");
    expect(page).not.toContain("ChatMain");
    expect(page).not.toContain("ChatLeftPanel");
    expect(page).not.toContain("ChatRightPanel");
    expect(page).not.toContain("@/lib/mock/chat");
    expect(projectContext).not.toMatch(/"\/chat"\s*:\s*\{\s*id:\s*"demo"/);
  });
});
