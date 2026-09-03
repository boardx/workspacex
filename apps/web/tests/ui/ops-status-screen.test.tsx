/**
 * OPS-1 —— 平台后台「运营状态」屏。
 *
 * 2026-09-03 人类反馈：「测试邮件的功能不要放在系统异常下面，放到平台后台的一个
 * 新的菜单叫运营状态」——`TestMailPanel` 从 `feedback-screen.tsx` 挪到这里，这个文件
 * 是那组用例（成功/失败/非超管）搬家后的落点，原用例见 `admin-feedback-live.test.tsx`
 * 头注编号⑥历史（现已移除测试邮件相关的两条）。
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
