import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PLATFORM_CATALOG_ORG_ID } from "@repo/contracts/ai-catalog-admin";
// Visual/interaction coverage against deterministic HTTP fixtures. Actual authority/RLS
// is separately exercised by API HTTP+PG suites; these captures do not claim backend proof.
const output = resolve(
  process.cwd(),
  "../../evidence/agent-skill-admin-6418/browser",
);
const localAgent = {
  agentId: "agent-visual",
  versionId: "av1",
  name: "产品经理",
  initials: "产",
  roleLabel: "梳理问题并制定清晰的产品方案",
  avatar: {
    kind: "illustration",
    key: "dh-03-product-manager",
    alt: "产品经理",
  },
  roleCategory: "product",
  tags: ["产品"],
  catalogSource: "org",
  workflows: [],
  readiness: "ready",
};
const entry = (kind: string) => ({
  orgId: PLATFORM_CATALOG_ORG_ID,
  id: `public-${kind}`,
  kind,
  name: kind === "agent" ? "研究与知识分析师" : "研究资料整理",
  description:
    kind === "agent"
      ? "整理证据，提炼洞察，帮助团队形成清晰结论。"
      : "整理资料与引用，为团队提供简明的研究摘要。",
  avatarUrl: null,
  avatarKey: kind === "agent" ? "dh-02-research-knowledge-analyst" : null,
  versionId: `${kind}-v1`,
  scope: "public",
  published: true,
  enabled: false,
});
test("organization and platform catalogs use concise cards and reachable details across viewports", async ({
  page,
}) => {
  mkdirSync(output, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem(
      "wsx.session",
      JSON.stringify({
        version: 1,
        userId: "visual-operator",
        orgs: ["org-visual"],
        currentOrgId: "org-visual",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
    );
    localStorage.setItem("wsx.sessionToken", "visual-fixture");
    document.cookie = "workspacex-locale=zh-CN; Path=/";
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error("catalog browser runtime", error.stack); });
  await page.route("http://localhost:3200/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname === "/identity/me")
      body = {
        displayName: "Visual operator",
        avatarUrl: null,
        org: {
          id: "org-visual",
          name: "示例组织",
          kind: "organization",
          status: "active",
          modelPolicy: "any",
        },
        orgRole: "admin",
        teamId: null,
        projectRole: null,
        groupId: null,
      };
    else if (url.pathname === "/platform/access")
      body = {
        platformOperator: true,
        platformAdmin: true,
        platformSuperuser: false,
      };
    else if (url.pathname === "/platform/organizations")
      body = {
        organizations: [
          {
            orgId: "org-visual",
            name: "示例组织",
            kind: "organization",
            memberCount: 2,
            plan: { plan: null, enforcement: "legacy", version: 0 },
          },
        ],
        nextCursor: null,
      };
    else if (
      url.pathname === "/platform/ai-catalog" ||
      url.pathname.endsWith("/public-ai-catalog")
    )
      body = {
        entries: [entry(url.searchParams.get("kind") ?? "agent"), {...entry(url.searchParams.get("kind") ?? "agent"), id:"public-second",name:"团队协作助手",avatarKey:null,description:"帮助团队整理任务，形成清晰、简短的行动方案。"}, {...entry(url.searchParams.get("kind") ?? "agent"),id:"public-third",name:"知识总结",avatarKey:null,description:"提取关键信息并整理为易于阅读的摘要，保留来源和重要结论。"}],
        nextCursor: null,
      };
    else if (url.pathname === "/agents/directory")
      body = { items: [localAgent] };
    else if (url.pathname === "/agents/official-role-pack/offer")
      body = {
        packId: "pack-visual",
        packVersion: "1.0",
        canEnable: true,
        pending: [],
        requiredSkillPacks: [],
        upgrades: [],
      };
    else if (url.pathname === "/skills")
      body = {
        items: [
          {
            skillId: "skill-visual",
            name: "团队资料整理",
            duty: "整理团队资料并生成简明摘要",
            source: "自建",
            status: "已启用",
            visibility: "org-wide",
            currentVersionId: "sv1",
            satisfaction: null,
            tags: [],
          },
        ],
        total: 1,
      };
    else if (url.pathname.endsWith("/count")) body = { count: 0 };
    else if (url.pathname.endsWith("/unread-count")) body = { unreadCount: 0 };
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "http://localhost:3199",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
        "access-control-allow-headers": "authorization,content-type",
      },
      body: JSON.stringify(body),
    });
  });
  for (const kind of ["agent", "skill"] as const) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/org-admin/${kind}`);
    await expect(page.getByTestId("rail-admin")).toHaveCount(1);
    await expect(page.getByTestId("rail-agent-directory")).toHaveCount(0);
    await expect(page.getByTestId("rail-work-skill-catalog")).toHaveCount(0);
    await expect(
      page
        .getByText(kind === "agent" ? localAgent.name : "团队资料整理", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await page.screenshot({
      path: resolve(output, `organization-${kind}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "平台公共", exact: true }).click();
    await expect(
      page.getByText(entry(kind).name, { exact: true }).first(),
    ).toBeVisible();
    await page.getByText(entry(kind).name, { exact: true }).first().click();
    await expect(
      page.getByRole("button", { name: "为本组织启用" }),
    ).toBeVisible();
    await page.screenshot({
      path: resolve(output, `organization-${kind}-public-detail.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.goto(`/platform-admin/${kind}`);
    await expect(
      page.getByText(entry(kind).name, { exact: true }).first(),
    ).toBeVisible();
    await page.getByLabel("管理范围").selectOption(PLATFORM_CATALOG_ORG_ID);
    await page.screenshot({
      path: resolve(output, `platform-${kind}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByText(entry(kind).name, { exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: resolve(output, `platform-${kind}-mobile.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
