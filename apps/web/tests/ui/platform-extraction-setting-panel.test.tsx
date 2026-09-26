/**
 * issue #4247 —— 平台后台「运营状态」屏的「记忆抽取（整个部署）」面板。
 *
 * 只 mock `apiRequest` 这一层（同 `ops-status-screen.test.tsx`）：路径与方法取自契约
 * `knowledgeGraph.getPlatformExtractionSetting` / `setPlatformExtractionSetting`，断言真实发出的请求形状。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});

import { PlatformExtractionSettingPanel } from "@/components/admin/platform-extraction-setting-panel";
import { OpsStatusScreen } from "@/components/admin/ops-status-screen";

const PATH = knowledgeGraph.getPlatformExtractionSetting.path;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function toggle(): HTMLElement {
  return screen.getByTestId("admin-platform-extraction-toggle");
}

describe("issue #4247 平台级记忆抽取开关", () => {
  it("有权限：显示模型已配置与开关现值，并挂在运营状态屏上", async () => {
    apiRequest.mockImplementation(async (path: string) =>
      path === PATH ? { providerConfigured: true, enabled: true } : {});
    render(<OpsStatusScreen state="default" />);
    await screen.findByTestId("admin-platform-extraction-provider-configured");
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    // 面板给开关传了 className：开关必须仍带轨道底色与尺寸，而不是只剩一个白点（#4247 评审）
    expect(toggle().className).toMatch(/\bbg-primary\b/);
    expect(toggle().className).toMatch(/\bw-7\b/);
    expect(screen.getByTestId("admin-platform-extraction-state").textContent).toBe("已开启");
    expect(screen.getByTestId("admin-platform-extraction").textContent).toContain("生效中");
    expect(apiRequest).toHaveBeenCalledWith(PATH, { method: "GET" });
  });

  it("无权限（403 NOT_PLATFORM_SUPERUSER）：不画开关，给一句身份说明", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiRequest.mockRejectedValue(new ApiError(403, "NOT_PLATFORM_SUPERUSER", {}));
    render(<PlatformExtractionSettingPanel />);
    const denied = await screen.findByTestId("admin-platform-extraction-forbidden");
    expect(denied.textContent).toContain("仅平台运维");
    expect(screen.queryByTestId("admin-platform-extraction-toggle")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("providerConfigured=false：如实说明开关打开也不会抽取，状态为未生效", async () => {
    apiRequest.mockResolvedValue({ providerConfigured: false, enabled: true });
    render(<PlatformExtractionSettingPanel />);
    const missing = await screen.findByTestId("admin-platform-extraction-provider-missing");
    expect(missing.textContent).toContain("未配置");
    expect(missing.textContent).toContain("即使打开下面的开关，也不会抽取任何对话");
    expect(screen.getByTestId("admin-platform-extraction").textContent).toContain("未生效");
  });

  it("切换成功：乐观拨过去，发 PUT，以服务端返回为准", async () => {
    let resolvePut: (v: unknown) => void = () => {};
    apiRequest.mockImplementation(async (_path: string, opts?: { method?: string }) => {
      if (opts?.method === "PUT") return new Promise((r) => { resolvePut = r; });
      return { providerConfigured: true, enabled: true };
    });
    render(<PlatformExtractionSettingPanel />);
    await screen.findByTestId("admin-platform-extraction-provider-configured");
    fireEvent.click(toggle());
    // 乐观：请求还在飞，开关已经是关、且锁住防连点
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(toggle().hasAttribute("disabled")).toBe(true);
    expect(apiRequest).toHaveBeenLastCalledWith(
      knowledgeGraph.setPlatformExtractionSetting.path, { method: "PUT", body: { enabled: false } });
    resolvePut({ providerConfigured: true, enabled: false });
    await waitFor(() => expect(toggle().hasAttribute("disabled")).toBe(false));
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("admin-platform-extraction-state").textContent).toBe("已关闭");
    expect(screen.queryByTestId("admin-platform-extraction-save-failed")).toBeNull();
  });

  it("切换失败：回滚到原值并显示原因", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiRequest.mockImplementation(async (_path: string, opts?: { method?: string }) => {
      if (opts?.method === "PUT") throw new ApiError(500, null, {});
      return { providerConfigured: true, enabled: false };
    });
    render(<PlatformExtractionSettingPanel />);
    await screen.findByTestId("admin-platform-extraction-provider-configured");
    fireEvent.click(toggle());
    const failed = await screen.findByTestId("admin-platform-extraction-save-failed");
    expect(failed.textContent).toContain("没保存成功，仍是关闭");
    expect(failed.textContent).toContain("服务器出错了");
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("admin-platform-extraction-state").textContent).toBe("已关闭");
  });

  it("写时才收到 403：切到无权限态，不留一个点了没用的开关", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiRequest.mockImplementation(async (_path: string, opts?: { method?: string }) => {
      if (opts?.method === "PUT") throw new ApiError(403, "NOT_PLATFORM_SUPERUSER", {});
      return { providerConfigured: true, enabled: true };
    });
    render(<PlatformExtractionSettingPanel />);
    await screen.findByTestId("admin-platform-extraction-provider-configured");
    fireEvent.click(toggle());
    await screen.findByTestId("admin-platform-extraction-forbidden");
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("读失败（非 403）：显示失败原因与重试，不画开关", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiRequest.mockRejectedValueOnce(new ApiError(502, null, {}));
    render(<PlatformExtractionSettingPanel />);
    await screen.findByTestId("admin-platform-extraction-failed");
    expect(screen.queryByRole("switch")).toBeNull();
    apiRequest.mockResolvedValueOnce({ providerConfigured: true, enabled: true });
    fireEvent.click(screen.getByTestId("admin-platform-extraction-retry"));
    await screen.findByTestId("admin-platform-extraction-provider-configured");
  });
});
