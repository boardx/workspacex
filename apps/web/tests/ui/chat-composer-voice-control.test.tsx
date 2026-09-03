/**
 * 2026-09-02 composer 重设计——分段语音胶囊 `ComposerVoiceControl` 的隔离组件测试。
 * 钉住：一个按钮承载全部状态（文案 / aria-label 与状态一一对应，TW-A11Y-6）、点击接线
 * （start / stop / resume）、右侧小箭头菜单（设备列表 + 静音自动暂停开关）、
 * 箭头可访问名不含"麦克风/语音"（TW-P0-5⑤ 只数一个入口）。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComposerVoiceControl, describeVoiceDevice, formatElapsed } from "@/components/chat/chat-composer-voice-control";

const base = {
  elapsedSeconds: 0,
  level: 0,
  disabled: false,
  onRequireSession: () => true,
  devices: [{ deviceId: "dev-1", label: "USB 麦克风" }],
  selectedDeviceId: null as string | null,
  onSelectDevice: vi.fn(),
  autoPause: true,
  onAutoPauseChange: vi.fn(),
};

function renderCtl(over: Partial<React.ComponentProps<typeof ComposerVoiceControl>>) {
  const onStart = vi.fn(); const onStop = vi.fn(); const onResume = vi.fn();
  render(<ComposerVoiceControl status="idle" phase="idle" onStart={onStart} onStop={onStop} onResume={onResume} {...base} {...over} />);
  return { onStart, onStop, onResume };
}

describe("ComposerVoiceControl", () => {
  it("idle：「语音」，点击 → onStart；aria-label=开始语音输入", () => {
    const h = renderCtl({});
    const mic = screen.getByTestId("chat-task-workbench-composer-mic");
    expect(mic).toHaveTextContent("语音");
    expect(mic).toHaveAttribute("aria-label", "开始语音输入");
    expect(mic).toHaveAttribute("data-mic-status", "idle");
    fireEvent.click(mic);
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it("listening：「停止」+ 音量条 + 计时，点击 → onStop；aria-label=停止语音输入", () => {
    const h = renderCtl({ status: "listening", phase: "listening", elapsedSeconds: 65, level: 0.4 });
    const mic = screen.getByTestId("chat-task-workbench-composer-mic");
    expect(mic).toHaveTextContent("停止");
    expect(mic).toHaveAttribute("aria-label", "停止语音输入");
    expect(mic).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("chat-task-workbench-composer-recording-timer")).toHaveTextContent("01:05");
    expect(screen.getByTestId("chat-task-workbench-composer-recording-level")).toHaveAttribute("data-level", "0.400");
    fireEvent.click(mic);
    expect(h.onStop).toHaveBeenCalledTimes(1);
    expect(h.onStart).not.toHaveBeenCalled();
  });

  it("paused：「继续 mm:ss」，点击 → onResume；connecting / stopping 禁用并旋转", () => {
    const h = renderCtl({ status: "idle", phase: "paused", elapsedSeconds: 7 });
    const mic = screen.getByTestId("chat-task-workbench-composer-mic");
    expect(mic).toHaveTextContent("继续");
    expect(mic).toHaveTextContent("00:07");
    fireEvent.click(mic);
    expect(h.onResume).toHaveBeenCalledTimes(1);
  });

  it("connecting：禁用、aria-busy、文案「连接中」；error：「重试」且点击 → onStart", () => {
    renderCtl({ status: "connecting", phase: "connecting" });
    const mic = screen.getByTestId("chat-task-workbench-composer-mic");
    expect(mic).toBeDisabled();
    expect(mic).toHaveAttribute("aria-busy", "true");
    expect(mic).toHaveTextContent("连接中");
    expect(mic).toHaveAttribute("aria-label", "正在连接语音识别…");
  });

  it("error：「重试」，aria-label 回到开始语音输入（它的动作就是重新开始）", () => {
    const h = renderCtl({ status: "error", phase: "error" });
    const mic = screen.getByTestId("chat-task-workbench-composer-mic");
    expect(mic).toHaveTextContent("重试");
    expect(mic).toHaveAttribute("aria-label", "开始语音输入");
    fireEvent.click(mic);
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it("小箭头：可访问名不含麦克风/语音；点开有设备列表 + 静音自动暂停开关；选设备后关闭", () => {
    const onSelectDevice = vi.fn(); const onAutoPauseChange = vi.fn();
    renderCtl({ onSelectDevice, onAutoPauseChange });
    const chevron = screen.getByTestId("chat-task-workbench-composer-mic-devices");
    expect(chevron.getAttribute("aria-label")).not.toMatch(/麦克风|语音/);
    fireEvent.click(chevron);
    const menu = screen.getByTestId("chat-task-workbench-composer-mic-devices-listbox");
    expect(menu).toBeVisible();
    const toggle = screen.getByTestId("chat-task-workbench-composer-mic-silence-autopause");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(onAutoPauseChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "USB 麦克风" }));
    expect(onSelectDevice).toHaveBeenCalledWith("dev-1");
    expect(screen.queryByTestId("chat-task-workbench-composer-mic-devices-listbox")).not.toBeInTheDocument();
  });

  it("录音中设备项禁用（录音那一刻已读取设备），开关仍可用", () => {
    renderCtl({ status: "listening", phase: "listening" });
    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-mic-devices"));
    expect(screen.getByRole("menuitemradio", { name: "USB 麦克风" })).toBeDisabled();
    expect(screen.getByTestId("chat-task-workbench-composer-mic-silence-autopause")).toBeEnabled();
  });

  it("deviceMenuRequest 递增（状态栏「换麦克风」）⇒ 打开菜单", () => {
    const { rerender } = render(<ComposerVoiceControl status="idle" phase="idle" onStart={vi.fn()} onStop={vi.fn()} onResume={vi.fn()} {...base} deviceMenuRequest={0} />);
    expect(screen.queryByTestId("chat-task-workbench-composer-mic-devices-listbox")).not.toBeInTheDocument();
    rerender(<ComposerVoiceControl status="idle" phase="idle" onStart={vi.fn()} onStop={vi.fn()} onResume={vi.fn()} {...base} deviceMenuRequest={1} />);
    expect(screen.getByTestId("chat-task-workbench-composer-mic-devices-listbox")).toBeInTheDocument();
  });

  it("onRequireSession 拒绝（未登录）⇒ 不触发 start", () => {
    const h = renderCtl({ onRequireSession: () => false });
    fireEvent.click(screen.getByTestId("chat-task-workbench-composer-mic"));
    expect(h.onStart).not.toHaveBeenCalled();
  });

  it("describeVoiceDevice / formatElapsed", () => {
    expect(describeVoiceDevice(base.devices, null)).toBe("系统默认麦克风");
    expect(describeVoiceDevice(base.devices, "dev-1")).toBe("USB 麦克风");
    expect(describeVoiceDevice([{ deviceId: "x", label: "" }], "x")).toBe("麦克风 1（授权后显示名称）");
    expect(formatElapsed(65)).toBe("01:05");
  });
});
