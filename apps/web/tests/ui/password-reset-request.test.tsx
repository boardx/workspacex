import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@repo/contracts";

/**
 * F21 找回密码第一步的接线证据（issue #469 的后半边；前半边"创建组织"随 #427 完成）。
 *
 * ⚠ **这里刻意打桩 `fetch` 而不是打桩 `@/lib/auth`。**
 * 打桩 `@/lib/auth.requestPasswordReset` 只能证明"组件调了那个函数"；
 * 本文件要证明的是"真的有一个 HTTP 请求打到了签核过的那条路径"——
 * 这正是接线前后的差别（接线前是 `onClick={() => setResetSent(true)}`，
 * 一个只改本地 state、零网络的假按钮，而任何 state 断言都照样绿）。
 */
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { LoginForm } from "@/components/entry/login-form";
import { SessionProvider } from "@/components/session/session-provider";

const fetchMock = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(okSent());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * 后端 `POST /auth/password-reset/request` 的**唯一**响应形状。
 * 契约把它写成 `{ sent: z.literal(true) }` 且 `err: []`——邮箱存在与否，
 * 线上返回的字节完全相同。所以本桩函数没有参数：它**无法**按邮箱变化，
 * 这与被测系统的真实约束一致。
 */
function okSent(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ sent: true }),
  } as unknown as Response;
}

async function submitForgot(email: string): Promise<string> {
  const view = render(<SessionProvider><LoginForm state="default" /></SessionProvider>);
  fireEvent.click(screen.getByTestId("login-forgot-link"));
  fireEvent.change(screen.getByTestId("login-forgot-email"), { target: { value: email } });
  fireEvent.click(screen.getByTestId("login-forgot-submit"));
  await waitFor(() => expect(screen.getByTestId("login-forgot-sent")).toBeInTheDocument());
  const text = screen.getByTestId("login-forgot-panel").textContent ?? "";
  view.unmount();
  return text;
}

describe("password reset request is wired to the real API", () => {
  it("issues a real POST to the signed reset path carrying the typed email", async () => {
    await submitForgot("lead@example.com");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe(auth.operations.requestPasswordReset.path);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ email: "lead@example.com" });
    // 未登录的公共端点：不许把浏览器里恰好存在的 token 带出去。
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("shows the sent panel only after the request resolves, not on click", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    render(<SessionProvider><LoginForm state="default" /></SessionProvider>);
    fireEvent.click(screen.getByTestId("login-forgot-link"));
    fireEvent.change(screen.getByTestId("login-forgot-email"), { target: { value: "lead@example.com" } });
    fireEvent.click(screen.getByTestId("login-forgot-submit"));

    // 请求还悬着——假按钮在这一刻就已经是"已发送"了，真接线不是。
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("login-forgot-sent")).toBeNull();

    resolve(okSent());
    await waitFor(() => expect(screen.getByTestId("login-forgot-sent")).toBeInTheDocument());
  });

  /**
   * 防枚举的机械保障。注册过的邮箱与没注册过的邮箱，**回显逐字相同**。
   * 这条一旦变红，说明有人在前端按响应/邮箱分叉了 UI——那是把一个
   * 不需要任何凭据的枚举信道从界面这一侧重新开出来，不是文案优化。
   */
  it("renders byte-identical copy for a registered and an unregistered address", async () => {
    const registered = await submitForgot("registered@example.com");
    const unregistered = await submitForgot("nobody-here@example.com");

    expect(registered).toBe(unregistered);
    expect(registered).toContain("若该邮箱已注册，重置邮件已发出。");
    // 两次都真的打了网络，不是第二次走了本地缓存分支。
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /**
   * 上一条只能管住"前端不分叉"。"后端不分叉"由契约在**类型层**兜住：
   * 成功形状是唯一的字面量，失败清单是空的——`sent: false` 或
   * `EMAIL_NOT_FOUND` 这类分支在类型上就没有位置可放。
   */
  it("keeps divergence unrepresentable in the signed contract itself", () => {
    expect(auth.operations.requestPasswordReset.err).toEqual([]);
    expect(auth.operations.requestPasswordReset.out.parse({ sent: true })).toEqual({ sent: true });
    expect(auth.operations.requestPasswordReset.out.safeParse({ sent: false }).success).toBe(false);
  });

  it("offers an honest retry when the request cannot be delivered", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<SessionProvider><LoginForm state="default" /></SessionProvider>);
    fireEvent.click(screen.getByTestId("login-forgot-link"));
    fireEvent.change(screen.getByTestId("login-forgot-email"), { target: { value: "lead@example.com" } });
    fireEvent.click(screen.getByTestId("login-forgot-submit"));

    await waitFor(() => expect(screen.getByTestId("login-forgot-error")).toHaveTextContent(
      "重置服务暂时不可用，请稍后重试",
    ));
    // 传输失败不能被伪装成"已发出"。
    expect(screen.queryByTestId("login-forgot-sent")).toBeNull();
    // 按钮可以再点一次，人不会被卡死在这一屏。
    expect(screen.getByTestId("login-forgot-submit")).toBeEnabled();
  });
});
