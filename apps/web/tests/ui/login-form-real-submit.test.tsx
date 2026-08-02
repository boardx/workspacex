/**
 * F355 —— `(entry)/login` 真实提交：与 `/project/live` 共用同一个 `login()`
 * （`lib/auth-client.ts`），不再是纯 mock 跳转。
 *
 * 只钉住默认态（无 `?state=` 覆盖）下的真实网络行为：提交打 `POST /auth/login`，
 * 成功后把 token 存进 `localStorage` 并跳到 `/project/live`（仓库里唯一真实数据
 * 驱动的落地页——`/projects` 还是展示字段无出处的原型页，见
 * `app/project/live/page.tsx` 文件头），失败时把 401 折成同一句「邮箱或密码不正确」
 * （防枚举），网络类失败给出不同文案。
 *
 * 六个预览态（`?state=loading|empty|invalid|dep-failed|denied|success`）不在本文件
 * 覆盖范围——它们的职责是给 sign-off 演示固定 UI，见 `login-form.tsx` 里
 * `handleRealSubmit` 只在 `state === "default"` 时才被调用的注释。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { LoginForm } from "@/components/entry/login-form";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("F355 (entry)/login 表单：真实 POST /auth/login", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    pushMock.mockClear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("登录成功：token 存进 localStorage，跳转到真实数据驱动的 /project/live", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        sessionToken: "tok-login-real",
        userId: "u-1",
        orgs: ["org-1"],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );

    render(<LoginForm state="default" />);
    fireEvent.change(screen.getByTestId("login-email"), { target: { value: "lead@example.com" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByTestId("login-submit"));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/project/live");
    });
    expect(window.localStorage.getItem("wsx.sessionToken")).toBe("tok-login-real");

    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      email: "lead@example.com",
      password: "correct horse battery",
    });
  });

  it("401 折成同一句「邮箱或密码不正确」，不区分具体原因（防枚举）", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ statusCode: 401, message: { reasonCode: "INVALID_CREDENTIAL" } }, 401),
    );

    render(<LoginForm state="default" />);
    fireEvent.change(screen.getByTestId("login-email"), { target: { value: "lead@example.com" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByTestId("login-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("login-api-error")).toHaveTextContent("邮箱或密码不正确");
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("账号被锁定（ACCOUNT_LOCKED）也折成同一句话——不能让锁定态可被探测", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ statusCode: 401, message: { reasonCode: "ACCOUNT_LOCKED" } }, 401),
    );

    render(<LoginForm state="default" />);
    fireEvent.change(screen.getByTestId("login-email"), { target: { value: "lead@example.com" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "whatever" } });
    fireEvent.click(screen.getByTestId("login-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("login-api-error")).toHaveTextContent("邮箱或密码不正确");
    });
  });
});
