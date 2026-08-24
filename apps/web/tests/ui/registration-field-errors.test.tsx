import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

/**
 * 2026-08-05 的真实事故：人类在 devapp 上建首位管理员，密码不足
 * `AUTH_POLICY.passwordMinLen`，界面告诉他**「创建服务暂时不可用，请稍后重试」**。
 *
 * 成因：`ZodBodyPipe` 的校验失败经 `all-exceptions.filter.ts` 写成
 * `{ error: "validation_failed", fields: [...] }` —— **没有 `reasonCode`**，
 * 于是 `isRegistrationEmailTaken` 为 false，掉进兜底文案。
 *
 * 后果不是"文案不好看"：**一个用户自己能改的输入错误被伪装成不可抗力**，
 * 他没有任何线索去改密码，只会重试到放弃。这组用例把它钉住。
 *
 * ⚠ open-self-serve-registration delta（issue #1929）：默认路径不再靠"邀请码留空"触发
 * 冷启动分支，改为显式的「创建首位管理员」切换（见 `registration.tsx` 头注）；
 * `registerWithInvite`/`redeemInviteAndCreateOrg` 随之整体移除。这组用例只覆盖
 * **默认（非 bootstrap）路径**，冷启动分支的覆盖仍在 `bootstrap-first-admin.test.tsx`。
 * `useSession` 仍需打桩——组件在两条路径共用同一顶层 hook 调用。
 */
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const { startSession } = vi.hoisted(() => ({ startSession: vi.fn() }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiRequest };
});
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ startSession }) }));

import { Registration } from "@/components/entry/registration";

/** 后端 `ContractValidationError` 的真实线上形状：path + zod code，从不回传提交的值。 */
function validationFailure(...paths: string[]) {
  return new ApiError(400, null, {
    error: "validation_failed",
    traceId: "trace-1",
    fields: paths.map((path) => ({ path, code: "too_small" })),
  });
}

function fill() {
  fireEvent.change(screen.getByTestId("registration-org-name"), { target: { value: "Org" } });
  fireEvent.change(screen.getByTestId("registration-display-name"), { target: { value: "Admin" } });
  fireEvent.change(screen.getByTestId("registration-email"), { target: { value: "a@example.test" } });
  fireEvent.change(screen.getByTestId("registration-password"), { target: { value: "short" } });
  fireEvent.submit(screen.getByTestId("registration-submit").closest("form")!);
}

beforeEach(() => {
  apiRequest.mockReset();
});

describe("registration surfaces field-level 400s truthfully", () => {
  it("names every offending field instead of blaming the service", async () => {
    apiRequest.mockRejectedValueOnce(validationFailure("password", "email"));
    render(<Registration />);
    fill();

    const error = await screen.findByTestId("registration-error");
    expect(error).toHaveTextContent("密码至少 12 位");
    expect(error).toHaveTextContent("邮箱格式不正确");
    // 这条才是回归的要害：绝不能再说成服务故障。
    expect(error).not.toHaveTextContent("创建服务暂时不可用");
  });

  it("tells the user the email is taken, distinctly from a generic failure", async () => {
    apiRequest.mockRejectedValueOnce(new ApiError(409, "EMAIL_TAKEN", {
      error: "conflict", traceId: "trace-2",
    }));
    render(<Registration />);
    fill();

    const error = await screen.findByTestId("registration-error");
    expect(error).toHaveTextContent("该邮箱已注册，请返回登录。");
  });

  it("still reports a genuine outage as an outage", async () => {
    apiRequest.mockRejectedValueOnce(new ApiError(503, null, { error: "internal_error" }));
    render(<Registration />);
    fill();

    await waitFor(() => expect(screen.getByTestId("registration-error"))
      .toHaveTextContent("注册暂时未完成"));
  });

  it("has no invite-code input at all -- decision ④, issue #1929", () => {
    render(<Registration />);
    expect(screen.queryByTestId("registration-code")).toBeNull();
  });

  it("posts to /auth/register-open by default, not the removed /auth/register", async () => {
    apiRequest.mockResolvedValueOnce({ userId: "u", orgId: "o", verificationDelivery: "queued" });
    render(<Registration />);
    fill();
    await screen.findByTestId("registration-verification-queued");
    expect(apiRequest).toHaveBeenCalledWith("/auth/register-open", expect.objectContaining({
      method: "POST", sessionToken: null,
    }));
  });
});
