import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const COVERED_ROUTES = [
  "app/page.tsx",
  "app/projects/page.tsx",
  // issue #2067: AppShell/身份相关的组合现在住在 `(v2)/layout.tsx`，`(v2)/page.tsx`
  // 本身只渲染 `CopilotKitV2Shell`，不再直接持有 AppShell/identity。
  "app/chat/(v2)/layout.tsx",
  "app/chat/landing/page.tsx",
  "app/chat/preset/page.tsx",
  "app/skill/page.tsx",
  "app/admin/page.tsx",
  "app/admin/[module]/page.tsx",
  // #1316: /projects/[projectId] and its two real-data sub-routes silently substituted
  // any non-built-in org with MOCK_ORGS[0] ("远洋新能源") and downgraded the caller's
  // orgRole to "consultant" — a real logged-in user of a real org saw somebody else's
  // org name/role, not an honest empty state. These three share one real projectId
  // family (project-workbench.tsx's own header comment groups files/canvas with the
  // main workbench as "同型"), so they move to real identity together.
  "app/projects/[projectId]/page.tsx",
  "app/projects/[projectId]/files/page.tsx",
  "app/projects/[projectId]/canvas/page.tsx",
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
    const middleware = readFileSync(resolve(process.cwd(), "middleware.ts"), "utf8");

    expect(root).toContain('redirect("/login")');
    expect(root).not.toContain("AppShell");
    expect(root).not.toContain("前端内核已就绪");
    expect(login).toContain("LoginSessionGate");
    expect(middleware).toContain('matcher: ["/"]');
    expect(middleware).toContain('NextResponse.redirect(new URL("/login", request.url), 307)');
  });

  it("projects no longer asks the signed-in user to type an org id or log in twice", () => {
    const source = readFileSync(resolve(process.cwd(), "components/projects/projects-screen.tsx"), "utf8");
    expect(source).not.toContain("projects-login-card");
    expect(source).not.toContain("projects-org-id");
    expect(source).toContain("useSession");
  });

  // issue #2067: the formal `/chat` bare route (no query params) now natively renders
  // the CopilotKit v2 experience (#2044) — `ChatReadScreen`'s "read-only live screen"
  // is reached today via `/chat/legacy` and the `?projectId=`/`?thread=` deep links
  // (rewritten to `/chat/legacy` before this route ever sees them, see
  // `next.config.mjs`'s `rewrites().beforeFiles` header comment). That route is the
  // faithful surviving target for this assertion, not `/chat` itself anymore.
  it("legacy chat fallback delegates to the read-only live screen without a demo project or mock fallback", () => {
    const page = readFileSync(resolve(process.cwd(), "app/chat/legacy/page.tsx"), "utf8");
    const projectContext = readFileSync(resolve(process.cwd(), "lib/project-context.ts"), "utf8");
    expect(page).toContain("ChatReadScreen");
    expect(page).not.toContain("ChatMain");
    expect(page).not.toContain("ChatLeftPanel");
    expect(page).not.toContain("ChatRightPanel");
    expect(page).not.toContain("@/lib/mock/chat");
    expect(projectContext).not.toMatch(/"\/chat"\s*:\s*\{\s*id:\s*"demo"/);
  });
});
