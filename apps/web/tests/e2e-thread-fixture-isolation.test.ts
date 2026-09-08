import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vitest";
import type { Page } from "@playwright/test";
import {
  __resetHandedOutThreadIdsForTest,
  acquireFreshThread,
} from "../e2e/support/authoritative-thread";

/**
 * issue #3118 的反证。
 *
 * 被证明的命题：**「点『新建对话』按钮 ⇒ 拿到一条干净的新线程」不成立**，
 * 因此每一个靠点按钮建线程的 e2e helper 都可能落到别的用例刚建出来的线程上；
 * 换成权威端口（`POST /chat/threads/mutate`，`op: "create"`）之后不会。
 *
 * ## 为什么这层能证明，不用起真栈
 *
 * 复用规则完全长在前端 `copilotkit-v2-shell.tsx` 的 `handleCreate` 里，且只有一条：
 * 「分组最上面那条 `status === "not-started"` 就直接进那一条，否则才建新的」。
 * 本文件的 `FakeChatBackend.clickCreateButton()` 逐字实现这一条（见其头注的源码引用），
 * 于是「按钮」与「端口」的差别在这一层就是确定的、可复现的，不依赖并发时序。
 *
 * ⚠ 纪律（AGENTS.md「红 ≠ 跑过」）：本文件里每一条「修复前会红」的分支都**真的执行了
 * 旧路径**并断言它坏（`expect(...).toBe(sameId)`），不是只断言新路径好——只断言新路径好
 * 的门控无法区分「修好了」与「反证本身就没跑」。
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

interface FakeThread {
  readonly id: string;
  status: "not-started" | "in-progress";
  readonly messages: string[];
  readonly createdAt: number;
}

/**
 * 产品线程列表 + 那颗按钮的复用语义的确定性替身。
 *
 * `clickCreateButton` 逐字对应 `apps/web/components/chat/copilotkit-v2-shell.tsx`
 * 的 `handleCreate`：
 *
 * ```ts
 * const topCard = threads?.groups[0]?.cards[0];
 * if (topCard?.status === "not-started") { …进那一条，直接 return… }
 * const result = await createWorkbenchThread(projectId);
 * ```
 */
class FakeChatBackend {
  private readonly threads: FakeThread[] = [];
  private nextId = 1;
  private clock = 0;

  /** 权威端口 `POST /chat/threads/mutate`（`op: "create"`）：永远建新的。 */
  createViaApi(): string {
    const thread: FakeThread = {
      id: `thread-${this.nextId++}`,
      status: "not-started",
      messages: [],
      createdAt: this.clock++,
    };
    this.threads.push(thread);
    return thread.id;
  }

  /** UI「新建对话」按钮：顶部已是空线程就复用它（#2094 裁决，产品的正确行为）。 */
  clickCreateButton(): string {
    const topCard = [...this.threads].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (topCard?.status === "not-started") return topCard.id;
    return this.createViaApi();
  }

  /** 用例往线程里发一句话——线程随即不再是 `not-started`。 */
  send(threadId: string, text: string): void {
    const thread = this.mustFind(threadId);
    thread.messages.push(text);
    thread.status = "in-progress";
  }

  messagesOf(threadId: string): readonly string[] {
    return this.mustFind(threadId).messages;
  }

  private mustFind(threadId: string): FakeThread {
    const thread = this.threads.find((one) => one.id === threadId);
    if (!thread) throw new Error(`不存在的线程 ${threadId}`);
    return thread;
  }

  /** 把这个替身包成 `acquireFreshThread` 需要的那一小片 Playwright `Page` 面。 */
  asPage(): Page {
    const backend = this;
    return {
      // 这个替身模拟的是「已登录、已在应用页面上」的 page——#3129 的 origin 守卫据此放行。
      url: () => "http://127.0.0.1:3000/chat",
      evaluate: async () => "fake-session-token",
      request: {
        post: async (url: string) => {
          expect(url, "helper 必须打权威端口，不是别的路子").toBe("/chat/threads/mutate");
          const threadId = backend.createViaApi();
          return { ok: () => true, status: () => 200, text: async () => "", json: async () => ({ threadId }) };
        },
        get: async (url: string) => {
          const threadId = /\/chat\/threads\/([^/]+)\/messages/.exec(url)?.[1] ?? "";
          return {
            ok: () => true,
            status: () => 200,
            json: async () => ({ messages: backend.messagesOf(threadId).map((text) => ({ text })) }),
          };
        },
      },
    } as unknown as Page;
  }
}

/** 点按钮那条旧路径的等价物（旧 `openFreshThread` 的全部实质：点、等 URL 变、取 id）。 */
function openFreshThreadViaButton(backend: FakeChatBackend): string {
  return backend.clickCreateButton();
}

describe("issue #3118 · 建线程夹具的线程隔离", () => {
  beforeEach(() => {
    __resetHandedOutThreadIdsForTest();
  });

  test("修复前：上一条用例留下一条未使用空线程时，点按钮拿到的是那条旧线程", () => {
    const backend = new FakeChatBackend();

    // 上一条用例：建了线程但一句话都没发（setup 就红了 / 只做了可见性断言）。
    const leftover = openFreshThreadViaButton(backend);
    expect(backend.messagesOf(leftover)).toHaveLength(0);

    // 下一条用例：点「新建对话」——按设计复用顶部那条空线程。
    const supposedlyFresh = openFreshThreadViaButton(backend);
    expect(
      supposedlyFresh,
      "这就是 #3118 的缺陷：按钮返回的是上一条用例留下的线程",
    ).toBe(leftover);
  });

  test("修复后：同样的情形下走权威端口拿到的是一条全新的空线程", async () => {
    const backend = new FakeChatBackend();
    const page = backend.asPage();

    const leftover = await acquireFreshThread(page);
    expect(backend.messagesOf(leftover)).toHaveLength(0);

    const fresh = await acquireFreshThread(page);
    expect(fresh).not.toBe(leftover);
    expect(backend.messagesOf(fresh)).toHaveLength(0);
  });

  test("helper 内部的『是新的 + 是空的』断言真的会红（不是恒真门）", async () => {
    const backend = new FakeChatBackend();
    const page = backend.asPage();
    const reused = await acquireFreshThread(page);
    backend.send(reused, "上一条用例的消息");

    // 造一个「端口把用过的线程又发一遍」的后端，证明两条断言各自都能红。
    const replaying = {
      ...page,
      request: {
        ...(page as unknown as { request: Record<string, unknown> }).request,
        post: async () => ({
          ok: () => true, status: () => 200, text: async () => "",
          json: async () => ({ threadId: reused }),
        }),
      },
    } as unknown as Page;

    await expect(acquireFreshThread(replaying)).rejects.toThrow(/不是一条新线程/);
  });

  test("C4/D4 那对污染：修复前 D4 读到 C4 的哨兵，修复后读不到", async () => {
    const C4_SENTINEL = "E2E-CANVAS-GUIDANCE-6031";
    const D4_MESSAGE = "SKILL-STATES-1788868497811：随便聊一句就好";

    // —— 修复前：两条 spec 各点一次「新建对话」 ——
    const before = new FakeChatBackend();
    const c4Before = openFreshThreadViaButton(before);
    // D4 在 C4 发出消息之前点了新建（并发时序），顶部还是那条 not-started 空线程。
    const d4Before = openFreshThreadViaButton(before);
    expect(d4Before, "两条 spec 落在同一条线程上").toBe(c4Before);
    before.send(c4Before, C4_SENTINEL);
    before.send(d4Before, D4_MESSAGE);
    expect(
      before.messagesOf(d4Before).join(" "),
      "run 34221508209 实测形态：C4 的哨兵出现在 D4 的断言目标里",
    ).toContain(C4_SENTINEL);

    // —— 修复后：两条 spec 都走权威端口 ——
    const after = new FakeChatBackend();
    const page = after.asPage();
    const c4After = await acquireFreshThread(page);
    const d4After = await acquireFreshThread(page);
    expect(d4After).not.toBe(c4After);
    after.send(c4After, C4_SENTINEL);
    after.send(d4After, D4_MESSAGE);
    expect(after.messagesOf(d4After).join(" ")).not.toContain(C4_SENTINEL);
    expect(after.messagesOf(d4After)).toEqual([D4_MESSAGE]);
  });
});

describe("issue #3118 · 三个建线程 helper 都不再点按钮", () => {
  const read = (relative: string): string => readFileSync(`${HERE}${relative}`, "utf8");

  test("helper 里不再出现 chat-thread-create", () => {
    const fixture = read("../e2e/chat-task-workbench-fixture.ts");
    const coverage = read("../e2e/support/chat-path-coverage.ts");
    for (const [name, source] of [["chat-task-workbench-fixture.ts", fixture], ["support/chat-path-coverage.ts", coverage]] as const) {
      const clicks = source.match(/getByTestId\("chat-thread-create"\)/g) ?? [];
      expect(clicks, `${name} 里的建线程 helper 不许再点「新建对话」（issue #3118）`).toHaveLength(0);
    }
    // 三个 helper 都必须落到同一个权威入口上。
    expect(fixture).toContain("openAuthoritativeFreshThread");
    for (const helper of ["openFreshEchoAgentThread", "openFreshDeepAgentThreadOnAuthedPage"]) {
      expect(coverage, `${helper} 必须走权威端口`).toContain(helper);
    }
    expect((coverage.match(/openAuthoritativeFreshThread\(page\)/g) ?? []).length).toBe(2);
  });

  test("被测对象就是那颗按钮的 spec 仍然点按钮（这个门不能靠删干净来通过）", () => {
    for (const spec of [
      "../e2e/copilotkit-v2-roster-landing.spec.ts",
      "../e2e/copilotkit-v2-thread-persistence.spec.ts",
      "../e2e/copilotkit-v2-run-restore-after-switch.spec.ts",
      "../e2e/copilotkit-v2-skill-mount.spec.ts",
    ]) {
      expect(read(spec), `${spec} 的被测对象是按钮行为本身，不该改`)
        .toContain('getByTestId("chat-thread-create")');
    }
  });
});
