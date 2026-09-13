import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

/** Network failure can occur after commit; never promise the invitation is unconsumed. */
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: null, startSession: vi.fn() }),
}));
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiRequest };
});

import { InviteActivation } from "@/components/entry/invite-activation";

function fillAndSubmit() {
  fireEvent.change(screen.getByTestId("activate-name"), { target: { value: "受邀人" } });
  fireEvent.change(screen.getByTestId("activate-pwd"), { target: { value: "long-enough-pass-1" } });
  fireEvent.submit(screen.getByTestId("activate-form"));
}

beforeEach(() => {
  apiRequest.mockReset();
  window.localStorage.clear();
});

describe("后端不可用（部署重启窗口）⇒ 结构化错误态 + 重试按钮", () => {
  it("后端 5xx ⇒ activate-error-unavailable：说明临时不可用 + 登录恢复提示 + 重试按钮", async () => {
    apiRequest.mockRejectedValue(new ApiError(500, null, { error: "internal", traceId: "t-1" }));
    render(<InviteActivation token="P_qpx-token" />);
    fillAndSubmit();

    const alert = await screen.findByTestId("activate-error-unavailable");
    expect(alert.textContent).toContain("服务暂时不可用");
    // Response loss or Redis failure can happen after the membership transaction commits.
    expect(alert.textContent).toContain("若账号已创建");
    expect(alert.textContent).not.toContain("不会因这次失败而失效");
    expect(screen.getByTestId("activate-retry")).toBeTruthy();
    // 不是那个兜底错误态。
    expect(screen.queryByTestId("activate-error")).toBeNull();
  });

  it("连接层失败（fetch 抛 TypeError，连接拒绝/断网）⇒ 同一个错误态", async () => {
    apiRequest.mockRejectedValue(new TypeError("fetch failed"));
    render(<InviteActivation token="P_qpx-token" />);
    fillAndSubmit();

    const alert = await screen.findByTestId("activate-error-unavailable");
    expect(alert.textContent).toContain("服务暂时不可用");
    expect(screen.getByTestId("activate-retry")).toBeTruthy();
  });

  it("后端恢复后点「重试」⇒ 同一次提交重放 ⇒ 激活成功", async () => {
    apiRequest.mockRejectedValueOnce(new ApiError(503, null, { error: "unavailable", traceId: "t-2" }));
    apiRequest.mockResolvedValueOnce({
      userId: "u1",
      orgId: "org1",
      orgRole: "consultant",
      teamId: "",
      sessionId: "s1",
    });
    render(<InviteActivation token="P_qpx-token" />);
    fillAndSubmit();

    fireEvent.click(await screen.findByTestId("activate-retry"));

    await screen.findByTestId("activate-success");
    expect(apiRequest).toHaveBeenCalledTimes(2);
    // 重试用的是同一枚 token、同一个 body——不是另一种提交。
    const [firstCall, secondCall] = apiRequest.mock.calls;
    expect(secondCall![1].body).toEqual(firstCall![1].body);
  });
});

describe("服务端明确判定的失败 ⇒ 不给重试按钮", () => {
  it("INVITE_NOT_FOUND ⇒ 仍是原错误态与文案，没有重试按钮", async () => {
    apiRequest.mockRejectedValue(
      new ApiError(400, "INVITE_NOT_FOUND", { error: "bad_request", reasonCode: "INVITE_NOT_FOUND", traceId: "t-3" }),
    );
    render(<InviteActivation token="P_qpx-token" />);
    fillAndSubmit();

    const alert = await screen.findByTestId("activate-error");
    expect(alert.textContent).toContain("链接无效或已失效");
    expect(screen.queryByTestId("activate-retry")).toBeNull();
    expect(screen.queryByTestId("activate-error-unavailable")).toBeNull();
  });
});
