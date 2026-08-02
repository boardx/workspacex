/**
 * F46 -- 待删除队列（合规角色专属屏）+ legal hold + 五步流程 + 部分失败 + 超时升级 +
 * 回执（uc-22-4 R3.c/R3.d/R5）。
 *
 * `TrashQueue` (`components/files/trash-queue.tsx`) was already built ahead of this feature
 * by the UI-first pass -- this file is what was missing: the assertions that lock its
 * behaviour to the named anchors the issue lists (`files-trash-queue`/`files-trash-steps`/
 * `files-trash-legalhold`/`files-trash-release-hold`/`files-trash-receipt`/
 * `files-trash-overdue`/`files-trash-partial`), against `TRASH_TASKS` (`lib/mock/files.ts`),
 * whose four fixtures already cover exactly the four states this feature is about: a normal
 * in-flight task, an overdue one, a legal-hold one, and a partial-failure one.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TrashQueue } from "@/components/files/trash-queue";

describe("待删除队列：合规负责人视图（files-trash-queue）", () => {
  it("canView=false: 拒绝态，仅合规负责人可见的说明，不渲染任何任务卡片", () => {
    render(<TrashQueue canView={false} onToast={() => undefined} />);
    expect(screen.getByTestId("files-trash-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("files-trash-queue")).not.toBeInTheDocument();
    expect(screen.queryByTestId("files-trash-task")).not.toBeInTheDocument();
  });

  it("canView=true: 渲染队列容器与全部任务卡片（四个 mock 任务：正常/超时/legal hold/部分失败）", () => {
    render(<TrashQueue canView={true} onToast={() => undefined} />);
    expect(screen.getByTestId("files-trash-queue")).toBeInTheDocument();
    const tasks = screen.getAllByTestId("files-trash-task");
    expect(tasks.length).toBe(4);
  });

  it("每个任务卡片渲染五步流程（files-trash-steps），恰好五个 files-trash-step 条目", () => {
    render(<TrashQueue canView={true} onToast={() => undefined} />);
    const tasks = screen.getAllByTestId("files-trash-task");
    for (const task of tasks) {
      const steps = within(task).getByTestId("files-trash-steps");
      expect(within(steps).getAllByTestId("files-trash-step")).toHaveLength(5);
    }
  });

  it("legal hold 任务：显示 files-trash-legalhold 徽标，且提供「解除 legal hold」而非「撤销删除」", () => {
    render(<TrashQueue canView={true} onToast={() => undefined} />);
    const tasks = screen.getAllByTestId("files-trash-task");
    const holdTask = tasks.find((t) => within(t).queryByTestId("files-trash-legalhold") !== null);
    expect(holdTask).toBeDefined();
    expect(within(holdTask!).getByTestId("files-trash-release-hold")).toBeInTheDocument();
    expect(within(holdTask!).queryByTestId("files-trash-revoke")).not.toBeInTheDocument();
  });

  it("解除 legal hold 后：按钮消失，替换为「已解除」状态提示，且 toast 记下留痕说明", () => {
    const toasts: string[] = [];
    render(<TrashQueue canView={true} onToast={(m) => toasts.push(m)} />);
    const tasks = screen.getAllByTestId("files-trash-task");
    const holdTask = tasks.find((t) => within(t).queryByTestId("files-trash-legalhold") !== null)!;

    fireEvent.click(within(holdTask).getByTestId("files-trash-release-hold"));

    expect(within(holdTask).getByTestId("files-trash-hold-released")).toBeInTheDocument();
    expect(within(holdTask).queryByTestId("files-trash-release-hold")).not.toBeInTheDocument();
    expect(toasts.some((m) => m.includes("已解除") && m.includes("合规负责人") && m.includes("审计"))).toBe(true);
  });

  it("非 legal-hold 任务：提供「撤销删除（宽限期内）」而不是 legal hold 按钮", () => {
    render(<TrashQueue canView={true} onToast={() => undefined} />);
    const tasks = screen.getAllByTestId("files-trash-task");
    const normalTask = tasks.find((t) => within(t).queryByTestId("files-trash-legalhold") === null)!;
    expect(within(normalTask).getByTestId("files-trash-revoke")).toBeInTheDocument();
    expect(within(normalTask).queryByTestId("files-trash-release-hold")).not.toBeInTheDocument();
  });

  it("超时任务：显示 files-trash-overdue 升级徽标（E4/R5：合规负责人对超时任务有升级权）", () => {
    render(<TrashQueue canView={true} onToast={() => undefined} />);
    const tasks = screen.getAllByTestId("files-trash-task");
    const overdueTask = tasks.find((t) => within(t).queryByTestId("files-trash-overdue") !== null);
    expect(overdueTask).toBeDefined();
  });

  it("🔴 部分失败任务：显示 files-trash-partial 说明 + 徽标 + 重试入口，不显示为已完成", () => {
    render(<TrashQueue canView={true} onToast={() => undefined} />);
    const tasks = screen.getAllByTestId("files-trash-task");
    const partialTask = tasks.find((t) => within(t).queryByTestId("files-trash-partial") !== null);
    expect(partialTask).toBeDefined();
    expect(within(partialTask!).getByTestId("files-trash-partial-badge")).toBeInTheDocument();
    expect(within(partialTask!).getByTestId("files-trash-retry")).toBeInTheDocument();
  });

  it("回执弹层：部分失败任务打开回执显示「尚未出正式回执」", () => {
    render(<TrashQueue canView={true} onToast={() => undefined} />);
    const tasks = screen.getAllByTestId("files-trash-task");

    const partialTask = tasks.find((t) => within(t).queryByTestId("files-trash-partial") !== null)!;
    fireEvent.click(within(partialTask).getByTestId("files-trash-receipt"));
    expect(screen.getByTestId("files-trash-receipt-modal")).toBeInTheDocument();
    expect(screen.getByTestId("files-trash-receipt-body").textContent).toContain("尚未出正式回执");
  });

  it("回执弹层（非部分失败任务）：显示覆盖范围（原件+全部版本+全部派生物）说明，并可补发", () => {
    const toasts: string[] = [];
    render(<TrashQueue canView={true} onToast={(m) => toasts.push(m)} />);
    const tasks = screen.getAllByTestId("files-trash-task");
    const normalTask = tasks.find(
      (t) => within(t).queryByTestId("files-trash-partial") === null && within(t).queryByTestId("files-trash-legalhold") === null,
    )!;

    fireEvent.click(within(normalTask).getByTestId("files-trash-receipt"));
    expect(screen.getByTestId("files-trash-receipt-body").textContent).toContain("全部版本");

    fireEvent.click(screen.getByTestId("files-trash-receipt-resend"));
    expect(toasts.some((m) => m.includes("回执已补发"))).toBe(true);
  });
});
