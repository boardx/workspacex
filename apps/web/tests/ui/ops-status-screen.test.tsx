/**
 * OPS-1 —— 平台后台「运营状态」屏。
 *
 * 2026-09-03 人类反馈：「测试邮件的功能不要放在系统异常下面，放到平台后台的一个
 * 新的菜单叫运营状态」——`TestMailPanel` 从旧 `feedback-screen.tsx` 挪到这里，这个文件
 * 是那组用例（成功/失败/非超管）搬家后的落点。原用例曾在 `admin-feedback-live.test.tsx`
 * 头注编号⑥；那个文件已随 B3.6 旧屏退役一并删除（测试邮件相关的两条早在搬家时移除）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});

import { OpsStatusScreen } from "@/components/admin/ops-status-screen";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("OPS-1 运营状态屏——测试邮件", () => {
  it("超管发一封：成功显示收件人与供应商回执，失败显示契约码与归类", async () => {
    const { ApiError } = await import("@/lib/api-client");
    let attempt = 0;
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: { to?: string } }) => {
      if (path === "/system/mail/test") {
        attempt += 1;
        if (attempt === 1) {
          expect(opts?.body).toEqual({}); // 留空 = 发给当前账号，不传 to
          return { sentTo: "admin@example.com", subject: "WorkspaceX 测试邮件 2026-09-02T10:00:00.000Z", providerMessageId: "cf-1", sentAt: "2026-09-02T10:00:00.000Z" };
        }
        expect(opts?.body).toEqual({ to: "ops@example.com" });
        throw new ApiError(503, "MAIL_SEND_FAILED", { reasonCode: "MAIL_SEND_FAILED", category: "provider_http_502" });
      }
      return {};
    });

    render(<OpsStatusScreen state="default" />);
    fireEvent.click(screen.getByTestId("admin-ops-status-test-mail-send"));
    const sent = await screen.findByTestId("admin-ops-status-test-mail-sent");
    expect(sent.textContent).toContain("admin@example.com");
    expect(sent.textContent).toContain("cf-1");

    fireEvent.change(screen.getByTestId("admin-ops-status-test-mail-to"), { target: { value: "ops@example.com" } });
    fireEvent.click(screen.getByTestId("admin-ops-status-test-mail-send"));
    const failed = await screen.findByTestId("admin-ops-status-test-mail-failed");
    expect(failed.textContent).toContain("MAIL_SEND_FAILED");
    expect(failed.textContent).toContain("provider_http_502");
  });

  it("非超管点发送：403 NOT_PLATFORM_SUPERUSER 渲染成一句身份说明，不是通用失败文案", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/system/mail/test") throw new ApiError(403, "NOT_PLATFORM_SUPERUSER", {});
      return {};
    });

    render(<OpsStatusScreen state="default" />);
    fireEvent.click(screen.getByTestId("admin-ops-status-test-mail-send"));
    const failed = await screen.findByTestId("admin-ops-status-test-mail-failed");
    expect(failed.textContent).toContain("仅平台运维");
  });
});

/**
 * 「忘记密码限流状态」（issue #2632）——一次真实支持事故的直接产物,见组件文件头注。
 */
describe("OPS-1 运营状态屏——忘记密码限流状态", () => {
  it("未注册邮箱：明确说查不到账号，不是发信失败", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/auth/password-reset/inspect-throttle") {
        return {
          registered: false, issuedInLast24h: 0, dailyCap: 5, overDailyCap: false,
          lastIssuedAt: null, cooldownSeconds: 60, cooling: false, cooldownEndsAt: null,
        };
      }
      return {};
    });

    render(<OpsStatusScreen state="default" />);
    fireEvent.change(screen.getByTestId("admin-ops-status-reset-throttle-email"), { target: { value: "nobody@example.com" } });
    fireEvent.click(screen.getByTestId("admin-ops-status-reset-throttle-check"));
    const unregistered = await screen.findByTestId("admin-ops-status-reset-throttle-unregistered");
    expect(unregistered.textContent).toContain("查不到对应账号");
  });

  it("已超过每日上限：明确说明新请求会被无声跳过——正是这次事故的真实成因", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/auth/password-reset/inspect-throttle") {
        return {
          registered: true, issuedInLast24h: 5, dailyCap: 5, overDailyCap: true,
          lastIssuedAt: "2026-09-04T11:00:00.000Z", cooldownSeconds: 60, cooling: false, cooldownEndsAt: null,
        };
      }
      return {};
    });

    render(<OpsStatusScreen state="default" />);
    fireEvent.change(screen.getByTestId("admin-ops-status-reset-throttle-email"), { target: { value: "usam@boardx.us" } });
    fireEvent.click(screen.getByTestId("admin-ops-status-reset-throttle-check"));
    const result = await screen.findByTestId("admin-ops-status-reset-throttle-result");
    expect(result.textContent).toContain("5");
    expect(result.textContent).toContain("已到每日上限");
  });

  it("正在冷却：显示还要等到几点才会再发", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/auth/password-reset/inspect-throttle") {
        return {
          registered: true, issuedInLast24h: 1, dailyCap: 5, overDailyCap: false,
          lastIssuedAt: "2026-09-04T11:59:50.000Z", cooldownSeconds: 60, cooling: true,
          cooldownEndsAt: "2026-09-04T12:00:50.000Z",
        };
      }
      return {};
    });

    render(<OpsStatusScreen state="default" />);
    fireEvent.change(screen.getByTestId("admin-ops-status-reset-throttle-email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByTestId("admin-ops-status-reset-throttle-check"));
    const result = await screen.findByTestId("admin-ops-status-reset-throttle-result");
    expect(result.textContent).toContain("冷却内");
  });

  it("没有被限流：明确说明问题不在这里，把排查方向指回发信通路本身", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/auth/password-reset/inspect-throttle") {
        return {
          registered: true, issuedInLast24h: 1, dailyCap: 5, overDailyCap: false,
          lastIssuedAt: "2026-09-04T09:00:00.000Z", cooldownSeconds: 60, cooling: false, cooldownEndsAt: null,
        };
      }
      return {};
    });

    render(<OpsStatusScreen state="default" />);
    fireEvent.change(screen.getByTestId("admin-ops-status-reset-throttle-email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByTestId("admin-ops-status-reset-throttle-check"));
    const result = await screen.findByTestId("admin-ops-status-reset-throttle-result");
    expect(result.textContent).toContain("当前没有被限流");
  });

  it("非超管查询：403 渲染成一句身份说明", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/auth/password-reset/inspect-throttle") throw new ApiError(403, "NOT_PLATFORM_SUPERUSER", {});
      return {};
    });

    render(<OpsStatusScreen state="default" />);
    fireEvent.change(screen.getByTestId("admin-ops-status-reset-throttle-email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByTestId("admin-ops-status-reset-throttle-check"));
    const failed = await screen.findByTestId("admin-ops-status-reset-throttle-failed");
    expect(failed.textContent).toContain("仅平台运维");
  });
});

/**
 * 「服务可用性」（issue #2645）——运营状态屏的红绿 bar + 精确可用性百分比，见组件
 * 文件头 2026-09-04 一节。
 */
describe("OPS-1 运营状态屏——服务可用性", () => {
  it("已配置且有数据：红绿 bar 按数量渲染，百分比精确到小数点后两位", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/system/uptime") {
        return {
          service: "dev_app",
          configured: true,
          segments: [
            { checkedAt: "2026-09-04T00:00:00.000Z", isUp: true },
            { checkedAt: "2026-09-04T00:01:00.000Z", isUp: false },
            { checkedAt: "2026-09-04T00:02:00.000Z", isUp: true },
          ],
          totalChecks: 3,
          upChecks: 2,
          availabilityPercent: 66.67,
        };
      }
      return {};
    });

    render(<OpsStatusScreen state="default" />);
    const bar = await screen.findByTestId("admin-ops-status-uptime-bar");
    expect(screen.getAllByTestId("admin-ops-status-uptime-segment-up")).toHaveLength(2);
    expect(screen.getAllByTestId("admin-ops-status-uptime-segment-down")).toHaveLength(1);
    expect(bar.children).toHaveLength(3);
    const percent = screen.getByTestId("admin-ops-status-uptime-percent");
    expect(percent.textContent).toContain("66.67%");
    expect(percent.textContent).toContain("3 次探活中 2 次可用");
  });

  it("未配置探活目标：明确说明未配置，不是渲染一条空 bar", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/system/uptime") {
        return { service: "dev_app", configured: false, segments: [], totalChecks: 0, upChecks: 0, availabilityPercent: null };
      }
      return {};
    });

    render(<OpsStatusScreen state="default" />);
    const unconfigured = await screen.findByTestId("admin-ops-status-uptime-unconfigured");
    expect(unconfigured.textContent).toContain("DEV_APP_UPTIME_URL");
    expect(screen.queryByTestId("admin-ops-status-uptime-bar")).toBeNull();
  });

  it("非超管：403 渲染成一句身份说明", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/system/uptime") throw new ApiError(403, "NOT_PLATFORM_SUPERUSER", {});
      return {};
    });

    render(<OpsStatusScreen state="default" />);
    const failed = await screen.findByTestId("admin-ops-status-uptime-failed");
    expect(failed.textContent).toContain("仅平台运维");
  });
});
