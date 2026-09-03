import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@repo/contracts";

/**
 * F21 找回密码第 4-5 步的接线证据（issue #2602）——之前只有第 2 步（发起请求）
 * 有落地页与测试（`password-reset-request.test.tsx`），消费重置链接、设置新密码
 * 的这一段完全没有页面，链接发出去也无处可落。
 *
 * ⚠ 同 `password-reset-request.test.tsx` 的既有纪律：打桩 `fetch` 而不是打桩
 * `@/lib/auth`，证明的是"真的有一个 HTTP 请求打到了签核过的那条路径"。
 */
import { ResetPassword } from "@/components/entry/reset-password";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe("reset-password page", () => {
  it("链接不完整（没有 token）⇒ 明确说明，不渲染表单", () => {
    render(<ResetPassword token={null} />);
    expect(screen.getByTestId("reset-password-missing-token")).toBeInTheDocument();
    expect(screen.queryByTestId("reset-password-form")).toBeNull();
  });

  it("提交真的打到签核过的 completePasswordReset 路径，带 token 与新密码", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ revokedSessionCount: 2 }));
    render(<ResetPassword token="tok-abc" />);

    fireEvent.change(screen.getByTestId("reset-password-pwd"), { target: { value: "a-brand-new-passphrase" } });
    fireEvent.change(screen.getByTestId("reset-password-confirm"), { target: { value: "a-brand-new-passphrase" } });
    fireEvent.click(screen.getByTestId("reset-password-submit"));

    await waitFor(() => expect(screen.getByTestId("reset-password-success")).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe(auth.operations.completePasswordReset.path);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ token: "tok-abc", newPassword: "a-brand-new-passphrase" });
    // 未登录的公共端点：不许把浏览器里恰好存在的 token 带出去。
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    // 契约字段，不是猜的文案。
    expect(screen.getByTestId("reset-password-success").textContent).toContain("2 台");
  });

  it("两次密码不一致 ⇒ 就地字段错误，且不发请求", async () => {
    render(<ResetPassword token="tok-abc" />);
    fireEvent.change(screen.getByTestId("reset-password-pwd"), { target: { value: "one-passphrase-here" } });
    fireEvent.change(screen.getByTestId("reset-password-confirm"), { target: { value: "another-passphrase" } });

    expect(screen.getByTestId("err-reset-password-confirm")).toBeInTheDocument();
    expect(screen.getByTestId("reset-password-submit")).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("RESET_TOKEN_INVALID（伪造与过期同码）⇒ 终态提示 + 返回登录页，没有重试按钮", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "auth_rejected", traceId: "t1", reasonCode: "RESET_TOKEN_INVALID" }, 401),
    );
    render(<ResetPassword token="tok-forged" />);
    fireEvent.change(screen.getByTestId("reset-password-pwd"), { target: { value: "a-brand-new-passphrase" } });
    fireEvent.change(screen.getByTestId("reset-password-confirm"), { target: { value: "a-brand-new-passphrase" } });
    fireEvent.click(screen.getByTestId("reset-password-submit"));

    await waitFor(() => expect(screen.getByTestId("reset-password-error")).toBeInTheDocument());
    expect(screen.getByTestId("reset-password-error").textContent).toContain("无效或已失效");
    expect(screen.getByTestId("reset-password-goto-login")).toBeInTheDocument();
    expect(screen.queryByTestId("reset-password-retry")).toBeNull();
  });

  it("弱密码 ⇒ 就地字段错误（服务端 400 校验拒绝，未消费令牌）", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "validation_failed", traceId: "t1", fields: [{ path: "newPassword", code: "TOO_SHORT" }] }, 400),
    );
    render(<ResetPassword token="tok-abc" />);
    fireEvent.change(screen.getByTestId("reset-password-pwd"), { target: { value: "short" } });
    fireEvent.change(screen.getByTestId("reset-password-confirm"), { target: { value: "short" } });
    fireEvent.click(screen.getByTestId("reset-password-submit"));

    await waitFor(() => expect(screen.getByTestId("err-reset-password-pwd")).toBeInTheDocument());
    expect(screen.getByTestId("err-reset-password-pwd").textContent).toContain("至少");
  });

  it("服务不可用 ⇒ 显式重试，且诚实说明令牌不会因此失效", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockResolvedValueOnce(jsonResponse({ revokedSessionCount: 0 }));
    render(<ResetPassword token="tok-abc" />);
    fireEvent.change(screen.getByTestId("reset-password-pwd"), { target: { value: "a-brand-new-passphrase" } });
    fireEvent.change(screen.getByTestId("reset-password-confirm"), { target: { value: "a-brand-new-passphrase" } });
    fireEvent.click(screen.getByTestId("reset-password-submit"));

    await waitFor(() => expect(screen.getByTestId("reset-password-error-unavailable")).toBeInTheDocument());
    expect(screen.getByTestId("reset-password-error-unavailable").textContent).toContain("不会消耗你的重置链接");

    fireEvent.click(screen.getByTestId("reset-password-retry"));
    await waitFor(() => expect(screen.getByTestId("reset-password-success")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
