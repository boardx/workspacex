/**
 * #4789 —— 出站邮件回环替身的**自证**：产品真的把验证邮件发进了可观察的上游，内容可核对。
 *
 * 走的是既有产品链路（`POST /auth/register-open` → 邮件 outbox worker → `CloudflareEmailTransport`
 * → `CLOUDFLARE_API_BASE_URL` 指向的 `apps/api/scripts/loopback-mail-provider.ts`），不另造发信入口。
 * 后续要观察邀请等邮件的 spec 复用 `./support/mail-loopback` 即可。
 *
 * ① 正向：注册后替身里出现发给该邮箱的验证邮件；正文里的链接指向 web 服务的源，链接里的令牌
 *   与库里那枚待核销令牌**逐字相同**（不是「有一封邮件」的空断言）；点开链接真的完成验证（验证前登录被拒、验证后同一账号能登录）。
 * ② 反证：只对该收件人把替身置为 `reject`（真实 Cloudflare 风格 503）——产品确实尝试了发送
 *   （替身的 `rejected` 计数增加），而邮件**不**出现在收件箱里。证明替身看得见失败，
 *   也证明①的绿不是「什么都会通过」。
 *
 * 并行安全：每条用例用自己唯一的邮箱，故障按收件人限定；verify 邮件由 outbox worker 每 5s 投一封，
 * 所以等待窗口给得宽（排在其他 spec 的注册之后也投得出来）。
 */
import { expect, test } from "@playwright/test";
import { readVerificationToken } from "./core-loop-fixture";
import {
  extractFirstLink,
  getMailStats,
  listMail,
  setMailFault,
  waitForMail,
} from "./support/mail-loopback";

const API = "/__fullstack_api";
const DELIVERY_WINDOW_MS = 90_000;

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

function freshUser(tag: string) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    orgName: `邮件回环-${tag}-${unique}`,
    displayName: `邮件回环-${tag}`,
    email: `mail-loopback-${tag}-${unique}@example.test`,
    password: `MailLoopback-${tag}-2026!`,
  };
}

test("验证邮件进入回环收件箱：链接源正确、令牌与库里逐字一致、点开即验证", async ({ page, request, baseURL }) => {
  const user = freshUser("ok");
  const registration = await request.post(`${API}/auth/register-open`, { data: user });
  expect(registration.status()).toBe(201);

  const mail = await waitForMail({
    to: user.email,
    subjectIncludes: "Verify your WorkspaceX email",
    timeoutMs: DELIVERY_WINDOW_MS,
  });
  expect(mail.from).toBe("no-reply@mail.boardx.us");
  expect(mail.html).toContain("/auth/verify-email");

  const link = extractFirstLink(mail, "/auth/verify-email");
  expect(link.origin, "邮件链接必须指向 web 服务（APP_PUBLIC_URL），浏览器才打得开").toBe(new URL(baseURL!).origin);
  const token = link.searchParams.get("token");
  expect(token, "链接里必须带令牌").toBeTruthy();
  expect(token, "邮件里的令牌必须就是库里那枚待核销令牌").toBe(readVerificationToken(user.email).token);

  // 替身没有拒过任何一次鉴权：两个 transport 用的是各自正确的 token。
  expect((await getMailStats()).unauthorized).toBe(0);

  // 验证前：未验证的账号不能登录——这是「邮件里的令牌真的起作用」的对照。
  const before = await request.post(`${API}/auth/login`, { data: { email: user.email, password: user.password } });
  expect(before.ok(), "邮箱未验证时不应能登录").toBe(false);

  // 用 API 注册、再在一个全新页面打开邮件链接：页面没有「刚注册」的浏览器上下文，
  // 所以不会自动登录跳转，而是如实显示「邮箱已验证」（同一浏览器里走 UI 注册才会自动进 /projects）。
  await page.goto(link.toString());
  await expect(page.getByTestId("email-verification-success")).toBeVisible({ timeout: 30_000 });

  // 验证后：同一个账号用注册时的密码能登录——证明是邮件里的令牌完成了验证。
  const after = await request.post(`${API}/auth/login`, { data: { email: user.email, password: user.password } });
  expect(after.ok(), "点开邮件里的链接后应能登录").toBe(true);
});

test("反证：替身对该收件人 reject ⇒ 产品确实尝试发送，但收件箱里没有这封邮件", async ({ request }) => {
  const user = freshUser("reject");
  await setMailFault("reject", { to: user.email });
  try {
    const before = await getMailStats();
    const registration = await request.post(`${API}/auth/register-open`, { data: user });
    expect(registration.status()).toBe(201);

    await expect
      .poll(async () => (await getMailStats()).rejected, {
        message: "产品应当真的向上游发起过发送，并被替身拒绝",
        timeout: DELIVERY_WINDOW_MS,
        intervals: [500],
      })
      .toBeGreaterThan(before.rejected);
    expect(await listMail({ to: user.email }), "被拒绝的邮件不得出现在收件箱").toEqual([]);
  } finally {
    await setMailFault("none", { to: user.email });
  }
});
