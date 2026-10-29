import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BillingOverview } from "@/components/billing/billing-overview";
import { navigateToStripe } from "@/components/billing/stripe-navigation";
vi.mock("@/components/billing/stripe-navigation", () => ({ navigateToStripe: vi.fn() }));
const info = (status: string) => ({ status, planRef: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
function setup(status = "none", configured = true, link = "https://checkout.stripe.com/c/pay/test") {
  const fetcher = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const body = path.endsWith("/config") ? { enabledProviders: configured ? ["stripe"] : [] }
      : path.endsWith("/wallet") ? { wallet: { ownerType: "user", ownerId: "u", balance: 1, totalPurchased: 1, totalGranted: 0, updatedAt: "2026-10-10" } }
      : path.endsWith("-link") ? { url: link } : info(status);
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const mount = () => render(<BillingOverview userId="u" sessionToken="session" />);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); sessionStorage.clear(); window.history.replaceState({}, "", "/billing"); vi.useRealTimers(); });
describe("live Stripe subscription", () => {
  it("requests checkout without owner data, redirects and reuses the pending URL on reopening", async () => {
    const fetcher = setup(); const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: "订阅 Pro" }));
    await waitFor(() => expect(navigateToStripe).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/test"));
    view.unmount(); mount();
    fireEvent.click(await screen.findByRole("button", { name: "继续订阅付款" }));
    expect(fetcher.mock.calls.filter(([url]) => url.includes("upgrade-link"))).toHaveLength(1);
    expect(fetcher.mock.calls.find(([url]) => url.includes("upgrade-link"))?.[0]).toBe("http://localhost:3200/billing/subscription/upgrade-link");
  });
  it.each([
    ["active", "管理订阅", true], ["trialing", "管理订阅", true], ["past_due", "处理订阅付款", false],
    ["unpaid", "处理订阅付款", false], ["incomplete", "处理订阅付款", false], ["paused", "处理订阅付款", false],
    ["canceled", "订阅 Pro", false], ["incomplete_expired", "订阅 Pro", false], ["none", "订阅 Pro", false],
  ])("%s uses the approved entitlement and operation", async (status, label, pro) => {
    const fetcher = setup(status, true, label === "订阅 Pro" ? "https://checkout.stripe.com/c/pay/test" : "https://billing.stripe.com/p/session/test"); mount();
    fireEvent.click(await screen.findByRole("button", { name: label as string }));
    await waitFor(() => expect(navigateToStripe).toHaveBeenCalled());
    expect(!!screen.queryByText("Pro 权益已生效")).toBe(pro);
    if (label !== "订阅 Pro") expect(fetcher.mock.calls.some(([url]) => url.includes("management-link"))).toBe(true);
  });
  it("has no purchase action when the provider is unavailable", async () => {
    setup("none", false); mount(); await screen.findByTestId("billing-subscription-status");
    expect(screen.queryByRole("button", { name: "订阅 Pro" })).toBeNull();
  });
  it("rejects an untrusted checkout URL without navigating", async () => {
    setup("none", true, "https://checkout.stripe.com.evil.test/pay"); mount();
    fireEvent.click(await screen.findByRole("button", { name: "订阅 Pro" }));
    await screen.findByRole("alert"); expect(navigateToStripe).not.toHaveBeenCalled();
  });
  it.each([["canceled", "reopen"], ["incomplete_expired", "reopen"], ["canceled", "refresh"], ["incomplete_expired", "refresh"]])("retires a pending checkout after a newly confirmed %s transition via %s", async (terminal, mode) => {
    const fetcher = setup(); const initial = fetcher.getMockImplementation()!; let current = "none";
    fetcher.mockImplementation((url) => new URL(url).pathname === "/billing/subscription"
      ? Promise.resolve(new Response(JSON.stringify(info(current)))) : initial(url));
    const view = mount(); fireEvent.click(await screen.findByRole("button", { name: "订阅 Pro" }));
    await waitFor(() => expect(navigateToStripe).toHaveBeenCalledTimes(1));
    current = terminal;
    if (mode === "reopen") { view.unmount(); mount(); }
    else fireEvent.click(screen.getByRole("button", { name: "刷新订阅状态" }));
    fireEvent.click(await screen.findByRole("button", { name: "订阅 Pro" }));
    await waitFor(() => expect(navigateToStripe).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls.filter(([url]) => url.includes("upgrade-link"))).toHaveLength(2);
  });
  it("keeps a checkout started from an existing canceled state until a new terminal transition is observed", async () => {
    const fetcher = setup("canceled"); const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: "订阅 Pro" }));
    await waitFor(() => expect(navigateToStripe).toHaveBeenCalledTimes(1));
    view.unmount(); mount();
    fireEvent.click(await screen.findByRole("button", { name: "继续订阅付款" }));
    await waitFor(() => expect(navigateToStripe).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls.filter(([url]) => url.includes("upgrade-link"))).toHaveLength(1);
  });
  it("retires a canceled-origin checkout after observing incomplete then canceled", async () => {
    const fetcher = setup("canceled"); const initial = fetcher.getMockImplementation()!; let current = "canceled";
    fetcher.mockImplementation((url) => new URL(url).pathname === "/billing/subscription"
      ? Promise.resolve(new Response(JSON.stringify(info(current)))) : initial(url));
    mount(); fireEvent.click(await screen.findByRole("button", { name: "订阅 Pro" }));
    await waitFor(() => expect(navigateToStripe).toHaveBeenCalledTimes(1));
    current = "incomplete"; fireEvent.click(screen.getByRole("button", { name: "刷新订阅状态" }));
    await screen.findByRole("button", { name: "处理订阅付款" });
    current = "canceled"; fireEvent.click(screen.getByRole("button", { name: "刷新订阅状态" }));
    fireEvent.click(await screen.findByRole("button", { name: "订阅 Pro" }));
    await waitFor(() => expect(navigateToStripe).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls.filter(([url]) => url.includes("upgrade-link"))).toHaveLength(2);
  });
  it("blocks concurrent checkout requests while a link is loading", async () => {
    const fetcher = setup();
    const initial = fetcher.getMockImplementation()!;
    let finish: ((value: Response) => void) | undefined;
    fetcher.mockImplementation((url) => url.includes("upgrade-link") ? new Promise<Response>((resolve) => { finish = resolve; }) : initial(url));
    mount(); const button = await screen.findByRole("button", { name: "订阅 Pro" });
    fireEvent.click(button); fireEvent.click(button);
    expect(fetcher.mock.calls.filter(([url]) => url.includes("upgrade-link"))).toHaveLength(1);
    expect((screen.getByRole("button", { name: "正在打开…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish?.(new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/test" }))));
    expect(navigateToStripe).toHaveBeenCalledTimes(1);
  });
  it("polls a known return a bounded number of times without claiming free or creating another checkout", async () => {
    window.history.replaceState({}, "", "/billing?subscription_return=1");
    vi.useFakeTimers(); const fetcher = setup(); mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("billing-subscription-status").textContent).toBe("付款结果确认中");
    expect((screen.getByRole("button", { name: "订阅 Pro" }) as HTMLButtonElement).disabled).toBe(true);
    for (let n = 0; n < 6; n++) await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    const reads = fetcher.mock.calls.filter(([url]) => new URL(url).pathname === "/billing/subscription").length;
    expect(reads).toBe(7);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetcher.mock.calls.filter(([url]) => new URL(url).pathname === "/billing/subscription")).toHaveLength(7);
    expect(screen.getByText(/付款结果尚未确认/)).toBeTruthy();
    expect(fetcher.mock.calls.some(([url]) => url.includes("upgrade-link"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "刷新订阅状态" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetcher.mock.calls.filter(([url]) => new URL(url).pathname === "/billing/subscription")).toHaveLength(8);
  });
  it.each(["cleared", "unavailable"])("allows explicit restart after an uncorrelated %s-storage return times out", async (storage) => {
    window.history.replaceState({}, "", "/billing?subscription_return=1");
    const unavailable = storage === "unavailable" ? vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); }) : null;
    vi.useFakeTimers(); const fetcher = setup();
    try {
      mount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect((screen.getByRole("button", { name: "订阅 Pro" }) as HTMLButtonElement).disabled).toBe(true);
      for (let n = 0; n < 6; n++) await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      const restart = screen.getByRole("button", { name: "重新开始订阅" }) as HTMLButtonElement;
      expect(restart.disabled).toBe(false);
      expect(screen.getByTestId("billing-subscription-status").textContent).toBe("付款结果确认中");
      expect(fetcher.mock.calls.filter(([url]) => url.includes("upgrade-link"))).toHaveLength(0);
      fireEvent.click(restart); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(fetcher.mock.calls.filter(([url]) => url.includes("upgrade-link"))).toHaveLength(1);
      expect(navigateToStripe).toHaveBeenCalledTimes(1);
    } finally { unavailable?.mockRestore(); }
  });
  it("confirms Pro only after a stored active response and cancels remaining poll timers", async () => {
    window.history.replaceState({}, "", "/billing?subscription_return=1");
    vi.useFakeTimers(); const fetcher = setup(); const initial = fetcher.getMockImplementation()!;
    let reads = 0;
    fetcher.mockImplementation((url) => new URL(url).pathname === "/billing/subscription"
      ? Promise.resolve(new Response(JSON.stringify(info(++reads > 1 ? "active" : "none")))) : initial(url));
    mount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText("Pro 权益已生效")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText("Pro 权益已生效")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(reads).toBe(2);
  });
  it.each(["canceled", "incomplete_expired"])("a confirmed terminal %s return permits re-subscription", async (status) => {
    window.history.replaceState({}, "", "/billing?subscription_return=1");
    setup(status); mount();
    const button = await screen.findByRole("button", { name: "订阅 Pro" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button); await waitFor(() => expect(navigateToStripe).toHaveBeenCalled());
  });
  it("keeps refreshing after a portal return so a delayed cancellation webhook becomes visible", async () => {
    window.history.replaceState({}, "", "/billing?subscription_return=1&subscription_management_return=1");
    vi.useFakeTimers(); const fetcher = setup("active"); const initial = fetcher.getMockImplementation()!;
    let reads = 0;
    fetcher.mockImplementation((url) => new URL(url).pathname === "/billing/subscription"
      ? Promise.resolve(new Response(JSON.stringify({ ...info("active"), cancelAtPeriodEnd: ++reads > 1, currentPeriodEnd: "2030-02-01T00:00:00Z" }))) : initial(url));
    const view = mount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Pro 权益已生效")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText(/已取消续费.*本期结束前.*Pro/)).toBeTruthy();
    expect(screen.getByText("Pro 权益已生效")).toBeTruthy();
    for (let n = 0; n < 5; n++) await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(reads).toBe(7);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(reads).toBe(7);
    expect(fetcher.mock.calls.some(([url]) => url.includes("upgrade-link"))).toBe(false);
    view.unmount();
  });
  it("does not promise Pro for a canceled renewal on a past-due subscription", async () => {
    const fetcher = setup("past_due"); const initial = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url) => new URL(url).pathname === "/billing/subscription"
      ? Promise.resolve(new Response(JSON.stringify({ ...info("past_due"), cancelAtPeriodEnd: true }))) : initial(url));
    mount(); await screen.findByText("付款逾期");
    expect(screen.queryByText(/本期结束前仍可使用 Pro/)).toBeNull();
    expect(screen.getByText("已取消续费，将在本期结束时生效。")).toBeTruthy();
  });
  it("stops portal return refreshes on unmount", async () => {
    window.history.replaceState({}, "", "/billing?subscription_management_return=1");
    vi.useFakeTimers(); const fetcher = setup("active"); const view = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetcher.mock.calls.filter(([url]) => new URL(url).pathname === "/billing/subscription")).toHaveLength(1);
  });
  it("unmount stops return polling", async () => {
    window.history.replaceState({}, "", "/billing?subscription_return=1");
    vi.useFakeTimers(); const fetcher = setup(); const view = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetcher.mock.calls.filter(([url]) => new URL(url).pathname === "/billing/subscription")).toHaveLength(1);
  });
  it("a 503 refresh removes previously confirmed Pro and prevents new purchase", async () => {
    const fetcher = setup("active"); const initial = fetcher.getMockImplementation()!;
    let failed = false;
    fetcher.mockImplementation((url) => failed && new URL(url).pathname === "/billing/subscription"
      ? Promise.resolve(new Response("{}", { status: 503 })) : initial(url));
    mount(); await screen.findByText("Pro 权益已生效"); failed = true;
    fireEvent.click(screen.getByRole("button", { name: "刷新订阅状态" }));
    await screen.findByTestId("err-billing-subscription");
    expect(screen.queryByText("Pro 权益已生效")).toBeNull();
    expect(screen.queryByRole("button", { name: "订阅 Pro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "管理订阅" })).toBeNull();
  });
  it("does not show Pro or purchase when status cannot be confirmed", async () => {
    setup("future_status"); mount(); await screen.findByTestId("err-billing-subscription");
    expect(screen.queryByText("Pro 权益已生效")).toBeNull();
    expect(screen.queryByRole("button", { name: "订阅 Pro" })).toBeNull();
  });
});
