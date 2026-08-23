// #638/#639 —— 用户个人资料自助服务 + 组织团队管理，真实浏览器验收门。
//
// 单独一个 config、单独一个 webServer/DB/org，同 `playwright.chat-read.config.ts` 的做法
// （不是并进 `playwright.fullstack-smoke.config.ts` 那套多 spec 共用一个 org 的模式）——
// 见 `e2e/self-service-profile-fixture.ts` 文件头：本 spec 会真的改掉登录密码，
// 一旦跟别的 spec 共用账号，账号密码被换掉之后别的 spec 会集体登录失败。
import { defineConfig, devices } from "@playwright/test";
import { SELF_SERVICE_PROFILE_E2E } from "./e2e/self-service-profile-fixture";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; run through the root #74 isolation wrapper`);
  return value;
}

const apiPort = required("WORKSPACEX_API_PORT");
const webPort = required("WORKSPACEX_WEB_PORT");
const compose = `docker compose -f ../api/docker-compose.dev.yml -p "${required("COMPOSE_PROJECT_NAME")}"`;

export default defineConfig({
  testDir: "./e2e",
  /**
   * F05 —— 新增 `profile-keyboard-navigation.spec.ts` 同样由本 config 接住：这里已经
   * 起好了 profile 这条链路需要的真登录 + 真种子库全套编排，单自建 runner 是硬瓶颈。
   * 用的是独立的 `keyboardEmail` 账号（`self-service-profile-fixture.ts` 头注），
   * 不与 `self-service-profile.spec.ts` 的 admin 账号共享登录态/密码。
   */
  testMatch: /(self-service-profile|profile-keyboard-navigation)\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  // 本文件一条用例里串了登录/改名/刷新/改密码/退出/两次重新登录/团队增改删五组动作，
  // 忙机器上累计耗时容易超过默认 30s（实测在 load average 70+ 的机器上跑到 60s 都不够）。
  // CI 是干净栈，不受影响；本地慢机器需要更宽的窗口。
  timeout: 180_000,
  // bcrypt 哈希（改密码要重新 hash 一次新密码）+ 首次编译窗口都可能吃掉默认 5s——
  // 与 `playwright.chat-read.config.ts` 同一个理由，同一个数字。
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // 头像上传落对象存储，因此这里比 `chat-read` 多起一个 minio
      // （同 `playwright.fullstack-smoke.config.ts` 的做法，那套也要头像/文件功能）。
      command: [
        `${compose} up -d --wait postgres redis minio`,
        "pnpm --filter @repo/api exec tsx scripts/seed-self-service-profile-e2e.ts",
        "pnpm --filter @repo/api start",
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/healthz`,
      // 与 `playwright.fullstack-smoke.config.ts` 头部注释同一个理由同一个数字量级：
      // 忙机器上 `docker compose up --wait` 与 `next dev` 首次编译都可能超过 120s
      // （该文件实测记录过冷构建 3m24s）。CI 是干净栈、有外网，不受影响；本地慢机器
      // 需要更宽的窗口，不然会被读成"服务起不来"而不是"这台机器忙"。
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        PORT: apiPort,
        SSP_E2E_FIXTURE: "1",
        SSP_E2E_ORG_ID: SELF_SERVICE_PROFILE_E2E.orgId,
        SSP_E2E_ORG_NAME: SELF_SERVICE_PROFILE_E2E.orgName,
        SSP_E2E_PROJECT_ID: SELF_SERVICE_PROFILE_E2E.projectId,
        SSP_E2E_ADMIN_EMAIL: SELF_SERVICE_PROFILE_E2E.adminEmail,
        SSP_E2E_ADMIN_PASSWORD: SELF_SERVICE_PROFILE_E2E.adminPassword,
        SSP_E2E_ADMIN_USER_ID: SELF_SERVICE_PROFILE_E2E.adminUserId,
        SSP_E2E_ADMIN_DISPLAY_NAME: SELF_SERVICE_PROFILE_E2E.adminDisplayName,
        SSP_E2E_MEMBER_USER_ID: SELF_SERVICE_PROFILE_E2E.memberUserId,
        SSP_E2E_MEMBER_EMAIL: SELF_SERVICE_PROFILE_E2E.memberEmail,
        SSP_E2E_SEED_TEAM_NAME: SELF_SERVICE_PROFILE_E2E.seedTeamName,
        // F05 —— 键盘可达性专属账号，唯一事实源在 `self-service-profile-fixture.ts`。
        SSP_E2E_KEYBOARD_USER_ID: SELF_SERVICE_PROFILE_E2E.keyboardUserId,
        SSP_E2E_KEYBOARD_EMAIL: SELF_SERVICE_PROFILE_E2E.keyboardEmail,
        SSP_E2E_KEYBOARD_PASSWORD: SELF_SERVICE_PROFILE_E2E.keyboardPassword,
        SSP_E2E_KEYBOARD_DISPLAY_NAME: SELF_SERVICE_PROFILE_E2E.keyboardDisplayName,
        // #548：不供这一条，API 进程起不来（`credentialCipherFromEnv()` 抛错）。
        MODEL_CREDENTIAL_KEY: "self-service-profile-e2e-credential-key-not-a-secret",
      },
    },
    {
      // ⚠ 复用 `CHAT_READ_E2E_API_ORIGIN` 这个变量名，不是拼错——
      //   `next.config.mjs` 的 rewrites() 只认 `FULLSTACK_E2E_API_ORIGIN`（前缀
      //   `/__fullstack_api`）和 `CHAT_READ_E2E_API_ORIGIN`（空前缀）两个入口，
      //   本 spec 要的正是"空前缀、走真实 API"这条已有分支，不必再给 next.config.mjs
      //   加第三个只是名字不同、行为完全一样的判断——同一件事只该有一处开关。
      command: `NEXT_PUBLIC_API_URL=http://127.0.0.1:${webPort} CHAT_READ_E2E_API_ORIGIN=http://127.0.0.1:${apiPort} NEXT_DIST_DIR=.next-self-service-profile-e2e next dev -p ${webPort}`,
      url: `http://127.0.0.1:${webPort}/login`,
      timeout: 240_000,
      reuseExistingServer: false,
    },
  ],
});
