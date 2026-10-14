import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BillingOverview } from "@/components/billing/billing-overview";
import { PersonalMenu } from "@/components/shell/personal-menu";

const wallet = { ownerType: "user", ownerId: "user-a", balance: 1250, totalPurchased: 1200, totalGranted: 50, updatedAt: "2026-10-14T00:00:00Z" };
const subscription = { status: "active", planRef: "price-private", currentPeriodEnd: "2026-11-14T00:00:00Z", cancelAtPeriodEnd: true };
function reply(body: unknown, status = 200) { return Promise.resolve(new Response(JSON.stringify(body), { status })); }
function requests(overrides: Record<string, () => Promise<Response>> = {}) {
  return vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
    expect(options.headers).toMatchObject({ Authorization: "Bearer test-billing-session" });
    const path = new URL(url).pathname;
    if (overrides[path]) return overrides[path]();
    if (path.endsWith("/billing/config")) return reply({ enabledProviders: [] });
    if (path.endsWith("/billing/wallet")) {
      expect(new URL(url).searchParams.get("ownerType")).toBe("user");
      expect(new URL(url).searchParams.has("ownerId")).toBe(false);
      return reply({ wallet });
    }
    return reply(subscription);
  }));
}
const renderOverview = () => render(<BillingOverview userId="user-a" sessionToken="test-billing-session" />);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("真实计费入口与账户状态", () => {
  it("个人菜单始终可发现账户入口，不依赖支付凭据", () => {
    render(<PersonalMenu avatarInitial="Y" />);
    fireEvent.pointerDown(screen.getByTestId("rail-profile-menu"), { button: 0 });
    expect(screen.getByRole("menuitem", { name: "额度与订阅" }).getAttribute("href")).toBe("/billing");
  });

  it("未配置渠道仍读取真实钱包和订阅，不显示二维码或虚构额度", async () => {
    requests(); renderOverview();
    expect(screen.getByTestId("billing-config-loading")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("billing-wallet-balance").textContent).toContain("1,250"));
    expect(screen.getByTestId("billing-provider-unavailable").textContent).toContain("暂未开通");
    expect(screen.getByTestId("billing-subscription-status").textContent).toContain("已订阅");
    expect(screen.getByText("将在本期结束后取消")).toBeTruthy();
    expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
    expect(screen.queryByText("price-private")).toBeNull();
  });

  it("缺失服务返回404时显示尚未开放，不能伪装成零余额或无订阅", async () => {
    requests({ "/billing/config": () => reply({}, 404), "/billing/wallet": () => reply({}, 404), "/billing/subscription": () => reply({}, 404) });
    renderOverview();
    await screen.findByTestId("err-billing-wallet");
    expect(screen.queryByTestId("billing-wallet-balance")).toBeNull();
    expect(screen.queryByTestId("billing-subscription-status")).toBeNull();
    expect(screen.getByTestId("err-billing-config").textContent).toContain("暂未开放");
    expect(screen.getByRole("link", { name: "查看我的 AI 用量" }).getAttribute("href")).toBe("/usage");
  });

  it("单项网络失败可单独重试，不覆盖其他正常数据", async () => {
    let failed = true;
    requests({ "/billing/wallet": () => failed ? Promise.reject(new Error("private transport details")) : reply({ wallet }) });
    renderOverview();
    await screen.findByTestId("err-billing-wallet");
    expect(screen.getByTestId("err-billing-wallet").textContent).not.toContain("private transport");
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "重试额度查询" }));
    await screen.findByTestId("billing-wallet-balance");
    expect(screen.getByTestId("billing-subscription-status").textContent).toContain("已订阅");
  });

  it("服务返回其他用户钱包时不渲染余额", async () => {
    requests({ "/billing/wallet": () => reply({ wallet: { ...wallet, ownerId: "other-user" } }) });
    renderOverview();
    await screen.findByTestId("err-billing-wallet");
    expect(screen.queryByTestId("billing-wallet-balance")).toBeNull();
  });

  it("Stripe单独配置时如实显示渠道，不伪装成可微信充值", async () => {
    requests({ "/billing/config": () => reply({ enabledProviders: ["stripe"] }) });
    renderOverview();
    await screen.findByText("Stripe · 已配置");
    expect(screen.getByText("微信支付 · 未开通")).toBeTruthy();
    expect(screen.getByText("微信充值暂未开放。")).toBeTruthy();
    expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
  });

  it("卸载取消所有读取，避免旧账号响应晚到", () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
      signals.push(options.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    }));
    const view = renderOverview(); view.unmount();
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
