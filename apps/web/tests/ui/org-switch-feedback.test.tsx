import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// TopBar 里 `ChatProjectIdFromSearchParams` 用 `useSearchParams`——补桩是补缺失的桩，
// 不是放宽断言。
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} }),
}));

import { ShellBusyProvider } from "@/lib/shell-busy";
import { ShellChrome } from "@/components/shell/app-shell";
import { useReportShellBusy } from "@/lib/shell-busy";
import { buildOrgSwitchUrl, describeRunsLeftBehind, forgetOrgSwitch, rememberOrgSwitch, takeOrgSwitchLanding } from "@/lib/org-switch";
import type { Identity } from "@/lib/identity";

const IDENTITY = {
  userId: "u1",
  displayName: "阿本",
  org: { id: "o1", name: "研发一部", kind: "cloud" },
  orgRole: "member",
  avatarUrl: null,
} as unknown as Identity;

/** 生产那条路的形状：Provider 罩住壳层与 children，壳层拿到 `onSwitchOrganization`。 */
function Shell({
  organizations, onSwitchOrganization, children,
}: {
  organizations: ReadonlyArray<{ id: string; label: string }>;
  onSwitchOrganization?: (orgId: string) => Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <ShellBusyProvider>
      <ShellChrome
        identity={IDENTITY}
        previewRole={null}
        organizations={organizations}
        onSwitchOrganization={onSwitchOrganization}
      >
        {children}
      </ShellChrome>
    </ShellBusyProvider>
  );
}

function Busy({ busy }: { busy: boolean }) {
  useReportShellBusy("chat:t1", busy);
  return <div data-testid="busy-child" />;
}

// F09：菜单是 Radix DropdownMenu，trigger 靠 pointerdown 开合，不是 click
//（见 `org-switcher-real-names.test.tsx` 头注里那条踩过的坑）。
function openOrgMenu() {
  const trigger = screen.getByTestId("org-switcher");
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.pointerDown(trigger, { button: 0 });
}

/** 选项是 `menuitemradio`，用 click 选中即触发 `onValueChange`。 */
function chooseOrg(id: string) {
  fireEvent.click(screen.getByTestId(`org-switcher-option-${id}`));
}

afterEach(() => { cleanup(); window.sessionStorage.clear(); });

describe("组织切换的落地确认（跨页面传递）", () => {
  it("记一次、读一次即清", () => {
    rememberOrgSwitch({ toLabel: "市场部", fromLabel: "研发一部", runsLeftBehind: 2 });
    expect(takeOrgSwitchLanding()).toEqual({ toLabel: "市场部", fromLabel: "研发一部", runsLeftBehind: 2 });
    expect(takeOrgSwitchLanding()).toBeNull();
  });

  it("撤回后读不到——切换失败不该在下一次跳转弹假消息", () => {
    rememberOrgSwitch({ toLabel: "市场部", fromLabel: "研发一部", runsLeftBehind: 1 });
    forgetOrgSwitch();
    expect(takeOrgSwitchLanding()).toBeNull();
  });

  it("存的不是合法 JSON / 缺 toLabel 时当作没切过，不崩", () => {
    window.sessionStorage.setItem("wsx.org-switch.landing", "{不是 json");
    expect(takeOrgSwitchLanding()).toBeNull();
    window.sessionStorage.setItem("wsx.org-switch.landing", JSON.stringify({ fromLabel: "x" }));
    expect(takeOrgSwitchLanding()).toBeNull();
  });
});

describe("在途任务的措辞", () => {
  it("0 个任务不说话", () => {
    expect(describeRunsLeftBehind(0, "研发一部")).toBeNull();
  });
  it("说的是会跑完、去哪找，不是可能丢失", () => {
    const s = describeRunsLeftBehind(2, "研发一部")!;
    expect(s).toContain("2 个任务");
    expect(s).toContain("研发一部");
    expect(s).toMatch(/跑完/);
    expect(s).not.toMatch(/丢失|中断|取消/);
  });
});

describe("原型页回落的 URL 规则", () => {
  it("换掉 org、丢掉项目级参数、保留其余", () => {
    const u = new URL(buildOrgSwitchUrl("https://a.test/chat?org=o1&project=p&stage=s&pack=k&keep=1", "o2"));
    expect(u.searchParams.get("org")).toBe("o2");
    expect(u.searchParams.get("keep")).toBe("1");
    for (const k of ["project", "stage", "pack"]) expect(u.searchParams.get(k)).toBeNull();
  });
});

describe("壳层：切换的三段体感", () => {
  it("没有在途任务时不拦截，直接进入切换态并盖住旧内容", async () => {
    const onSwitch = vi.fn(() => new Promise<void>(() => {}));   // 悬着，停在切换中
    render(
      <Shell organizations={[{ id: "o1", label: "研发一部" }, { id: "o2", label: "市场部" }]} onSwitchOrganization={onSwitch}>
        <Busy busy={false} />
      </Shell>,
    );
    openOrgMenu();
    chooseOrg("o2");
    expect(screen.queryByTestId("org-switch-confirm")).toBeNull();
    const progress = await screen.findByTestId("org-switch-progress");
    expect(progress.textContent).toContain("市场部");
    expect(onSwitch).toHaveBeenCalledWith("o2");
  });

  it("有在途任务时先问，并说清任务会在原组织跑完", async () => {
    const onSwitch = vi.fn(() => new Promise<void>(() => {}));
    render(
      <Shell organizations={[{ id: "o1", label: "研发一部" }, { id: "o2", label: "市场部" }]} onSwitchOrganization={onSwitch}>
        <Busy busy />
      </Shell>,
    );
    openOrgMenu();
    chooseOrg("o2");
    const note = (await screen.findByTestId("org-switch-runs-note")).textContent ?? "";
    expect(note).toContain("1 个任务");
    expect(note).toContain("研发一部");
    expect(onSwitch).not.toHaveBeenCalled();          // 还没确认，不许已经切了
  });

  it("「留在这里」真的留下：不切、不留标记", async () => {
    const onSwitch = vi.fn(() => Promise.resolve());
    render(
      <Shell organizations={[{ id: "o1", label: "研发一部" }, { id: "o2", label: "市场部" }]} onSwitchOrganization={onSwitch}>
        <Busy busy />
      </Shell>,
    );
    openOrgMenu();
    chooseOrg("o2");
    fireEvent.click(screen.getByTestId("org-switch-cancel"));
    await waitFor(() => expect(screen.queryByTestId("org-switch-confirm")).toBeNull());
    expect(onSwitch).not.toHaveBeenCalled();
    expect(takeOrgSwitchLanding()).toBeNull();
  });

  it("确认后才切，并把落地信息留给下一页", async () => {
    const onSwitch = vi.fn(() => new Promise<void>(() => {}));
    render(
      <Shell organizations={[{ id: "o1", label: "研发一部" }, { id: "o2", label: "市场部" }]} onSwitchOrganization={onSwitch}>
        <Busy busy />
      </Shell>,
    );
    openOrgMenu();
    chooseOrg("o2");
    fireEvent.click(screen.getByTestId("org-switch-confirm-go"));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith("o2"));
    expect(takeOrgSwitchLanding()).toEqual({ toLabel: "市场部", fromLabel: "研发一部", runsLeftBehind: 1 });
  });

  it("切换失败时撤回标记——不留下一条「已切换到 X」的假消息", async () => {
    const onSwitch = vi.fn(() => Promise.reject(new Error("boom")));
    render(
      <Shell organizations={[{ id: "o1", label: "研发一部" }, { id: "o2", label: "市场部" }]} onSwitchOrganization={onSwitch}>
        <Busy busy={false} />
      </Shell>,
    );
    openOrgMenu();
    chooseOrg("o2");
    await waitFor(() => expect(screen.queryByTestId("org-switch-progress")).toBeNull());
    expect(takeOrgSwitchLanding()).toBeNull();
  });

  it("切换失败要说出来，并给一次重试——不能只是静悄悄地什么都没发生", async () => {
    const onSwitch = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce(() => new Promise<void>(() => {}));
    render(
      <Shell organizations={[{ id: "o1", label: "研发一部" }, { id: "o2", label: "市场部" }]} onSwitchOrganization={onSwitch}>
        <Busy busy={false} />
      </Shell>,
    );
    openOrgMenu();
    chooseOrg("o2");
    const box = await screen.findByTestId("org-switch-failed");
    expect(box.textContent).toContain("市场部");
    expect(box.textContent).toContain("仍然在原来的组织里");
    fireEvent.click(screen.getByTestId("org-switch-retry"));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("org-switch-failed")).toBeNull());
  });

  it("「知道了」关掉失败提示，且不留下落地标记", async () => {
    const onSwitch = vi.fn(() => Promise.reject(new Error("boom")));
    render(
      <Shell organizations={[{ id: "o1", label: "研发一部" }, { id: "o2", label: "市场部" }]} onSwitchOrganization={onSwitch}>
        <Busy busy={false} />
      </Shell>,
    );
    openOrgMenu();
    chooseOrg("o2");
    fireEvent.click(await screen.findByTestId("org-switch-failed-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("org-switch-failed")).toBeNull());
    expect(takeOrgSwitchLanding()).toBeNull();
  });

  it("新页面挂载时读到标记就确认落地，并说出任务留在哪", async () => {
    rememberOrgSwitch({ toLabel: "市场部", fromLabel: "研发一部", runsLeftBehind: 3 });
    render(
      <Shell organizations={[{ id: "o1", label: "研发一部" }]}>
        <div />
      </Shell>,
    );
    const landed = await screen.findByTestId("org-switch-landed");
    expect(landed.textContent).toContain("已切换到");
    expect(landed.textContent).toContain("市场部");
    expect((await screen.findByTestId("org-switch-landed-note")).textContent).toContain("3 个任务");
  });

  it("严格模式下 effect 跑两次也不把落地信息冲掉", async () => {
    // 2026-09-23 真浏览器实测抓到的：第一次读走并置位，第二次读到 null 覆盖掉，
    // 结果标记被消费了而提示从没出现。RTL 默认不套 StrictMode，所以这条要显式套。
    rememberOrgSwitch({ toLabel: "市场部", fromLabel: "研发一部", runsLeftBehind: 1 });
    render(
      <React.StrictMode>
        <Shell organizations={[{ id: "o1", label: "研发一部" }]}>
          <div />
        </Shell>
      </React.StrictMode>,
    );
    const landed = await screen.findByTestId("org-switch-landed");
    expect(landed.textContent).toContain("市场部");
  });

  it("没切换过就不弹落地确认", async () => {
    render(<Shell organizations={[{ id: "o1", label: "研发一部" }]}><div /></Shell>);
    await waitFor(() => expect(screen.getByTestId("app-shell")).toBeTruthy());
    expect(screen.queryByTestId("org-switch-landed")).toBeNull();
  });
});

/**
 * 接线核对。**这是静态痕迹，不是动态事实**——它只证明聊天外壳把 `runState.isRunning`
 * 交给了登记函数，不证明那个值在真栈里是对的。放它在这里是因为：上面那些行为测试
 * 用的是测试自己的 `Busy` 组件，如果生产侧根本没人登记，`busyCount` 恒为 0，
 * 确认门就是一个永远不会触发的门（本仓栽过：红 ≠ 跑过）。这一条钉住那个缺口。
 */
describe("生产侧确实有人登记在途任务", () => {
  it("聊天外壳把 runState.isRunning 登记给壳层", () => {
    const src = readFileSync(
      path.join(process.cwd(), "components/chat/copilotkit-v2-shell.tsx"),
      "utf8",
    );
    expect(src).toMatch(/useReportShellBusy\(\s*`chat:\$\{[^}]+\}`\s*,\s*runState\.isRunning\s*\)/);
  });
});
