/**
 * 2026-09-02 composer 三层结构——「+」菜单（`ComposerMenu`/`ComposerMenuItem`）与
 * 状态 chip（`ComposerStateChip`）的隔离组件测试。
 *
 * 钉住的是接线形状，不是 testid 存不存在：
 *  · 「+」开合、菜单项点击后先执行回调再关菜单、勾选项的 `aria-checked`；
 *  · outside-click / Escape 关闭（同 `chat-skill-mount-panel-auto-close.test.tsx` 的纪律）；
 *  · **接力**：菜单项把控制权交给另一个互斥槽（能力浮层）时，菜单自动关、浮层开——
 *    这是三层结构成立的前提（见 `chat-task-workbench-composer-menu.tsx` 文件头注）。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatPopoverCoordinatorProvider } from "@/components/chat/chat-popover-coordinator";
import { ComposerMenu, ComposerMenuItem, ComposerStateChip } from "@/components/chat/chat-task-workbench-composer-menu";
import { useCapabilityPopoverSlot } from "@/components/chat/chat-task-workbench-capability-picker";

function Menu({ onAttach, taskMode = false, onTask = () => {} }: { onAttach?: () => void; taskMode?: boolean; onTask?: () => void }) {
  return (
    <ComposerMenu disabled={false}>
      <ComposerMenuItem icon={<span />} label="添加材料" data-testid="chat-attachment-input" onSelect={onAttach ?? (() => {})} />
      <ComposerMenuItem icon={<span />} label="任务模式" checked={taskMode} data-testid="chat-task-workbench-composer-task-mode" onSelect={onTask} />
    </ComposerMenu>
  );
}

describe("ComposerMenu / ComposerMenuItem", () => {
  it("默认收起；点「+」展开 role=menu；点菜单项 ⇒ 先调回调、再关菜单", () => {
    const onAttach = vi.fn();
    render(<Menu onAttach={onAttach} />);
    const trigger = screen.getByTestId("chat-task-workbench-composer-menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("chat-task-workbench-composer-menu-panel")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const panel = screen.getByTestId("chat-task-workbench-composer-menu-panel");
    expect(panel).toHaveAttribute("role", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByTestId("chat-attachment-input"));
    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("chat-task-workbench-composer-menu-panel")).not.toBeInTheDocument();
  });

  it("勾选项是 menuitemcheckbox，aria-checked 跟随真实状态；普通项没有 aria-checked", () => {
    render(<Menu taskMode />);
    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-menu"));
    const task = screen.getByTestId("chat-task-workbench-composer-task-mode");
    expect(task).toHaveAttribute("role", "menuitemcheckbox");
    expect(task).toHaveAttribute("aria-checked", "true");
    const attach = screen.getByTestId("chat-attachment-input");
    expect(attach).toHaveAttribute("role", "menuitem");
    expect(attach).not.toHaveAttribute("aria-checked");
  });

  it("outside-click / Escape 关闭；面板内部 mousedown 不误关", () => {
    render(<Menu />);
    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-menu"));
    fireEvent.mouseDown(screen.getByTestId("chat-attachment-input"));
    expect(screen.getByTestId("chat-task-workbench-composer-menu-panel")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("chat-task-workbench-composer-menu-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-menu"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("chat-task-workbench-composer-menu-panel")).not.toBeInTheDocument();
  });

  it("接力：菜单项把控制权交给能力浮层槽 ⇒ 菜单关、浮层槽读到 open", () => {
    function Probe() {
      const [open, setOpen] = useCapabilityPopoverSlot();
      return (
        <>
          <span data-testid="probe-capability-open">{open ? "open" : "closed"}</span>
          <ComposerMenu disabled={false}>
            <ComposerMenuItem icon={<span />} label="选择能力" data-testid="chat-task-workbench-capability-picker" onSelect={() => setOpen(true)} />
          </ComposerMenu>
        </>
      );
    }
    render(
      <ChatPopoverCoordinatorProvider>
        <Probe />
      </ChatPopoverCoordinatorProvider>,
    );
    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-menu"));
    fireEvent.click(screen.getByTestId("chat-task-workbench-capability-picker"));
    expect(screen.getByTestId("probe-capability-open")).toHaveTextContent("open");
    expect(screen.queryByTestId("chat-task-workbench-composer-menu-panel")).not.toBeInTheDocument();
    // 反过来：再开菜单 ⇒ 能力浮层槽被抢走，读到 closed（同一时刻只开一个浮层）。
    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-menu"));
    expect(screen.getByTestId("probe-capability-open")).toHaveTextContent("closed");
  });
});

describe("ComposerStateChip", () => {
  it("主体点击与 ✕ 各自接到不同回调；✕ 有可访问名", () => {
    const onClick = vi.fn();
    const onClear = vi.fn();
    render(
      <ComposerStateChip
        label="市场研究"
        testId="chat-task-workbench-composer-capability-chip"
        clearTestId="chat-task-workbench-composer-capability-clear"
        clearLabel="取消指定能力，回到自动匹配"
        onClick={onClick}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByText("市场研究"));
    expect(onClick).toHaveBeenCalledTimes(1);
    const clear = screen.getByTestId("chat-task-workbench-composer-capability-clear");
    expect(clear).toHaveAttribute("aria-label", "取消指定能力，回到自动匹配");
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
