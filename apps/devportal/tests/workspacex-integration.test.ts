import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const wrangler = readFileSync(path.join(appRoot, "wrangler.toml"), "utf8");
const packageJson = JSON.parse(
  readFileSync(path.join(appRoot, "package.json"), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const deployWorkflow = readFileSync(
  path.join(repoRoot, ".github/workflows/deploy-devportal.yml"),
  "utf8",
);
const cutoverScript = readFileSync(path.join(appRoot, "scripts/pages-cutover.mjs"), "utf8");
// 网关 Worker 的名字是权威（CD 就部署到这个名字）。DevPortal 指哪个网关必须由它推出，
// 不能在这里再钉一个字面量——#479 之前正是钉死了错值：用例名叫「targets the
// WorkSpaceX gateway」，断言的却是**非** WorkSpaceX 的那个网关，绿着，并且保证错值
// 改不回来。账号 workers.dev 子域是 boardx。
const gatewayWrangler = readFileSync(
  path.join(repoRoot, "apps/coord-gateway/wrangler.toml"),
  "utf8",
);
const gatewayWorkerName = /^name\s*=\s*"([^"]+)"/m.exec(gatewayWrangler)?.[1];
const expectedGatewayUrl = `https://${gatewayWorkerName}.boardx.workers.dev`;

// 前端组件不得自带第二份协作面配置：gateway/仓库名一律经
// /api/portal/coord-config 从 wrangler.toml 的 [vars] 读。
function componentSources(): Array<{ file: string; text: string }> {
  const roots = ["components", "app"].map((dir) => path.join(appRoot, dir));
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push({ file: path.relative(appRoot, full), text: readFileSync(full, "utf8") });
    }
  };
  for (const root of roots) walk(root);
  return out;
}

describe("WorkSpaceX DevPortal deployment boundary (#450)", () => {
  it("targets the WorkSpaceX gateway and repository", () => {
    expect(gatewayWorkerName, "读不到 coord-gateway 的 Worker 名就无法判定指向是否正确").toBeTruthy();
    expect(wrangler).toContain(`COORD_GATEWAY_URL = "${expectedGatewayUrl}"`);
    expect(wrangler).toContain('GITHUB_REPO = "boardx/workspacex"');
    expect(wrangler).not.toMatch(/^\s*COORD_SERVICE_[A-Z0-9_]*\s*=/m);
  });

  it("keeps the GitHub App identity consistent with the app that actually exists", () => {
    // #479：迁入时 client id 指向查不到的 App 4328933、slug 是文件自己标注的占位值。
    // 这两个值同属一个 App（4470270 workspacex-coordinator），必须一起对。
    expect(wrangler).toContain('GITHUB_APP_SLUG = "workspacex-coordinator"');
    expect(wrangler).toContain('GITHUB_OAUTH_CLIENT_ID = "Iv23li04uGG7S4NH5Y8E"');
    // 占位值不得再以任何形式出现在配置里
    expect(wrangler).not.toMatch(/=\s*"boardx-devportal"/);
  });

  it("keeps coordination config in one place: no component hardcodes a gateway or repo", () => {
    // ⚠ 这道门第一版是**空转的**，是反证抓出来的：当时先用
    // `text.replace(/\\/\\/[^\\n]*/g, "")` 去注释再匹配——而 `https://…` 里
    // 那两个斜杠本身就长得像行注释，于是 URL 在被检查之前就被吃掉了，
    // 重新硬编码一个网关字面量照样 7 passed。改为逐行判断：只跳过整行注释，
    // 不对行内做任何切割。
    const offenders: string[] = [];
    for (const { file, text } of componentSources()) {
      text.split("\n").forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        const at = `${file}:${index + 1}`;
        if (/["'`]https:\/\/[a-z0-9.-]+\.workers\.dev/.test(line)) offenders.push(`${at}（硬编码 workers.dev 网关）`);
        if (/["'`]boardx\/[a-z0-9-]+["'`]/.test(line)) offenders.push(`${at}（硬编码仓库名）`);
      });
    }
    expect(
      offenders,
      `协作面配置只能有一处来源（wrangler.toml [vars] → /api/portal/coord-config）：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("does not create a second coordination database", () => {
    expect(wrangler).not.toMatch(/\[\[\s*d1_databases\s*\]\]/i);
    expect(wrangler).not.toMatch(/\[\[\s*durable_objects\.bindings\s*\]\]/i);
    expect(wrangler).not.toMatch(/\[\[\s*hyperdrive\s*\]\]/i);

    const allDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    expect(Object.keys(allDependencies)).not.toEqual(
      expect.arrayContaining(["pg", "postgres", "@neondatabase/serverless"]),
    );
  });

  it("validates pull requests and deploys only WorkSpaceX main to the existing Pages project", () => {
    expect(deployWorkflow).toContain("pull_request:");
    expect(deployWorkflow).toContain("github.event_name == 'push'");
    expect(cutoverScript).toContain('const PROJECT = "devportal"');
    expect(cutoverScript).toContain('const CUSTOM_ORIGIN = "https://develop.boardx.us"');
    expect(cutoverScript).toContain(
      'const PAGES_ORIGIN = "https://devportal-4mx.pages.dev"',
    );
  });

  it("keeps pull-request cancellation isolated from serialized production deploys", () => {
    expect(deployWorkflow).toContain("github.event_name");
    expect(deployWorkflow).toContain("github.event.pull_request.number");
    expect(deployWorkflow).toContain("github.ref");
    expect(deployWorkflow).toMatch(
      /cancel-in-progress:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/,
    );
    expect(deployWorkflow).not.toMatch(/cancel-in-progress:\s*true/);
  });

  it("runs deployment and production smoke through the rollback-aware cutover", () => {
    expect(deployWorkflow).toContain("node scripts/pages-cutover.mjs");
    expect(deployWorkflow).not.toContain("pnpm exec wrangler pages deploy");
    expect(deployWorkflow).not.toContain("name: Public smoke check");
    const wranglerTeamDomain = wrangler.match(/^CF_ACCESS_TEAM_DOMAIN\s*=\s*"([^"]+)"/m)?.[1];
    const workflowTeamDomain = deployWorkflow.match(/^\s*CF_ACCESS_TEAM_DOMAIN:\s*(\S+)\s*$/m)?.[1];
    expect(wranglerTeamDomain).toBe("https://boardx.cloudflareaccess.com");
    expect(workflowTeamDomain).toBe(wranglerTeamDomain);
  });
});
