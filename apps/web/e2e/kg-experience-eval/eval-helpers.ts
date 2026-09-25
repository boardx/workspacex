/**
 * phase-18 F15 记忆体验评测集的共用动作：登录、开新对话、说一句话并等这一轮说完、读记忆（只为「等后台记完」，
 * 不拿来判分）、留证据。
 *
 * **判分只看用户看得见的东西**（06-UX R4「每条检查都是真浏览器里一个用户看得见的结果」）：回答正文、回答下方的
 * 引用 / 已记下 / 卡片、右栏记忆面板、来源抽屉、大脑页。读接口只用在两处，且都不是判分：
 *   - 等后台抽取记完（记忆是异步形成的；不等就问，测的是抽取 worker 的轮询间隔，不是记忆）；
 *   - E9 的越权检查本身就要看状态码（06-UX R4 E9 原文「返回 403」）。
 */
import { expect, type Locator, type Page } from "@playwright/test";
import cases from "./cases.json";
import type { KgEvalAccount } from "./fixture";

export const CASES = cases;
export type SayKey = keyof typeof cases.says;
export const sayText = (key: SayKey): string => cases.says[key].say;

const API = "/__fullstack_api";

export async function login(page: Page, account: KgEvalAccount): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(account.email);
  await page.getByTestId("login-password").fill(account.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function bearer(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  if (!token) throw new Error("not logged in: no wsx.sessionToken");
  return token;
}

/** 以当前登录的人调一个真接口（同源代理 → 真 API）。 */
export async function apiGet(page: Page, path: string): Promise<{ status: number; body: unknown }> {
  const res = await page.request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${await bearer(page)}` } });
  const text = await res.text();
  let body: unknown = null;
  try { body = text.length > 0 ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status(), body };
}

/** 开一条新的个人对话（界面上的「新对话」），返回它的 id。 */
export async function newThread(page: Page): Promise<string> {
  if (!new URL(page.url()).pathname.startsWith("/chat")) {
    await page.goto("/chat");
  }
  const create = page.getByTestId("chat-thread-create");
  await expect(create).toBeVisible();
  const before = new URL(page.url()).pathname;
  await create.click();
  await page.waitForURL((url) => /^\/chat\/[^/]+$/.test(url.pathname) && url.pathname !== before);
  const threadId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  // 新对话是空的：等上一段对话的消息从界面上撤干净，免得 say() 把旧回答当成这一轮的。
  await expect(page.getByTestId("copilot-assistant-message")).toHaveCount(0, { timeout: 15_000 });
  return threadId;
}

export interface TurnResult {
  /** 这一轮回答那条消息（落库后的 id）。 */
  readonly answerId: string;
  /** 这一轮回答在界面上的那一行。 */
  readonly answer: Locator;
  /** 回答正文（用户看到的字）。 */
  readonly text: string;
  /** 按下发送到回答第一个字出现在界面上的毫秒数。 */
  readonly firstTokenMs: number;
}

/**
 * 在当前对话里说一句话，等这一轮说完（run 结束、回答落库、回答下方的记忆行加载过一次）。
 * 用 Enter 发送（键盘，不是点击——E1 数的是点击）。
 */
export async function say(page: Page, text: string): Promise<TurnResult> {
  const answers = page.getByTestId("copilot-assistant-message");
  const before = await answers.count();
  const input = page.getByTestId("copilotkit-v2-input");
  await input.fill(text);
  // R1 修订：新对话刚建好时输入框已可见、发送还没就绪，这时按回车什么都不会发生（R1 里 E5 旅程因此卡在第一句）。
  // 等「发送」可用再按——这是人也会等的那一下，不放宽任何检查。
  await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled({ timeout: 30_000 });
  const run = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/api\/copilotkit\/agent\/[^/]+\/run(?:\?|$)/.test(r.url()),
    { timeout: 120_000 },
  );
  const sentAt = Date.now();
  await input.press("Enter");
  const answer = answers.nth(before);
  // 首字：回答那一行里出现第一个非空白字符。
  await expect.poll(async () => ((await answer.count()) > 0 ? (await answer.innerText()).trim().length : 0), {
    timeout: 120_000, intervals: [10],
  }).toBeGreaterThan(0);
  const firstTokenMs = Date.now() - sentAt;
  const response = await run;
  expect(response.status(), "这一轮 run 请求必须成功").toBe(200);
  const events = (await response.text()).split(/\r?\n/).filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)) as { type?: string; name?: string; value?: { runId?: string } });
  expect(events.some((e) => e.type === "RUN_ERROR"), "这一轮不能报错").toBe(false);
  const runId = events.find((e) => e.type === "CUSTOM" && e.name === "execution_event")?.value?.runId;
  expect(runId, "这一轮要有 run id").toEqual(expect.any(String));
  const run2 = await apiGet(page, `/agent-runs/${runId}`);
  const body = run2.body as { status: string; resultMessageId: string | null };
  expect(body.status).toBe("succeeded");
  expect(body.resultMessageId).toEqual(expect.any(String));
  return { answerId: body.resultMessageId!, answer, text: (await answer.innerText()).trim(), firstTokenMs };
}

interface ThreadKnowledgeBody {
  readonly claims: ReadonlyArray<{ id: string; statement: string; status: string }>;
}

/** 等后台把这条对话记到至少 n 条（抽取是异步的）。返回记下的原文。 */
export async function waitForMemories(page: Page, threadId: string, n: number): Promise<ThreadKnowledgeBody["claims"]> {
  let claims: ThreadKnowledgeBody["claims"] = [];
  await expect.poll(async () => {
    const r = await apiGet(page, `/knowledge-graph/threads/${threadId}`);
    claims = r.status === 200 ? (r.body as ThreadKnowledgeBody).claims : [];
    return claims.length;
  }, { timeout: 90_000, intervals: [500] }).toBeGreaterThanOrEqual(n);
  // 投影 worker 也是 2s 一轮：给图路一个轮次把新结论投进 AGE（关系题要走图）。
  await page.waitForTimeout(2_500);
  return claims;
}

export async function claimIdOf(page: Page, threadId: string, statement: string): Promise<string> {
  const r = await apiGet(page, `/knowledge-graph/threads/${threadId}`);
  const hit = (r.body as ThreadKnowledgeBody).claims.find((c) => c.statement === statement);
  if (!hit) throw new Error(`没有记下：${statement}`);
  return hit.id;
}

/** 说完一组话，并等这些话里的每一条都记下来。 */
export async function tell(page: Page, threadId: string, keys: readonly SayKey[]): Promise<void> {
  let expected = 0;
  for (const k of keys) {
    await say(page, sayText(k));
    expected += cases.says[k].extract.claims.length;
  }
  await waitForMemories(page, threadId, expected);
}

/** 右栏「记忆」页签。 */
export async function openMemoryPanel(page: Page): Promise<Locator> {
  const panel = page.getByTestId("kg-panel");
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByTestId("chat-task-workbench-inspector-tab-memory").click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

/** 回答下方那一块（引用 / 卡片 / 已记下）的全部可见文字。 */
export async function answerFooterText(answer: Locator): Promise<string> {
  return (await answer.locator("xpath=..").innerText()).trim();
}

/**
 * 回答下方挂的东西在 `copilot-assistant-message` 的父容器里（`TurnMemoryLine` 是气泡的兄弟节点）。
 * 等它加载出来（有引用 / 卡片 / 已记下之一，或确定什么都没有）。
 */
export function turnBlock(answer: Locator): Locator {
  return answer.locator("xpath=..");
}

/** E6 / R5 的用词表：界面上不许出现的内部术语。 */
export const FORBIDDEN_ZH = ["实体", "结论", "三态", "晋升", "L0", "L1", "本体", "知识面板"] as const;
/** 代码里的英文内部名（契约枚举值 / 动作名）——出现在界面上就是没翻译。 */
export const FORBIDDEN_EN = /\b(?:claim|claims|ontology|promote\w*|revoke\w*|supersede\w*|pending|confirmed|contested|proposed|accepted|chat_session|personal_space|proposeClaim|acceptClaim|confirmClaim|revokeClaim)\b/i;
