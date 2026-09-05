/**
 * F04（#2712）—— 暂停态（`PausedState`,
 * `components/agent-kernel/agent-kernel-units.tsx`）。
 *
 * `requirements/02-streaming-transport.md` R4 E4 / R6，`contracts/streaming-transport/
 * domain.md`「暂停：用户主动 / 系统保护性」两种，`ui.md` 的 data-testid 表：
 * `paused-user`（含 `paused-resume` 恢复按钮）与 `paused-system`（含
 * `paused-system-notify`/`paused-system-contact`，保护性暂停不提供直接恢复）。
 *
 * 依据等级：[原型]（ui-prototyper 已在签核阶段建成，`ui-preview/streaming-transport/
 * 08-paused-{system,user}.png`）。组件本身未改动，本次补的是把 feature_list.json
 * 该条 notes 逐字列出的断言面固化成回归门控，与同 sprint 的 F10/F14 同一先例
 * （只给已建原型补测试）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PausedState } from "@/components/agent-kernel/agent-kernel-units";

describe("PausedState variant=user：用户主动暂停，提供直接恢复", () => {
  it("data-testid=paused-user 存在，含 paused-resume 恢复按钮（可用）", () => {
    render(<PausedState variant="user" />);
    expect(screen.getByTestId("paused-user")).toBeInTheDocument();
    const resume = screen.getByTestId("paused-resume");
    expect(resume.tagName).toBe("BUTTON");
    expect(resume).toBeEnabled();
  });

  it("点击恢复执行后显示已恢复提示，恢复按钮不再出现", () => {
    render(<PausedState variant="user" />);
    fireEvent.click(screen.getByTestId("paused-resume"));
    expect(screen.getByTestId("saved")).toHaveTextContent("已恢复执行");
    expect(screen.queryByTestId("paused-resume")).not.toBeInTheDocument();
  });

  it("用户态不出现系统保护性暂停的通知/联系入口", () => {
    render(<PausedState variant="user" />);
    expect(screen.queryByTestId("paused-system-notify")).not.toBeInTheDocument();
    expect(screen.queryByTestId("paused-system-contact")).not.toBeInTheDocument();
  });
});

describe("PausedState variant=system：系统保护性暂停，不提供直接恢复", () => {
  it("data-testid=paused-system 存在，含 paused-system-notify 与 paused-system-contact", () => {
    render(<PausedState variant="system" />);
    expect(screen.getByTestId("paused-system")).toBeInTheDocument();
    expect(screen.getByTestId("paused-system-notify")).toBeInTheDocument();
    expect(screen.getByTestId("paused-system-contact")).toBeInTheDocument();
  });

  it("R4 E4：保护性暂停不提供直接恢复——不出现 paused-resume 按钮", () => {
    render(<PausedState variant="system" />);
    expect(screen.queryByTestId("paused-resume")).not.toBeInTheDocument();
  });

  it("说明文案点名「不能直接恢复」，不是仅靠按钮缺失隐晦表达", () => {
    render(<PausedState variant="system" />);
    expect(screen.getByTestId("paused-system")).toHaveTextContent("不能直接恢复");
  });
});
