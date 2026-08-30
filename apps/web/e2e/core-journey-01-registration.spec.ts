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
 * 根因：`apps/web/app/api/copilotkit/[[...slug]]/route.ts` 给 `HttpAgent` 拼出站
 * 地址时，`APP_API_PORT` 未设置、落到 `apiBaseUrl()` 的分支没有带上
 * `NEXT_PUBLIC_API_PATH_PREFIX`——本用例所在的 fullstack-smoke 环境恰好就是靠这个
 * prefix 做同源代理（`playwright.fullstack-smoke.config.ts`），请求因此落在 Next
 * 自己身上，拿到字面 404 HTML。修法在 `apps/web/lib/copilotkit-v2-agui-url.ts`
 * （`buildAguiUrl`，单测见同目录 `tests/copilotkit-v2-agui-url.test.ts`）：两个分支
 * 都不再假设“裸 origin 就是终点”。曾经用 `test.fail()` 把这条断言与主链路用例分开
 * （`AGENTS.md`「缺口要可见、有名字」纪律），现在翻正成真断言。
 */
test("旅程①附：刚注册的全新组织，个人 chat 第一条消息真的收到 agent 回复（#2318 已修复）", async ({ page }) => {
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
  const draft = "刚注册就能用的第一句话";
  await page.getByTestId("copilotkit-v2-input").fill(draft);
  const messages = page.getByTestId("copilotkit-v2-messages");
  await page.getByTestId("copilotkit-v2-send").click();
  // ⚠ CI 实测纠正（本 PR 首次推送即撞见）：`FULLSTACK_E2E.agentReplyPrefix`
  // （"[loopback]"）是 `loopback-model-provider.ts`（`dashscope`/`Configured
  // ModelProvider` 那条链路）的前缀，本用例走的默认「通用助手」pin 的是
  // `deep-agent` provider（#740），真正应答的是 `loopback-deep-agent-provider.ts`
  // ——那份替身没有固定前缀，默认模板是把用户原话整体嵌入回复正文（"根据查询结果
  // 回答你："${userText}" ——……"），与 `copilotkit-v2-skill-mount.spec.ts` 等既有
  // 用例断言同一个模板、不是发明一个新判据。
  await expect(messages).toContainText(`根据查询结果回答你："${draft}"`, { timeout: 20_000 });
});
