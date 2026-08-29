/**
 * 核心旅程 ①：用户注册 → 落地到可用产品状态。
 *
 * `core-loop.spec.ts` 已经把「开放注册」的机制本身钉得很细（未验证不能登录、真实收发
 * 验证令牌、验证后放行、库侧 `orgRoles`/`orgNames`）。这条用例**不重复**那些断言，而是
 * 接着往前走一步——回答一个那个文件没有回答的问题：**注册完之后，这个人真的能开始
 * 用产品吗？**（不是只停在 `/projects` 这个 URL，而是核心入口——项目/聊天——真的可达、
 * 真的是这个人自己组织的数据，不是一片空白或者别人的东西）。
 *
 * 因此这里断言的是"注册"与"首次真实使用"之间的衔接，而不是重新验证注册机制本身。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

interface FreshUser {
  readonly orgName: string;
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
}

function freshUser(tag: string): FreshUser {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    orgName: `旅程①验收组织-${tag}-${unique}`,
    displayName: `旅程①管理员-${tag}`,
    email: `journey01-${tag}-${unique}@example.test`,
    password: `Journey01-${tag}-2026!`,
  };
}

async function registerOpen(page: Page, user: FreshUser): Promise<void> {
  await page.goto("/auth/register");
  // 不点 bootstrap-toggle：默认路径就是开放注册（registerNewAccount），与
  // core-loop.spec.ts 的「开放注册」用例同一条路径，不重新发明。
  await page.getByTestId("registration-org-name").fill(user.orgName);
  await page.getByTestId("registration-display-name").fill(user.displayName);
  await page.getByTestId("registration-email").fill(user.email);
  await page.getByTestId("registration-password").fill(user.password);
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("registration-verification-queued")).toBeVisible();
}

test("旅程①：开放注册出的新用户，验证邮箱、登录后能真的用上项目与个人 chat（不是停在一个空 URL）", async ({ page }) => {
  const user = freshUser("landing");
  await registerOpen(page, user);

  // ── 验证邮箱（真实收发，与 core-loop.spec.ts 同一条链路） ──────────────────
  // 这里不直接读库拿 token——本旅程刻意只走界面能给到的东西：注册页承诺过
  // 「已发出验证邮件」，用例走 API 侧的 `verificationQueued` 信号即可，真正的令牌
  // 消费路径已经在 core-loop.spec.ts 里被逐字验证过（含未验证不能登录的反证）。
  // 这里改用后端脚本读令牌，只是复用同一个已验证过的读口，不重复验证它本身。
  const { execFileSync } = await import("node:child_process");
  const { resolve } = await import("node:path");
  const root = resolve(__dirname, "../../..");
  const stdout = execFileSync(
    "pnpm",
    ["--filter", "@repo/api", "exec", "tsx", "scripts/core-loop-db.ts", "verification-token", user.email],
    { cwd: root, encoding: "utf8" },
  );
  const payload = /__CORE_LOOP_DB__(.*)/.exec(stdout)?.[1];
  expect(payload, "读取验证令牌失败——core-loop-db.ts 输出里没有找到可解析的 payload").toBeTruthy();
  const { token } = JSON.parse(payload!) as { token: string | null };
  expect(token, "新注册账号库里必须有一枚待核销的验证令牌").not.toBeNull();
  await page.goto(`/auth/verify-email?token=${token}`);
  await expect(page.getByTestId("email-verification-success")).toBeVisible();

  // ── 登录 ─────────────────────────────────────────────────────────────
  await page.goto("/login");
  await page.getByTestId("login-email").fill(user.email);
  await page.getByTestId("login-password").fill(user.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  // ── 真的能用：项目列表可达，是这个人自己的组织（不是别人的、不是硬编码空态骗过的） ──
  // `projects-list-empty` 是「这个新组织里确实还没有项目」的真实空态锚点（数据已加载
  // 完成、列表真的是空的）；`projects-list-empty-state` 是加载中/出错那个不同的态，
  // 两者是不同分支（`projects-screen.tsx`），锚错会一直等不到。
  await expect(page.getByTestId("projects-list-empty")).toBeVisible();

  // ── 真的能用：个人 chat（无 projectId）真实可达，发一条消息、消息真的进了会话 ──
  // 这一步是本旅程与 core-loop.spec.ts 分工的关键差异点：那个文件从不带一个刚注册
  // 的账号走进 chat，这里补上——证明「注册」与「日常使用入口」之间没有断层。
  // ⚠ 只 fill 输入框、断言 toHaveValue，只证明了"文本框是个可交互的 DOM 元素"，
  //   证不到"发送"这个动作真的做了什么——改成真的点发送，断言发出去的这条消息
  //   真的进了 `copilotkit-v2-messages` 列表（不是留在输入框里没发出去）。
  //   agent **回复**这一段，实测（见下面独立的 `test.fail` 用例）在"刚注册的全新
  //   组织"这个场景下是真的会失败的一个产品缺口，不在这条主链路断言里，免得
  //   一个未解决的缺口把"注册→登录→项目/组织可达"这条已经成立的链路也一起判红。
  await page.goto("/chat");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  const draft = "刚注册就能用的第一句话";
  await page.getByTestId("copilotkit-v2-input").fill(draft);
  const messages = page.getByTestId("copilotkit-v2-messages");
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(messages).toContainText(draft, { timeout: 20_000 });

  // ── 反证收口：这个组织确实是刚建出来的，不是撞见了别的种子组织 ─────────────────
  // 组织切换菜单里能看到这个新建组织的名字，证明当前会话真的绑定在它上面，不是
  // 落在了 bootstrap 顺手建的 personal-local 组织或别的什么地方。
  await page.getByTestId("org-switcher").click();
  await expect(page.getByTestId("org-menu")).toBeVisible();
  await expect(page.getByTestId("org-menu").getByText(user.orgName)).toBeVisible();
});

/**
 * #2318 —— 真实实测（2 次独立复现，非偶发）：刚注册的全新组织，第一次在个人 chat
 * 发消息，`POST /api/copilotkit/agent/default/run` 的 SSE 响应里是一个 `RUN_ERROR`，
 * `message` 字段字面包着一整页 Next.js 404 HTML——说明请求根本没到 apps/api，界面
 * 上表现为「正在思考…」之后弹出「这次执行没有成功，请重试或联系管理员」。
 *
 * 与 `AGENTS.md`「缺口要可见、有名字、会在 doctor 里出现」同一条纪律（`core-loop
 * .spec.ts`/`skill-agent-import-usecase-audit.spec.ts` 同款用法）：用 `test.fail()`
 * 而不是把这个断言塞回上面那条主链路用例——那样会让一个尚未解决的产品缺口，把
 * "注册→验证→登录→项目/组织可达"这条已经成立的链路也一起拖红，制造"注册整个坏了"
 * 的假象。这里单独开一条**预期失败**的用例：现在稳定红，`#2318` 修好后 Playwright
 * 会报 "expected to fail but passed"，逼人把它翻正成真断言（同 core-loop.spec.ts
 * 头注说的那条纪律，不重复贴一遍）。
 */
test("旅程①附：刚注册的全新组织，个人 chat 第一条消息真的收到 agent 回复（#2318 已知缺口）", async ({ page }) => {
  test.fail();
  const user = freshUser("reply-gap");
  await registerOpen(page, user);

  const { execFileSync } = await import("node:child_process");
  const { resolve } = await import("node:path");
  const root = resolve(__dirname, "../../..");
  const stdout = execFileSync(
    "pnpm",
    ["--filter", "@repo/api", "exec", "tsx", "scripts/core-loop-db.ts", "verification-token", user.email],
    { cwd: root, encoding: "utf8" },
  );
  const payload = /__CORE_LOOP_DB__(.*)/.exec(stdout)?.[1];
  const { token } = JSON.parse(payload!) as { token: string | null };
  await page.goto(`/auth/verify-email?token=${token}`);
  await expect(page.getByTestId("email-verification-success")).toBeVisible();

  await page.goto("/login");
  await page.getByTestId("login-email").fill(user.email);
  await page.getByTestId("login-password").fill(user.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/chat");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await page.getByTestId("copilotkit-v2-input").fill("刚注册就能用的第一句话");
  const messages = page.getByTestId("copilotkit-v2-messages");
  await page.getByTestId("copilotkit-v2-send").click();
  // 与 loopback-model-provider.ts 的 `REPLY_PREFIX` 同源——这个前缀只会出现在
  // assistant 那一侧的气泡里，不会被用户自己发的原文字面撞上。
  await expect(messages).toContainText(FULLSTACK_E2E.agentReplyPrefix, { timeout: 20_000 });
});
