import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RecApp } from "@/components/rec/rec-app";
import { TranscriptionHistory } from "@/components/rec/transcription-history";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { mockIdentity } from "@/lib/identity";
import type { SessionContextValue } from "@/components/session/session-provider";

/**
 * #1057 —— `/rec` 个人转录必须由**真实 SessionProvider** 门禁，不许有第二条身份来源。
 *
 * 这个文件刻意**不 mock** `@/components/shell/app-shell`，也**不 mock**
 * `@/lib/live-personal-transcriptions`：`realtime-transcription-history.test.tsx` 把两者
 * 都换成了直通替身（"authentication belongs to shell tests"），于是「历史页会不会绕过
 * 会话门禁 / 会不会带着别人的 bearer 发请求」这两件事在全仓没有任何一条用例盯着——
 * #1057 复现出来的正是这一类：页面看起来是登录态，请求打到 API 才失败。
 *
 * 所以这里走真壳 + 真 API 客户端，只替换两处**外部世界**：`next/navigation`（jsdom 没有
 * 路由）与 `useOptionalSession`（会话真值由本用例给定，这正是被测的输入）。
 * 断言落在**发出去的 HTTP 请求**上，不落在组件内部状态——静态痕迹 ≠ 动态事实。
 */

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const sessionContext = vi.hoisted(() => ({ current: null as SessionContextValue | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/rec",
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => sessionContext.current,
}));

// 实时 ASR 需要 WebSocket / AudioWorklet，本文件的用例都停在"还没开始录"之前。
vi.mock("@/lib/BoardxRealtimeAsrClient", () => ({ openBoardxRealtimeAsr: vi.fn() }));

const STALE_TOKEN = "stale-token-from-a-previous-user";

function sessionWithout(status: SessionContextValue["status"]): SessionContextValue {
  return {
    status,
    session: null,
    identity: null,
    organizations: [],
    error: null,
    startSession: vi.fn(),
    switchOrganization: vi.fn(),
    retry: vi.fn(),
    logout: vi.fn(),
    updateDisplayName: vi.fn(),
    updateOrgName: vi.fn(),
    updateAvatarUrl: vi.fn(),
  } as unknown as SessionContextValue;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  navigation.replace.mockReset();
  window.localStorage.clear();
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/recording/realtime-asr/tags")
      ? { tags: [] }
      : { items: [], nextCursor: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 本次 render 期间所有出站请求真正带上的 Authorization 头。 */
function sentAuthorizationHeaders(): ReadonlyArray<string | undefined> {
  return fetchMock.mock.calls.map(([, init]) => {
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined;
    return headers?.Authorization;
  });
}

function renderPersonalRec() {
  return render(
    <RecApp
      // 原型残留：页面仍然把 mock 身份算好传进来。它**不得**成为第二条身份来源。
      identity={mockIdentity("org-yuanyang", "facilitator")}
      uiState="default"
      screen="prep"
      carrier="workshop"
      view="facilitator"
      qs={{}}
    />,
  );
}

describe("/rec 个人转录的会话门禁（#1057）", () => {
  it("真实会话没有 token 时不借用 localStorage 里的陈旧 bearer 发请求", async () => {
    // 上一位用户（或已登出的同一位）留在这台浏览器上的 token。
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, STALE_TOKEN);
    sessionContext.current = sessionWithout("dependency-failed");

    render(<TranscriptionHistory uiState="default" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // 没有真实会话 ⇒ 一个 Authorization 头都不该出现；带着陈旧 bearer 去问 API
    // 正是 #1057 里"页面像登录态、创建时才报通用错误"的来源。
    expect(sentAuthorizationHeaders().filter(Boolean)).toEqual([]);
    expect(sentAuthorizationHeaders().join("|")).not.toContain(STALE_TOKEN);
  });

  it("匿名会话下 /rec 不渲染任何可用的登录态外壳，并跳转 /login", async () => {
    sessionContext.current = sessionWithout("anonymous");

    renderPersonalRec();

    expect(screen.getByTestId("session-loading")).toBeVisible();
    // mock identity 若再被接回 AppShell，这三条会同时变红。
    expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rec-history-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rec-create-open")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(String(navigation.replace.mock.calls[0]?.[0])).toMatch(/^\/login/);
  });

  it("依赖失败时 /rec 渲染标准依赖失败态，而不是可提交的创建界面", () => {
    sessionContext.current = sessionWithout("dependency-failed");

    renderPersonalRec();

    expect(screen.getByTestId("session-dependency-failed")).toBeVisible();
    expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rec-create-open")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
