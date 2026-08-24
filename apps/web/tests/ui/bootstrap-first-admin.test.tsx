import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

/**
 * 2026-08-04：这组用例原本驱动 `LoginForm` 的**内联建组面板**（#452）。
 * 人类裁决「创建组织统一到 `/auth/register` 独立页」后，同一段 bootstrap 行为搬到了
 * `Registration`，本文件跟着改锚点。
 *
 * ⚠ **搬的是锚点，不是标准**：四条断言逐条保留——BOOTSTRAP_UNAVAILABLE 先试登录再
 * 提示已有管理员、响应丢失用 login 收敛、以及"账号已建但会话没起来"必须给可重试出口
 * 而不是把人晾在那儿。若哪天有人想删其中一条，那是**降低标准**，不是清理陈旧测试。
 *
 * ⚠ open-self-serve-registration delta（issue #1929）：触发方式从「邀请码留空」换成
 * 显式的「创建首位管理员」切换（`registration-bootstrap-toggle`）——`bootstrapFirstUser`
 * 本身不在本 delta 移除范围，只是不再靠一个已经不存在的邀请码输入框的空值触发。
 */
const { bootstrapFirstUser, login, startSession } = vi.hoisted(() => ({
  bootstrapFirstUser: vi.fn(),
  login: vi.fn(),
  startSession: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  bootstrapFirstUser,
  login,
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ startSession }),
}));

import { Registration } from "@/components/entry/registration";

function fillFirstAdmin() {
  // 显式切到 bootstrap 模式 —— 不再有邀请码输入框可以留空，切换按钮是唯一开关。
  fireEvent.click(screen.getByTestId("registration-bootstrap-toggle"));
  fireEvent.change(screen.getByTestId("registration-org-name"), { target: { value: "First Org" } });
  fireEvent.change(screen.getByTestId("registration-display-name"), { target: { value: "First Admin" } });
  fireEvent.change(screen.getByTestId("registration-email"), { target: { value: "first@example.com" } });
  fireEvent.change(screen.getByTestId("registration-password"), { target: { value: "correct-horse-battery-staple" } });
}

function submit() {
  fireEvent.submit(screen.getByTestId("registration-submit").closest("form")!);
}

beforeEach(() => {
  bootstrapFirstUser.mockReset();
  login.mockReset();
  startSession.mockReset();
});

describe("first-user bootstrap on the real registration page", () => {
  it("toggling to bootstrap mode creates the first admin, logs in immediately, and persists the real session", async () => {
    bootstrapFirstUser.mockResolvedValueOnce({ userId: "user_1", orgId: "org_1", emailVerified: true });
    login.mockResolvedValueOnce({ sessionToken: "opaque", session: { userId: "user_1" } });
    render(<Registration />);
    fillFirstAdmin();

    expect(screen.getByTestId("registration-submit")).toBeEnabled();
    expect(screen.getByTestId("registration-submit")).toHaveTextContent("创建首位管理员并登录");
    submit();

    await waitFor(() => expect(bootstrapFirstUser).toHaveBeenCalledWith({
      email: "first@example.com",
      password: "correct-horse-battery-staple",
      displayName: "First Admin",
      orgName: "First Org",
    }));
    expect(login).toHaveBeenCalledWith("first@example.com", "correct-horse-battery-staple");
    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "opaque" }));
  });

  it("once bootstrap is unavailable, tries the submitted account then points at open registration", async () => {
    bootstrapFirstUser.mockRejectedValueOnce(new ApiError(409, "BOOTSTRAP_UNAVAILABLE", {}));
    login.mockRejectedValueOnce(new ApiError(401, "LOGIN_REJECTED", {}));
    render(<Registration />);
    fillFirstAdmin();
    submit();

    await waitFor(() => expect(screen.getByTestId("registration-error")).toHaveTextContent(
      "已有管理员，本实例的首位管理员已经创建过，请改用上方的开放注册创建新组织。",
    ));
    expect(login).toHaveBeenCalledWith("first@example.com", "correct-horse-battery-staple");
  });

  it("recovers login when bootstrap committed but its HTTP response was lost", async () => {
    bootstrapFirstUser.mockRejectedValueOnce(new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", {}));
    login.mockResolvedValueOnce({ sessionToken: "opaque", session: { userId: "user_1" } });
    render(<Registration />);
    fillFirstAdmin();
    submit();

    await waitFor(() => expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: "opaque" }),
    ));
    // bootstrap 是一次性的：响应丢了也**不能**重发第二次，只能用 login 去问"到底谁赢了"。
    expect(bootstrapFirstUser).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith("first@example.com", "correct-horse-battery-staple");
  });

  it("does not strand the new admin when session creation is temporarily unavailable", async () => {
    bootstrapFirstUser.mockResolvedValueOnce({ userId: "user_1", orgId: "org_1", emailVerified: true });
    login.mockRejectedValueOnce(new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", {}));
    render(<Registration />);
    fillFirstAdmin();
    submit();

    // 账号事务已提交、会话没起来。原来在登录页时的出口是"把凭据留在登录表单里让他点登录"；
    // 现在人在独立注册页上，等价的诚实出口是明确告诉他账号已建、去登录页用同一组凭据登录。
    await waitFor(() => expect(screen.getByTestId("registration-error")).toHaveTextContent(
      "管理员已创建，请前往登录页用刚才的邮箱和密码登录",
    ));
    expect(bootstrapFirstUser).toHaveBeenCalledTimes(1);
  });
});
