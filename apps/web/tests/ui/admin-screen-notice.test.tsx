/**
 * #1165 —— `AdminScreen` 页头提示的**三态**，以及成员配额屏属于哪一态。
 *
 * ## 这个文件为什么存在
 *
 * F160 摘掉成员配额屏的 `noticeOverride={<NoBackendNotice />}` 时，落进了
 * `noticeOverride ?? <SampleConfigNotice />` 的默认分支——于是一条讲**模型型号与定价**
 * 的提示出现在了配额屏上（人类 2026-08-14 截图实测）。
 *
 * 当时全套 UI 测试是绿的：没有任何一条断言「这块屏的页头上**不该**有什么」。
 * 断言「该有的都在」永远抓不到「多出来一条」。所以这里断的是**缺席**。
 *
 * ## 阳性对照不能省
 *
 * 只断言「配额屏没有那条文案」的话，把 `SampleConfigNotice` 整个删掉也能让它变绿。
 * 所以每条缺席断言都配一条在场断言：默认态的屏必须**仍然**渲染它。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => null,
  useSession: () => ({ session: null, identity: null }),
}));

import { MembersScreen } from "@/components/admin/members-screen";
import { AdminScreen } from "@/components/admin/admin-screen";
import { NoBackendNotice } from "@/components/admin/no-backend-notice";

afterEach(() => cleanup());

/** `SampleConfigNotice` 文案里最不可能被别处复用的一段。 */
const SAMPLE_NOTICE_TEXT = /型号、定价与条目/;

function shell(props: Partial<React.ComponentProps<typeof AdminScreen>> = {}) {
  return (
    <AdminScreen
      state="default"
      moduleLabel="测试"
      title="测试屏"
      intro="intro"
      emptyHint="empty"
      denialReason="denied"
      successMessage="ok"
      {...props}
    >
      <div>content</div>
    </AdminScreen>
  );
}

describe("AdminScreen 页头提示的三态", () => {
  it("① 默认态：不传任何提示 ⇒ 渲染「示例组织配置」（阳性对照，证明这条提示还活着）", () => {
    render(shell());
    expect(screen.getByText(SAMPLE_NOTICE_TEXT)).toBeInTheDocument();
  });

  it("② override 态：零后端的屏渲染自己的提示，且**不再**叠加示例配置那条", () => {
    render(shell({ noticeOverride: <NoBackendNotice /> }));
    expect(screen.getByTestId("admin-no-backend-notice")).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_NOTICE_TEXT)).toBeNull();
  });

  it("③ liveBacked 态：已读真库的屏，两条屏级提示一条都没有", () => {
    render(shell({ liveBacked: true }));
    expect(screen.queryByText(SAMPLE_NOTICE_TEXT)).toBeNull();
    expect(screen.queryByTestId("admin-no-backend-notice")).toBeNull();
  });
});

describe("成员与配额屏（#1165 的回归本体）", () => {
  it("页头**不出现**「型号、定价与条目为演示数据」——那条讲的是模型定价，与这块屏无关", () => {
    render(<MembersScreen state="default" />);
    expect(screen.queryByText(SAMPLE_NOTICE_TEXT)).toBeNull();
  });

  it("仍是 mock 的局部区块保留自己的提示：贴着区块说实话，不靠页头笼统覆盖", () => {
    render(<MembersScreen state="default" />);
    // ⚠ 那条提示挂在**限额策略 tab 内部**的「降级阈值三级」区块上（属 phase-03 F14，
    //   仍是 mock），而 Radix Tabs 不 forceMount 非激活面板——所以必须先切过去。
    //   这个「切了才看得到」本身就是本条要钉的形状：提示贴着区块，不在页头。
    fireEvent.mouseDown(screen.getByTestId("admin-members-tab-policy"), { button: 0 });
    const panel = screen.getByTestId("admin-members-tabpanel-policy");
    expect(within(panel).getByTestId("admin-no-backend-notice")).toBeInTheDocument();
    // 同时确认它**没有**跑到页头去：页头那条已经由 liveBacked 关掉了。
    expect(screen.queryByText(SAMPLE_NOTICE_TEXT)).toBeNull();
  });
});
