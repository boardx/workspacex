import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

/**
 * 2026-08-12 devapp 实测事故（issue #985）：人类点邀请激活链接
 * `…/auth/activate?t=P_qpx…` 撞上滚动部署的重启窗口，看到裸 500。
 *
 * 页面此前对「后端够不着」（连接拒绝/5xx——部署窗口的两种典型表现）只给兜底文案
 * 「激活未完成（HTTP 500），请稍后重试」，既没有说明这是服务侧的临时状况，
 * 也没有承诺**链接不会因此被消耗**——而这条承诺是有事务性背书的：
 * `pg-org-invite-repository.ts` 的 activate 是单一 PG 事务（I-1），任何一步失败
 * 令牌都不会被核销（`activation-member-creation-atomic.test.ts` +
 * `activation-unexpected-failure-token-survives.test.ts` 钉住）。
 *
 * 这组用例钉住三件事：
 *   ① 5xx / 网络层失败 ⇒ 结构化 `activate-error-unavailable` 错误态
 *      （文案含「链接不会因这次失败而失效」）+ 显式重试按钮；
 *   ② 重试按钮走同一条提交路径，后端恢复后一键激活成功；
 *   ③ 服务端明确判定过的失败（如 INVITE_NOT_FOUND）**不**给重试按钮——
 *      对一条已失效的链接展示「重试」是在骗用户做无用功。
 */
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
  it("后端 5xx ⇒ activate-error-unavailable：说明临时不可用 + 承诺链接仍有效 + 重试按钮", async () => {
    apiRequest.mockRejectedValue(new ApiError(500, null, { error: "internal", traceId: "t-1" }));
    render(<InviteActivation token="P_qpx-token" />);
    fillAndSubmit();

    const alert = await screen.findByTestId("activate-error-unavailable");
    expect(alert.textContent).toContain("服务暂时不可用");
    // 这句承诺由激活事务性（I-1）背书：失败的尝试不会核销令牌。
    expect(alert.textContent).toContain("链接不会因这次失败而失效");
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
