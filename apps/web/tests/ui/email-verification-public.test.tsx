import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

const { apiRequest, startSession } = vi.hoisted(() => ({ apiRequest: vi.fn(), startSession: vi.fn() }));
// Registration 顶层调用 useSession（两条路径共用），因此依赖会话上下文，即使本文件只
// 覆盖默认（非 bootstrap）路径。真实运行时 SessionProvider 由 app/layout.tsx 的
// Providers 全局挂载；这里的用例只渲染组件，所以按 bootstrap-first-admin.test.tsx 的
// 同一方式打桩。
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ startSession }) }));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiRequest };
});

import { EmailVerification } from "@/components/entry/email-verification";
import { Registration } from "@/components/entry/registration";

beforeEach(() => {
  apiRequest.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registration verification queue", () => {
  function fillRegistration() {
    // open-self-serve-registration delta（issue #1929）：没有邀请码输入框了——默认路径
    // 就是开放注册，bootstrap 分支的覆盖在 bootstrap-first-admin.test.tsx。
    fireEvent.change(screen.getByLabelText("组织名称"), { target: { value: "Example Org" } });
    fireEvent.change(screen.getByLabelText("你的姓名"), { target: { value: "Lin" } });
    fireEvent.change(screen.getByLabelText("工作邮箱"), { target: { value: "lin@example.test" } });
    fireEvent.change(screen.getByLabelText("密码（至少 12 位）"), { target: { value: "correct-horse-battery-staple" } });
  }

  it("submits the signed registration API, then exposes queued and rate-limited resend states", async () => {
    vi.useFakeTimers();
    apiRequest
      .mockResolvedValueOnce({ userId: "user-1", orgId: "org-1", verificationDelivery: "queued" })
      .mockResolvedValueOnce({ verificationDelivery: "queued" });
    render(<Registration />);
    fillRegistration();
    await act(async () => {
      fireEvent.click(screen.getByTestId("registration-submit"));
      await Promise.resolve();
    });
    expect(screen.getByTestId("registration-verification-queued")).toBeInTheDocument();
    expect(apiRequest).toHaveBeenNthCalledWith(1, "/auth/register-open", expect.objectContaining({
      method: "POST", sessionToken: null, body: expect.objectContaining({ email: "lin@example.test" }),
    }));
    expect(screen.getByTestId("registration-verification-resend")).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByTestId("registration-verification-resend")).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("registration-verification-resend"));
      await Promise.resolve();
    });
    expect(screen.getByText("新邮件已排队，请检查收件箱。")).toBeInTheDocument();
    expect(apiRequest).toHaveBeenNthCalledWith(2, "/auth/email-verifications/resend", {
      method: "POST", sessionToken: null, body: { email: "lin@example.test" },
    });
    expect(screen.getByTestId("registration-verification-resend")).toBeDisabled();
    expect(screen.getByTestId("registration-verification-resend")).toHaveTextContent("60 秒后");
    vi.useRealTimers();
  });

  it("keeps resend retryable when the queue endpoint is unavailable", async () => {
    vi.useFakeTimers();
    apiRequest
      .mockResolvedValueOnce({ userId: "user-1", orgId: "org-1", verificationDelivery: "queued" })
      .mockRejectedValueOnce(new Error("offline"));
    render(<Registration />);
    fillRegistration();
    await act(async () => {
      fireEvent.click(screen.getByTestId("registration-submit"));
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await act(async () => {
      fireEvent.click(screen.getByTestId("registration-verification-resend"));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法重新发送");
    expect(screen.getByTestId("registration-verification-resend")).not.toBeDisabled();
    vi.useRealTimers();
  });
});

describe("public verification landing", () => {
  it("removes the bearer from history before the confirm request and renders completion", async () => {
    window.history.replaceState({}, "", "/auth/verify-email?token=secret-bearer&campaign=mail");
    apiRequest.mockImplementationOnce(async (_path: string, options: { body: { token: string } }) => {
      expect(window.location.href).not.toContain("secret-bearer");
      expect(window.location.search).toBe("?campaign=mail");
      expect(options.body.token).toBe("secret-bearer");
      return { status: "completed" };
    });
    render(<EmailVerification />);
    await waitFor(() => expect(screen.getByTestId("email-verification-status")).toHaveTextContent("现在可以返回"));
    expect(screen.getByTestId("email-verification-success")).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith("/auth/email-verifications/confirm", expect.objectContaining({ sessionToken: null }));
  });

  it("shows the same safe invalid state for an absent or rejected token", async () => {
    window.history.replaceState({}, "", "/auth/verify-email?token=expired");
    apiRequest.mockRejectedValueOnce(new ApiError(400, "VERIFICATION_LINK_INVALID", {}));
    render(<EmailVerification />);
    await waitFor(() => expect(screen.getByTestId("email-verification-status")).toHaveTextContent("重新申请"));
    expect(screen.getByTestId("email-verification-invalid")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});
