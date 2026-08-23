/**
 * UIUX-CK-1 反证：左右栏收起/展开/记忆（人类实测 3 分的第一条实锤）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api-client", async (orig) => ({
  ...(await orig<object>()),
  apiRequest: vi.fn().mockResolvedValue({}),
}));

import { AppShell } from "@/components/shell/app-shell";
import { MOCK_ORGS, type Identity } from "@/lib/identity";

const identity: Identity = {
  displayName: "测试",
  avatarUrl: null,
  orgRole: "consultant",
  org: MOCK_ORGS[0]!,
  projectRole: null,
  projectName: null,
  groupName: null,
};

function shell() {
  return render(
    <AppShell identity={identity} previewRole={null} left={<div>左内容</div>} right={<div>右内容</div>}>
      <div>主内容</div>
    </AppShell>,
  );
}

beforeEach(() => window.localStorage.clear());

describe("CK-1 面板收起", () => {
  it("默认两栏展开，收起钮在场", () => {
    shell();
    expect(screen.getByTestId("shell-left-panel")).toBeInTheDocument();
    expect(screen.getByTestId("shell-right-panel")).toBeInTheDocument();
  });

  it("点收起 → 栏消失、展开把手出现；再点 → 恢复", () => {
    shell();
    fireEvent.click(screen.getByTestId("shell-right-collapse"));
    expect(screen.queryByTestId("shell-right-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("shell-right-expand"));
    expect(screen.getByTestId("shell-right-panel")).toBeInTheDocument();
  });

  it("收起状态写入 localStorage（个人习惯记忆，非服务端事实）", () => {
    shell();
    fireEvent.click(screen.getByTestId("shell-left-collapse"));
    expect(window.localStorage.getItem("shell.leftCollapsed")).toBe("1");
    fireEvent.click(screen.getByTestId("shell-left-expand"));
    expect(window.localStorage.getItem("shell.leftCollapsed")).toBe("0");
  });

  it("挂载时读取记忆：上次收起这次仍收起", async () => {
    window.localStorage.setItem("shell.rightCollapsed", "1");
    shell();
    expect(await screen.findByTestId("shell-right-expand")).toBeInTheDocument();
    expect(screen.queryByTestId("shell-right-panel")).toBeNull();
  });
});
