import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

const { login, push } = vi.hoisted(() => ({ login: vi.fn(), push: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, login };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { LoginForm } from "@/components/entry/login-form";
import { SessionProvider } from "@/components/session/session-provider";

beforeEach(() => {
  window.localStorage.clear();
  login.mockReset();
  push.mockReset();
});

async function submitWith(error: ApiError) {
  login.mockRejectedValueOnce(error);
  render(<SessionProvider><LoginForm state="default" /></SessionProvider>);
  fireEvent.change(screen.getByTestId("login-email"), { target: { value: "lead@example.com" } });
  fireEvent.change(screen.getByTestId("login-password"), { target: { value: "wrong-password" } });
  fireEvent.click(screen.getByTestId("login-submit"));
  await waitFor(() => expect(screen.getByTestId("login-error")).toBeInTheDocument());
}

describe("real login failure mapping", () => {
  it("maps INVALID_CREDENTIAL to the non-enumerating credential message", async () => {
    await submitWith(new ApiError(401, "INVALID_CREDENTIAL", {}));
    expect(screen.getByTestId("login-error")).toHaveTextContent("邮箱或密码不正确");
  });

  it("does not misreport an auth dependency outage as wrong credentials", async () => {
    await submitWith(new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", {}));
    expect(screen.getByTestId("login-error")).toHaveTextContent("登录服务暂时不可用");
  });
});
