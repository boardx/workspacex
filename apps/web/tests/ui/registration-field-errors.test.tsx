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
 * 于是 `isBootstrapUnavailable` / `isRegistrationEmailTaken` 全为 false，掉进兜底文案。
 *
 * 后果不是"文案不好看"：**一个用户自己能改的输入错误被伪装成不可抗力**，
 * 他没有任何线索去改密码，只会重试到放弃。这组用例把它钉住。
 */
const { bootstrapFirstUser, login, registerWithInvite, startSession } = vi.hoisted(() => ({
  bootstrapFirstUser: vi.fn(),
  login: vi.fn(),
  registerWithInvite: vi.fn(),
  startSession: vi.fn(),
}));
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  bootstrapFirstUser,
  login,
  registerWithInvite,
}));
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

function fill(code: string) {
  if (code !== "") {
    fireEvent.change(screen.getByTestId("registration-code"), { target: { value: code } });
  }
  fireEvent.change(screen.getByTestId("registration-org-name"), { target: { value: "Org" } });
  fireEvent.change(screen.getByTestId("registration-display-name"), { target: { value: "Admin" } });
  fireEvent.change(screen.getByTestId("registration-email"), { target: { value: "a@example.test" } });
  fireEvent.change(screen.getByTestId("registration-password"), { target: { value: "short" } });
  fireEvent.submit(screen.getByTestId("registration-submit").closest("form")!);
}

beforeEach(() => {
  bootstrapFirstUser.mockReset();
  login.mockReset();
  registerWithInvite.mockReset();
  apiRequest.mockReset();
  startSession.mockReset();
});

describe("registration surfaces field-level 400s truthfully", () => {
  it("tells the first admin the password is too short instead of blaming the service", async () => {
    bootstrapFirstUser.mockRejectedValueOnce(validationFailure("password"));
    login.mockRejectedValueOnce(new ApiError(401, "INVALID_CREDENTIAL", {}));
    render(<Registration />);
    fill("");

    const error = await screen.findByTestId("registration-error");
    expect(error).toHaveTextContent("密码至少 12 位");
    // 这条才是回归的要害：绝不能再说成服务故障。
    expect(error).not.toHaveTextContent("创建服务暂时不可用");
  });

  it("names every offending field on the invite path too", async () => {
    apiRequest.mockRejectedValueOnce(validationFailure("password", "email"));
    render(<Registration />);
    fill("ABCD1234EFGH56");

    const error = await screen.findByTestId("registration-error");
    expect(error).toHaveTextContent("密码至少 12 位");
    expect(error).toHaveTextContent("邮箱格式不正确");
    expect(error).not.toHaveTextContent("注册暂时未完成");
  });

  it("keeps INVITE_CODE_INVALID indistinguishable — a reasonCode is not a validation failure", async () => {
    // ⚠ 服务端把「不存在 / 已核销 / 过期 / 已撤销」抹平成同一个响应；前端再分叉等于
    // 按命中率削减 14 位码的搜索空间。本条确保上面的字段级改动没有从旁边把这条打开。
    apiRequest.mockRejectedValueOnce(new ApiError(400, "INVITE_CODE_INVALID", {
      error: "bad_request", traceId: "trace-2",
    }));
    render(<Registration />);
    fill("ABCD1234EFGH56");

    const error = await screen.findByTestId("registration-error");
    expect(error).toHaveTextContent("邀请码无效");
    expect(error).not.toHaveTextContent("请检查：");
  });

  it("still reports a genuine outage as an outage", async () => {
    bootstrapFirstUser.mockRejectedValueOnce(new ApiError(503, null, { error: "internal_error" }));
    login.mockRejectedValueOnce(new ApiError(503, null, {}));
    render(<Registration />);
    fill("");

    await waitFor(() => expect(screen.getByTestId("registration-error"))
      .toHaveTextContent("创建服务暂时不可用"));
  });
});
