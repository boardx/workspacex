/**
 * 2026-08-30 —— `ComposerMicControl` / `ComposerMicRecordingBar` 的隔离组件测试。
 *
 * 起因：上一轮把录音状态从悬浮弹窗改成内嵌行时，把设备二级菜单一并挪进了
 * `ComposerMicRecordingBar`（只在 connecting/listening/stopping 三态渲染，且在这
 * 三态下自己又是 disabled）——结果是设备菜单在它存在的每一刻都点不开，用户永远
 * 打不开设备列表。审查发现后改成挂在恒定渲染的 `ComposerMicControl` 上。这里钉住
 * 「设备菜单在 idle 态真的能点开」，防止同一个坑再摔一次；同时覆盖开始/连接/录音/
 * 停止/取消/确认的接线形状——不是只看 `data-testid` 存在，而是断言点击之后调用了
 * 正确的回调、正确的按钮被禁用。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComposerMicControl, ComposerMicRecordingBar } from "@/components/chat/chat-composer-mic-control";

const baseControlProps = {
  status: "idle" as const,
  listening: false,
  connecting: false,
  stopping: false,
  disabled: false,
  devices: [{ deviceId: "dev-1", label: "USB 麦克风" }],
  selectedDeviceId: null as string | null,
  onRequireSession: () => true,
};

describe("ComposerMicControl", () => {
  it("idle 态：设备二级菜单可见、可点开、可选中——不依赖录音已经开始", () => {
    const onSelectDevice = vi.fn();
    render(
      <ComposerMicControl
        {...baseControlProps}
        start={vi.fn()}
        stop={vi.fn()}
        onSelectDevice={onSelectDevice}
      />,
    );

    const deviceTrigger = screen.getByTestId("chat-task-workbench-composer-mic-devices");
    // 这是本轮要钉的核心断言：idle 态下菜单必须是**可交互**的，不是渲染出来但恒定禁用。
    expect(deviceTrigger).toBeEnabled();

    fireEvent.click(deviceTrigger);
    const listbox = screen.getByTestId("chat-task-workbench-composer-mic-devices-listbox");
    expect(listbox).toBeVisible();

    fireEvent.click(screen.getByRole("option", { name: "USB 麦克风" }));
    expect(onSelectDevice).toHaveBeenCalledWith("dev-1");
    // 选中后菜单自己关闭。
    expect(screen.queryByTestId("chat-task-workbench-composer-mic-devices-listbox")).not.toBeInTheDocument();
  });

  it("设备触发器默认隐藏（visibility），选了非默认设备或菜单打开时才常显——默认值不是信息", () => {
    const { rerender } = render(
      <ComposerMicControl {...baseControlProps} start={vi.fn()} stop={vi.fn()} onSelectDevice={vi.fn()} />,
    );
    const trigger = screen.getByTestId("chat-task-workbench-composer-mic-devices");
    // 2026-09-02 三层结构：默认 `invisible`，靠 group-hover / group-focus-within 露出；
    // 用 visibility 而不是 opacity 表达（uiux-standards U1.2）。仍然可交互（不是 disabled）。
    expect(trigger.className).toContain("invisible");
    expect(trigger.className).toContain("group-hover:visible");
    expect(trigger.className).toContain("group-focus-within:visible");
    expect(trigger).toBeEnabled();
    // 可访问名刻意不含"麦克风/语音"：TW-P0-5⑤ 按可访问名数入口，它是二级菜单不是第二个入口。
    expect(trigger.getAttribute("aria-label")).not.toMatch(/麦克风|语音/);

    rerender(
      <ComposerMicControl {...baseControlProps} selectedDeviceId="dev-1" start={vi.fn()} stop={vi.fn()} onSelectDevice={vi.fn()} />,
    );
    expect(screen.getByTestId("chat-task-workbench-composer-mic-devices").className).not.toContain("invisible");

    rerender(
      <ComposerMicControl {...baseControlProps} start={vi.fn()} stop={vi.fn()} onSelectDevice={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-mic-devices"));
    expect(screen.getByTestId("chat-task-workbench-composer-mic-devices").className).not.toContain("invisible");
  });

  it("录音中（listening）：设备菜单禁用，不可再点开", () => {
    render(
      <ComposerMicControl
        {...baseControlProps}
        listening
        start={vi.fn()}
        stop={vi.fn()}
        onSelectDevice={vi.fn()}
      />,
    );
    const deviceTrigger = screen.getByTestId("chat-task-workbench-composer-mic-devices");
    expect(deviceTrigger).toBeDisabled();
  });

  it("点击麦克风按钮：idle → 调 start()；listening → 调 stop()", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { rerender } = render(
      <ComposerMicControl {...baseControlProps} start={start} stop={stop} onSelectDevice={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-mic"));
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    rerender(
      <ComposerMicControl {...baseControlProps} listening start={start} stop={stop} onSelectDevice={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-mic"));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("onRequireSession 拒绝时（未登录）：点击麦克风不触发 start/stop", () => {
    const start = vi.fn();
    render(
      <ComposerMicControl
        {...baseControlProps}
        start={start}
        stop={vi.fn()}
        onSelectDevice={vi.fn()}
        onRequireSession={() => false}
      />,
    );
    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-mic"));
    expect(start).not.toHaveBeenCalled();
  });
});

describe("ComposerMicRecordingBar", () => {
  const baseBarProps = {
    listening: true,
    connecting: false,
    stopping: false,
    elapsedSeconds: 65,
    level: 0.42,
  };

  it("状态文案有 aria-live，容器有 role=status——状态切换时能被读屏软件感知", () => {
    render(<ComposerMicRecordingBar {...baseBarProps} stop={vi.fn()} cancel={vi.fn()} />);
    const panel = screen.getByTestId("chat-task-workbench-composer-recording-panel");
    expect(panel).toHaveAttribute("role", "status");
    expect(screen.getByText("正在录音")).toHaveAttribute("aria-live", "polite");
    // 计时/音量真实反映 props，不是写死文案。
    expect(screen.getByTestId("chat-task-workbench-composer-recording-timer")).toHaveTextContent("01:05");
    expect(screen.getByTestId("chat-task-workbench-composer-recording-level")).toHaveAttribute("data-level", "0.420");
  });

  it("connecting/stopping 三态各自的状态文案", () => {
    const { rerender } = render(
      <ComposerMicRecordingBar {...baseBarProps} connecting listening={false} stop={vi.fn()} cancel={vi.fn()} />,
    );
    expect(screen.getByText("正在连接…")).toBeInTheDocument();

    rerender(<ComposerMicRecordingBar {...baseBarProps} stopping listening={false} stop={vi.fn()} cancel={vi.fn()} />);
    expect(screen.getByText("正在停止…")).toBeInTheDocument();
  });

  it("确认 = 调 stop()（保留转录）；取消 = 调 cancel()（丢弃转录）", () => {
    const stop = vi.fn();
    const cancel = vi.fn();
    render(<ComposerMicRecordingBar {...baseBarProps} stop={stop} cancel={cancel} />);

    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-recording-confirm"));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-recording-cancel"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("connecting 时确认被禁用（还没真的连上，没什么可保留的）", () => {
    render(<ComposerMicRecordingBar {...baseBarProps} connecting listening={false} stop={vi.fn()} cancel={vi.fn()} />);
    expect(screen.getByTestId("chat-task-workbench-composer-recording-confirm")).toBeDisabled();
  });

  it("stopping 时取消被禁用（已经在收尾，不能半路丢弃）", () => {
    render(<ComposerMicRecordingBar {...baseBarProps} stopping listening={false} stop={vi.fn()} cancel={vi.fn()} />);
    expect(screen.getByTestId("chat-task-workbench-composer-recording-cancel")).toBeDisabled();
  });
});
