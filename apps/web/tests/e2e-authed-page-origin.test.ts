import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vitest";
import type { Page } from "@playwright/test";
import {
  __resetHandedOutThreadIdsForTest,
  acquireFreshThread,
  sessionHeaders,
} from "../e2e/support/authoritative-thread";
import { ensureAuthedPageOrigin } from "../e2e/support/chat-path-coverage";

/**
 * issue #3129 的反证。
 *
 * 被证明的命题：**`context.newPage()` 出来的 page 停在 `about:blank`，在它上面读
 * `localStorage` 会抛 `SecurityError`**，于是 F6 的 setup 在第一步就死，被测路径零执行
 * （run 34227339184 / SHA `817a2b17b`，18.6s）。先给这个 page 一个真实 origin
 * （`ensureAuthedPageOrigin`）之后才拿得到 token。
 *
 * ## 为什么这层能证明，不用起真栈
 *
 * 出错的判据只有一条、且完全由浏览器决定：**opaque origin 的 document 不许访问
 * `localStorage`**。下面的 `AboutBlankPage` 逐字实现这一条（`evaluate` 在
 * `url() === "about:blank"` 时抛与实测同文的 `SecurityError`，导航之后才放行），
 * 于是「导航前读」与「导航后读」的差别在这一层就是确定的，不依赖时序。
 *
 * ⚠ 纪律（AGENTS.md「红 ≠ 跑过」）：每一条「修复前会红」的分支都**真的执行了旧次序**
 * 并断言它抛（`rejects.toThrow(/SecurityError/)`），不是只断言新次序好。
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** 浏览器那条规则的确定性替身：opaque origin ⇒ 读 `localStorage` 被拒。 */
class AboutBlankPage {
  private currentUrl = "about:blank";
  /** 导航记录——用来证明「拿 origin」只花一次导航，不是把登录又走了一遍。 */
  readonly navigations: string[] = [];
  private nextThreadId = 1;

  url(): string {
    return this.currentUrl;
  }

  asPage(): Page {
    const self = this;
    return {
      url: () => self.currentUrl,
      goto: async (url: string) => {
        self.navigations.push(url);
        self.currentUrl = `http://127.0.0.1:3000${url}`;
        return null;
      },
      evaluate: async () => {
        if (self.currentUrl === "about:blank") {
          throw new Error(
            "SecurityError: Failed to read the 'localStorage' property from 'Window': " +
              "Access is denied for this document.",
          );
        }
        return "fake-session-token";
      },
      request: {
        post: async () => {
          const threadId = `thread-${self.nextThreadId++}`;
          return { ok: () => true, status: () => 200, text: async () => "", json: async () => ({ threadId }) };
        },
        get: async () => ({ ok: () => true, status: () => 200, json: async () => ({ messages: [] }) }),
      },
    } as unknown as Page;
  }
}

describe("issue #3129 · 第二个 page 的 origin 必须先于读 token", () => {
  beforeEach(() => {
    __resetHandedOutThreadIdsForTest();
  });

  test("修复前的次序：about:blank 上取会话令牌抛 SecurityError", async () => {
    const page = new AboutBlankPage();
    await expect(sessionHeaders(page.asPage())).rejects.toThrow(/SecurityError/);
    // 这正是 F6 死在的那一步：建线程的第一件事就是取 token。
    await expect(acquireFreshThread(page.asPage())).rejects.toThrow(/SecurityError/);
    expect(page.navigations, "修复前这个 page 从没导航过，所以一直是 opaque origin").toEqual([]);
  });

  test("修复后的次序：先 ensureAuthedPageOrigin，再取 token 就拿得到", async () => {
    const page = new AboutBlankPage();
    await ensureAuthedPageOrigin(page.asPage());
    expect(page.navigations, "拿 origin 只花一次导航，且不是去 /login").toEqual(["/chat"]);

    const headers = await sessionHeaders(page.asPage());
    expect(headers).toEqual({ Authorization: "Bearer fake-session-token" });

    const threadId = await acquireFreshThread(page.asPage());
    expect(threadId, "取到 token 之后权威建线程才走得下去").toBeTruthy();
  });

  test("warmUpCopilotRuntimeRoute 那种 page.request 调用救不了（不改变 origin）", async () => {
    const page = new AboutBlankPage();
    // page.request.* 不经过页面 document——发多少次都还是 about:blank。
    await (page.asPage() as unknown as { request: { get: (u: string) => Promise<unknown> } })
      .request.get("/api/copilotkit/info");
    expect(page.url()).toBe("about:blank");
    await expect(sessionHeaders(page.asPage())).rejects.toThrow(/SecurityError/);
  });
});

describe("issue #3129 · 次序在源码里也被钉住", () => {
  const source = readFileSync(`${HERE}../e2e/support/chat-path-coverage.ts`, "utf8");

  test("openFreshDeepAgentThreadOnAuthedPage 里 ensureAuthedPageOrigin 排在建线程之前", () => {
    const body = /export async function openFreshDeepAgentThreadOnAuthedPage[\s\S]*?\n}\n/.exec(source)?.[0];
    expect(body, "找不到该 helper 的函数体").toBeTruthy();
    const originAt = body!.indexOf("ensureAuthedPageOrigin(page)");
    const createAt = body!.indexOf("openAuthoritativeFreshThread(page)");
    expect(originAt, "helper 必须先拿 origin（issue #3129）").toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    expect(originAt, "拿 origin 必须排在读 localStorage 的建线程之前").toBeLessThan(createAt);
  });
});
