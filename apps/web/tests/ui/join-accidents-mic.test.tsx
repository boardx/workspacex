/**
 * F13 · 免注册进场「三种意外」+ 麦克风授权开关（`join-wrong-group` / `join-not-listed` /
 * `join-reconnect` / `group-mic-toggle`，uc-1-2 R4）。
 *
 * 纯前端断言，不碰数据库、不碰网络——三种意外的界面在 F12 原型阶段已经建成
 * （`JoinForm` 的 `scene` 维度），本文件是 F13 R11「三种意外各自独立验收」
 * 在前端测试层面的落点：逐条给自己一个 describe 块，不合并成一条泛化断言。
 * 麦克风开关的「可读 + 可切换」落在 `GroupWorkbench`。
 */
import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { JoinForm } from "@/components/entry/join-form";
import { GroupWorkbench } from "@/components/entry/group-workbench";
import { JOIN_CONTEXT } from "@/lib/mock/entry";

describe("F13 · 意外① 打开别组链接：不报错，提示「你在第 N 组」", () => {
  it("join-wrong-group 可见，文案报出 JOIN_CONTEXT.groupNo，提供进组入口", () => {
    const { container, unmount } = render(<JoinForm state="default" scene="wrong-group" role="member" />);
    const banner = container.querySelector('[data-testid="join-wrong-group"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain(`你在第 ${JOIN_CONTEXT.groupNo} 组`);

    const enter = container.querySelector('[data-testid="join-enter"]');
    expect(enter).not.toBeNull();
    unmount();
  });

  it("不是错误态——不出现 StateShell 的拒绝/报错文案，且明说「这不是错误」", () => {
    const { container, unmount } = render(<JoinForm state="default" scene="wrong-group" role="member" />);
    expect(container.textContent).not.toMatch(/失败|不存在|请找引导师重发/);
    expect(container.textContent).toContain("这不是错误");
    unmount();
  });
});

describe("F13 · 意外② 不在名单：先停在门口，申请加入 → 待批 → 批准/拒绝三态", () => {
  it("join-not-listed 可见，批准前只看到「向引导师申请加入」，读不到任何本组内容", () => {
    const { container, unmount } = render(<JoinForm state="default" scene="not-listed" role="member" />);
    expect(container.querySelector('[data-testid="join-not-listed"]')).not.toBeNull();
    const status = container.querySelector('[data-testid="join-not-listed"]');
    expect(status?.textContent).toContain("在引导师批准前，你还进不了任何组、看不到任何内容");

    const applyBtn = container.querySelector('[data-testid="join-apply"]') as HTMLButtonElement;
    expect(applyBtn).not.toBeNull();
    // 待批前不应该出现任何组内容的 testid（本组画布 / 便签板）。
    expect(container.querySelector('[data-testid="group-canvas"]')).toBeNull();
    expect(container.querySelector('[data-testid="group-stickies"]')).toBeNull();
    unmount();
  });

  it("点击「向引导师申请加入」⇒ 出现「等待中」——分组与签到面待批状态的界面投影", () => {
    const { container, unmount } = render(<JoinForm state="default" scene="not-listed" role="member" />);
    const applyBtn = container.querySelector('[data-testid="join-apply"]') as HTMLButtonElement;
    fireEvent.click(applyBtn);

    const status = container.querySelector('[data-testid="join-apply-status"]');
    expect(status?.textContent).toContain("等待中");
    expect(container.querySelector('[data-testid="join-apply"]')).toBeNull();
    unmount();
  });

  it("批准 ⇒ 「已批准」且指出落地组号；拒绝 ⇒ 「已拒绝」（三态各自可达）", () => {
    const approved = render(<JoinForm state="default" scene="not-listed" role="member" />);
    fireEvent.click(approved.container.querySelector('[data-testid="join-apply"]') as HTMLButtonElement);
    fireEvent.click(approved.container.querySelector('[data-testid="join-apply-approve"]') as HTMLButtonElement);
    const approvedStatus = approved.container.querySelector('[data-testid="join-apply-status"]');
    expect(approvedStatus?.textContent).toContain("已批准");
    expect(approvedStatus?.textContent).toContain(`第 ${JOIN_CONTEXT.groupNo} 组`);
    approved.unmount();

    const rejected = render(<JoinForm state="default" scene="not-listed" role="member" />);
    fireEvent.click(rejected.container.querySelector('[data-testid="join-apply"]') as HTMLButtonElement);
    fireEvent.click(rejected.container.querySelector('[data-testid="join-apply-reject"]') as HTMLButtonElement);
    expect(rejected.container.querySelector('[data-testid="join-apply-status"]')?.textContent).toContain("已拒绝");
    rejected.unmount();
  });
});

describe("F13 · 意外③ 掉线/换设备重开链接：回到同一组同一环节，产出不丢，旧设备失效", () => {
  it("join-reconnect 先展示接管中，验证后展示「已回到环节」且提示旧设备会话已失效", () => {
    const { container, unmount } = render(<JoinForm state="default" scene="reconnect" role="member" />);
    expect(container.querySelector('[data-testid="join-reconnect"]')).not.toBeNull();
    const verifyBtn = container.querySelector('[data-testid="join-reconnect-verify"]') as HTMLButtonElement;
    expect(verifyBtn).not.toBeNull();
    expect(container.querySelector('[data-testid="join-continue"]')).toBeNull();

    fireEvent.click(verifyBtn);

    const recovered = container.querySelector('[data-testid="join-reconnect"]');
    expect(recovered?.textContent).toContain("已回到环节");
    expect(recovered?.textContent).toContain("旧设备上的会话已被接管失效");
    expect(recovered?.textContent).toMatch(/产出.*没丢|没丢.*产出|一条没丢/);
    expect(container.querySelector('[data-testid="join-continue"]')).not.toBeNull();
    unmount();
  });
});

describe("F13 · 麦克风授权开关：常驻可见，状态可读，开关可切换", () => {
  it("默认转录中；点击开关后变已关闭；再点回转录中——状态可读、可切换、可逆", () => {
    const { container, unmount } = render(<GroupWorkbench state="default" role="member" />);
    const status = () => container.querySelector('[data-testid="group-mic-status"]');
    const toggle = container.querySelector('[data-testid="group-mic-toggle"]') as HTMLElement;
    expect(toggle).not.toBeNull();

    expect(status()?.textContent).toContain("转录中");

    fireEvent.click(toggle);
    expect(status()?.textContent).toContain("已关闭");

    fireEvent.click(toggle);
    expect(status()?.textContent).toContain("转录中");
    unmount();
  });

  it("关掉麦克风不阻断进场/协作——本组画布与添加便签的入口仍然可见", () => {
    const { container, unmount } = render(<GroupWorkbench state="default" role="member" />);
    const toggle = container.querySelector('[data-testid="group-mic-toggle"]') as HTMLElement;
    fireEvent.click(toggle);

    expect(container.querySelector('[data-testid="group-mic-status"]')?.textContent).toContain("已关闭");
    expect(container.querySelector('[data-testid="group-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="group-add-sticky"]')).not.toBeNull();
    // 关掉麦克风不阻断，但语音转便签这一具体动作确实依赖麦克风——按钮仍在，只是被禁用。
    const voiceBtn = container.querySelector('[data-testid="group-voice-sticky"]') as HTMLButtonElement;
    expect(voiceBtn).not.toBeNull();
    expect(voiceBtn.disabled).toBe(true);
    unmount();
  });

  it("麦克风常驻可见：七态里的非 default 态（如 loading）也能看到开关与状态", () => {
    const { container, unmount } = render(<GroupWorkbench state="loading" role="member" />);
    expect(container.querySelector('[data-testid="group-mic-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="group-mic-status"]')).not.toBeNull();
    unmount();
  });
});
