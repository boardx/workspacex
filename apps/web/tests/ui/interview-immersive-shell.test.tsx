import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/itv/interview-immersive/setup",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn().mockResolvedValue({}),
}));

import { AppShell } from "@/components/shell/app-shell";
import { MOCK_ORGS, type Identity } from "@/lib/identity";

const identity: Identity = {
  displayName: "访谈测试者",
  avatarUrl: null,
  orgRole: "consultant",
  org: MOCK_ORGS[0]!,
  projectRole: null,
  projectName: null,
  groupName: null,
};

describe("访谈沉浸式工作台壳层", () => {
  it("默认壳保留 Workspace 导航", () => {
    render(<AppShell identity={identity} previewRole={null}><div>访谈列表</div></AppShell>);

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("shell-rail")).toBeInTheDocument();
    expect(screen.getByTestId("shell-mobile-tabs")).toBeInTheDocument();
  });

  it("全屏壳只保留访谈工作台内容", () => {
    render(<AppShell identity={identity} previewRole={null} fullscreen><div data-testid="itv-workbench-content">访谈工作台</div></AppShell>);

    expect(screen.getByTestId("itv-workbench-content")).toBeInTheDocument();
    expect(screen.queryByTestId("shell-rail")).toBeNull();
    expect(screen.queryByTestId("shell-mobile-tabs")).toBeNull();
  });

  it("访谈详情路由使用全屏壳", () => {
    const source = readFileSync(resolve(__dirname, "../../app/itv/[interviewId]/setup/page.tsx"), "utf8");

    expect(source).toMatch(/<AppShell[^>]*\bfullscreen\b/);
  });
});
