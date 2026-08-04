import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

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

import { LoginForm } from "@/components/entry/login-form";

function fillFirstAdmin() {
  fireEvent.change(screen.getByTestId("login-org-name"), { target: { value: "First Org" } });
  fireEvent.change(screen.getByTestId("login-admin-name"), { target: { value: "First Admin" } });
  fireEvent.change(screen.getByTestId("login-create-email"), { target: { value: "first@example.com" } });
  fireEvent.change(screen.getByTestId("login-create-password"), { target: { value: "correct-horse-battery-staple" } });
}

beforeEach(() => {
  bootstrapFirstUser.mockReset();
  login.mockReset();
  startSession.mockReset();
});

describe("first-user bootstrap on the real login page", () => {
  it("blank invite means first admin: create, login immediately, and persist the real session", async () => {
    bootstrapFirstUser.mockResolvedValueOnce({ userId: "user_1", orgId: "org_1", emailVerified: true });
    login.mockResolvedValueOnce({ sessionToken: "opaque", session: { userId: "user_1" } });
    render(<LoginForm state="default" />);
    fireEvent.click(screen.getByTestId("login-create-org"));
    fillFirstAdmin();

    expect(screen.getByTestId("login-create-org-submit")).toBeEnabled();
    fireEvent.click(screen.getByTestId("login-create-org-submit"));

    await waitFor(() => expect(bootstrapFirstUser).toHaveBeenCalledWith({
      email: "first@example.com",
      password: "correct-horse-battery-staple",
      displayName: "First Admin",
      orgName: "First Org",
    }));
    expect(login).toHaveBeenCalledWith("first@example.com", "correct-horse-battery-staple");
    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "opaque" }));
  });

  it("once bootstrap is unavailable, tries the submitted account then asks for an invite", async () => {
    bootstrapFirstUser.mockRejectedValueOnce(new ApiError(409, "BOOTSTRAP_UNAVAILABLE", {}));
    login.mockRejectedValueOnce(new ApiError(401, "LOGIN_REJECTED", {}));
    render(<LoginForm state="default" />);
    fireEvent.click(screen.getByTestId("login-create-org"));
    fillFirstAdmin();
    fireEvent.click(screen.getByTestId("login-create-org-submit"));

    await waitFor(() => expect(screen.getByTestId("login-create-org-error")).toHaveTextContent(
      "已有管理员，请输入 14 位邀请码",
    ));
    expect(login).toHaveBeenCalledWith("first@example.com", "correct-horse-battery-staple");
  });

  it("recovers login when bootstrap committed but its HTTP response was lost", async () => {
    bootstrapFirstUser.mockRejectedValueOnce(new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", {}));
    login.mockResolvedValueOnce({ sessionToken: "opaque", session: { userId: "user_1" } });
    render(<LoginForm state="default" />);
    fireEvent.click(screen.getByTestId("login-create-org"));
    fillFirstAdmin();
    fireEvent.click(screen.getByTestId("login-create-org-submit"));

    await waitFor(() => expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: "opaque" }),
    ));
    expect(bootstrapFirstUser).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith("first@example.com", "correct-horse-battery-staple");
  });

  it("does not strand the new admin when session creation is temporarily unavailable", async () => {
    bootstrapFirstUser.mockResolvedValueOnce({ userId: "user_1", orgId: "org_1", emailVerified: true });
    login.mockRejectedValueOnce(new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", {}));
    render(<LoginForm state="default" />);
    fireEvent.click(screen.getByTestId("login-create-org"));
    fillFirstAdmin();
    fireEvent.click(screen.getByTestId("login-create-org-submit"));

    await waitFor(() => expect(screen.getByTestId("login-error")).toHaveTextContent(
      "管理员已创建，请点击登录重试",
    ));
    expect(screen.getByTestId("login-email")).toHaveValue("first@example.com");
    expect(screen.getByTestId("login-password")).toHaveValue("correct-horse-battery-staple");
    expect(bootstrapFirstUser).toHaveBeenCalledTimes(1);
  });
});
