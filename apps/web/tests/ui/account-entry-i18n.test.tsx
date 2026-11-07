import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { auth } from "@repo/contracts";
import { I18nProvider } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
const api = vi.hoisted(() => ({ request: vi.fn(), session: { status: "anonymous", startSession: vi.fn() } }));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => api.session }));
vi.mock("@/lib/api-client", async (original) => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: api.request }));
import { Registration } from "@/components/entry/registration";
import { EmailVerification } from "@/components/entry/email-verification";
import { ResetPassword } from "@/components/entry/reset-password";
const enteredText = "user-entered-phrase";
const values = { email: "person@example.test", password: enteredText, displayName: "原文 Alice", orgName: "原文 Org" };
function show(children: React.ReactNode) { return render(<I18nProvider initialLocale="en">{children}</I18nProvider>); }
function language(value: "en" | "zh-CN") { fireEvent.change(screen.getByTestId("language-switcher"), { target: { value } }); }
function fillRegistration() {
  for (const [id, value] of [["org-name", values.orgName], ["display-name", values.displayName], ["email", values.email], ["password", values.password]]) {
    fireEvent.change(screen.getByTestId(`registration-${id}`), { target: { value } });
  }
}
beforeEach(() => { api.request.mockReset(); api.session.startSession.mockReset(); localStorage.clear(); history.replaceState({}, "", "/"); });
afterEach(cleanup);
it("preserves registration values and request payload while retranslating a stored field failure", async () => {
  api.request.mockRejectedValueOnce(new ApiError(400, null, { error: "validation_failed", fields: [{ path: "password", code: "too_small" }] }));
  show(<Registration />);
  expect(screen.getByRole("heading", { name: "Create organization" })).toBeTruthy();
  expect(screen.getByText("Cocoon")).toBeTruthy();
  expect(screen.getByText("Build experience and knowledge")).toBeTruthy();
  fillRegistration();
  language("zh-CN");
  expect(screen.getByText("结茧")).toBeTruthy();
  expect(screen.getByText("积累经验与知识")).toBeTruthy();
  expect((screen.getByTestId("registration-password") as HTMLInputElement).value).toBe(enteredText);
  expect((screen.getByTestId("registration-display-name") as HTMLInputElement).value).toBe(values.displayName);
  language("en");
  fireEvent.submit(screen.getByTestId("registration-submit").closest("form")!);
  expect(await screen.findByText(`Please check: Password must contain at least ${auth.AUTH_POLICY.passwordMinLen} characters`)).toBeTruthy();
  expect(api.request).toHaveBeenCalledWith(auth.operations.registerNewAccount.path, expect.objectContaining({ method: "POST", sessionToken: null, body: values }));
  language("zh-CN");
  expect(screen.getByText(`请检查：密码至少 ${auth.AUTH_POLICY.passwordMinLen} 位`)).toBeTruthy();
  expect(api.request).toHaveBeenCalledTimes(1);
});
it("keeps the queued email original and does not resend on a locale switch", async () => {
  api.request.mockResolvedValueOnce(auth.operations.registerNewAccount.out.parse({ userId: "u1", orgId: "o1", verificationDelivery: "queued" }));
  show(<Registration />); fillRegistration();
  fireEvent.submit(screen.getByTestId("registration-submit").closest("form")!);
  expect(await screen.findByRole("heading", { name: "Verification email queued" })).toBeTruthy();
  expect(screen.getByText(values.email)).toBeTruthy();
  language("zh-CN");
  expect(screen.getByRole("heading", { name: "验证邮件已排队" })).toBeTruthy();
  expect(screen.getByText(values.email)).toBeTruthy();
  expect(screen.getByTestId("registration-verification-resend")).toBeDisabled();
  expect(api.request).toHaveBeenCalledTimes(1);
});
it("verifies the original token once and translates completion without another confirmation", async () => {
  history.replaceState({}, "", "/auth/verify-email?token=original-token");
  api.request.mockResolvedValueOnce(auth.operations.confirmEmailVerification.out.parse({ status: "completed" }));
  show(<EmailVerification />);
  expect(await screen.findByRole("heading", { name: "Email verified" })).toBeTruthy();
  expect(api.request).toHaveBeenCalledWith(auth.operations.confirmEmailVerification.path, expect.objectContaining({ body: { token: "original-token", autoStartSession: true } }));
  expect(new URL(location.href).searchParams.has("token")).toBe(false);
  language("zh-CN");
  expect(screen.getByRole("heading", { name: "邮箱已验证" })).toBeTruthy();
  expect(api.request).toHaveBeenCalledTimes(1);
});
it("preserves reset passwords while translating mismatch validation without a request", () => {
  show(<ResetPassword token="original-token" />);
  expect(screen.getByRole("heading", { name: "Reset password" })).toBeTruthy();
  fireEvent.change(screen.getByTestId("reset-password-pwd"), { target: { value: enteredText } });
  fireEvent.change(screen.getByTestId("reset-password-confirm"), { target: { value: "different-entry" } });
  expect(screen.getByText("Passwords do not match.")).toBeTruthy();
  language("zh-CN");
  expect(screen.getByText("两次输入的密码不一致。")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "重置密码" })).toBeTruthy();
  expect((screen.getByTestId("reset-password-pwd") as HTMLInputElement).value).toBe(enteredText);
  expect(api.request).not.toHaveBeenCalled();
});
it("retranslates an invalid reset-token failure without retrying or changing request values", async () => {
  api.request.mockRejectedValueOnce(new ApiError(400, "RESET_TOKEN_INVALID", null));
  show(<ResetPassword token="original-token" />);
  for (const id of ["pwd", "confirm"]) fireEvent.change(screen.getByTestId(`reset-password-${id}`), { target: { value: enteredText } });
  fireEvent.submit(screen.getByTestId("reset-password-form"));
  await waitFor(() => expect(screen.getByTestId("reset-password-error")).toHaveTextContent("This reset link is invalid"));
  expect(api.request).toHaveBeenCalledWith(auth.operations.completePasswordReset.path, expect.objectContaining({ sessionToken: null, body: { token: "original-token", newPassword: enteredText } }));
  language("zh-CN");
  expect(screen.getByTestId("reset-password-error")).toHaveTextContent("重置链接无效或已失效");
  expect(api.request).toHaveBeenCalledTimes(1);
});

it("treats unknown prototype-named validation fields as text instead of dictionary properties", async () => {
  api.request.mockRejectedValueOnce(new ApiError(400, null, { error: "validation_failed", fields: [{ path: "constructor", code: "invalid_type" }] }));
  show(<Registration />); fillRegistration();
  fireEvent.submit(screen.getByTestId("registration-submit").closest("form")!);
  expect(await screen.findByText("Please check: constructor does not meet the requirements")).toBeTruthy();
});

it("retranslates an unknown reset outcome without promising token reuse or replaying the request", async () => {
  api.request.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  show(<ResetPassword token="original-token" />);
  for (const id of ["pwd", "confirm"]) fireEvent.change(screen.getByTestId(`reset-password-${id}`), { target: { value: enteredText } });
  fireEvent.submit(screen.getByTestId("reset-password-form"));
  const failure = await screen.findByTestId("reset-password-error-unavailable");
  expect(failure).toHaveTextContent("The request outcome cannot be confirmed right now");
  expect(failure).toHaveTextContent("request a new one");
  language("zh-CN");
  expect(failure).toHaveTextContent("暂时无法确认请求结果");
  expect(failure).toHaveTextContent("若重置链接已失效，请重新申请");
  expect(api.request).toHaveBeenCalledTimes(1);
});
