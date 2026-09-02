import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Gap #9（人类 2026-08-22 devapp 真实浏览器实测，P2）——点击 skill 快捷列表里的一个
 * skill 完成挂载后，浮层不会自动收起，需要用户额外点一次别处才能关闭，容易造成
 * "是不是没点中"的困惑，也容易误触连续挂载多个。
 *
 * 根因：此前 `setPicking(false)` 等 `mountSkills` 网络往返真的返回才触发——网络
 * 稍有延迟时，用户点完看不到任何即时反馈。修法：点击这一刻就**乐观关闭**浮层，
 * `mountSkills` 失败再重新打开并展示错误。
 *
 * 本用例用一个手动可控的 promise 钉住这个时序：
 * ① 点击候选项 ⇒ 浮层在网络请求**返回之前**就已经关闭（不是等成功回包才关）。
 * ② 请求最终失败 ⇒ 浮层重新打开、展示错误，用户可以重试或换一个 skill。
 * ③ 请求最终成功 ⇒ 浮层保持关闭（不会因为重读挂载列表又弹回来）。
 *
 * 反证：把乐观关闭去掉、改回"等 await 完成才关" ⇒ ①必红（`waitForClose` 之前
 * 断言浮层已消失会失败）；把失败分支的 `setPicking(true)` 去掉 ⇒ ②必红。
 */

const { listThreadMounts, mountSkills, unmountSkill, listSkills } = vi.hoisted(() => ({
  listThreadMounts: vi.fn(),
  mountSkills: vi.fn(),
  unmountSkill: vi.fn(),
  listSkills: vi.fn(),
}));

vi.mock("@/lib/live-skill-mount", () => ({
  listThreadMounts: (...a: unknown[]) => listThreadMounts(...a),
  mountSkills: (...a: unknown[]) => mountSkills(...a),
  unmountSkill: (...a: unknown[]) => unmountSkill(...a),
}));
vi.mock("@/lib/live-skill", () => ({ listSkills: (...a: unknown[]) => listSkills(...a) }));
vi.mock("@/components/chat/chat-live-message-panel", () => ({
  ChatLiveMessagePanel: () => <div data-testid="stub-message-panel" />,
  describeMessageFailure: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock("@/components/feedback/feedback-button", () => ({
  FeedbackButton: () => <button data-testid="stub-feedback-button" />,
}));

import { ChatSkillMountPanel } from "@/components/chat/chat-skill-mount-panel";

// `duty` 是 `SkillListItem` 契约里的必填字段（`packages/contracts/src/skills.ts`）。
const SKILL_POOL = [{ skillId: "sk_aaa", name: "pptx", status: "已启用" as const, duty: "生成演示文稿" }];

/** 手动可控的 promise：拿到 resolve/reject 之后再决定什么时候让 `mountSkills` 落定。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  listThreadMounts.mockReset().mockResolvedValue({ temporary: [], version: "0" });
  mountSkills.mockReset();
  unmountSkill.mockReset();
  listSkills.mockReset().mockResolvedValue(SKILL_POOL);
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderPanel() {
  return render(
    <ChatSkillMountPanel threadId="thr-1" projectId={undefined} orgId="org-1" bearer="bearer-1" />,
  );
}

async function openPickerAndClickSkill() {
  fireEvent.click(await screen.findByTestId("chat-skill-mount"));
  await screen.findByTestId("chat-skill-mount-picker");
  fireEvent.click(await screen.findByTestId("chat-skill-mount-option-sk_aaa"));
}

describe("ChatSkillMountPanel 挂载点击后的浮层开关（gap #9，乐观关闭）", () => {
  it("点击候选项 ⇒ 浮层在网络请求返回之前就已经关闭；请求最终成功 ⇒ 保持关闭", async () => {
    const gate = deferred<void>();
    mountSkills.mockReturnValue(gate.promise);
    listThreadMounts.mockResolvedValueOnce({ temporary: [], version: "0" });
    listThreadMounts.mockResolvedValueOnce({
      temporary: [{ mountId: "m1", threadId: "thr-1", skillId: "sk_aaa", versionId: "v1", mountedAt: "2026-08-23T00:00:00.000Z" }],
      version: "1",
    });

    renderPanel();
    await openPickerAndClickSkill();

    // ⭐ 核心断言 ①：请求还没落定，浮层已经不在——不是等成功回包才关。
    expect(screen.queryByTestId("chat-skill-mount-picker")).not.toBeInTheDocument();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    // 成功落定之后（含重读挂载列表）浮层依然保持关闭，不会又弹回来。
    await waitFor(() => expect(listThreadMounts).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("chat-skill-mount-picker")).not.toBeInTheDocument();
  });

  it("点击候选项 ⇒ 浮层先关闭；请求最终失败 ⇒ 浮层重新打开并展示错误", async () => {
    const gate = deferred<void>();
    mountSkills.mockReturnValue(gate.promise);

    renderPanel();
    await openPickerAndClickSkill();

    // 点击这一刻浮层已经关闭（乐观关闭）。
    expect(screen.queryByTestId("chat-skill-mount-picker")).not.toBeInTheDocument();

    await act(async () => {
      gate.reject(new Error("网络错误"));
      await gate.promise.catch(() => {});
    });

    // ⭐ 核心断言 ②：失败不能被乐观关闭悄悄放过——浮层重新打开，错误可见、可重试/换一个。
    expect(await screen.findByTestId("chat-skill-mount-picker")).toBeInTheDocument();
    expect(await screen.findByTestId("chat-skill-mount-failure")).toHaveTextContent("网络错误");
    expect(screen.getByTestId("chat-skill-mount-option-sk_aaa")).toBeInTheDocument();
  });
});

/**
 * 2026-09-01 devapp 实测反馈（"skill panel can't be closed"）——面板此前只有
 * 触发按钮 / 候选项 / 「取消」自己的 onClick 能关它，点面板外任意位置或按 Esc
 * 都纹丝不动，与本仓已经给 `AgentPicker` 修过的同一个空缺（issue #1803 gap #2，
 * 见 `chat-live-message-panel-agent-picker.test.tsx`）一样，只是当时没有同步
 * 移植到这个文件。补齐同一套 `containerRef` + outside-click/Escape 用例。
 *
 * 独立审查（PR #2449，exact-SHA `0da8856`）指出的两处补强：
 *  · 生产代码监听的是 document 级 `mousedown`（不是 `click`），"内部点击不被
 *    误关"这条用例此前只 `fireEvent.click`，测不到新增的 `mousedown` containment
 *    guard 本身——container 判定发生在 mousedown 那一刻，不是 click。现在先单独
 *    `mouseDown` 在内部元素上，断言面板**仍然打开**（containment guard 生效），
 *    再补一次真实 `click` 证明按钮自己的关闭逻辑没被这次改动影响。
 *  · 只测过默认 `row` 变体，没测 composer 实际用的 `pill` 变体——两个渲染分支
 *    各自把 `containerRef` 接到不同的外层元素（`div` vs `section`），一个接对了
 *    不代表另一个也接对了。`describe.each` 覆盖两种变体，同一组反证各跑一遍。
 */
describe(
  "ChatSkillMountPanel 候选面板 —— outside-click / Escape 关闭（同 AgentPicker gap #2）",
  () => {
    it("点击面板外部（document.body）会关闭面板", async () => {
      renderPanel();
      fireEvent.click(await screen.findByTestId("chat-skill-mount"));
      expect(await screen.findByTestId("chat-skill-mount-picker")).toBeInTheDocument();

      fireEvent.mouseDown(document.body);
      await waitFor(() => expect(screen.queryByTestId("chat-skill-mount-picker")).not.toBeInTheDocument());
    });

    it("按 Escape 会关闭面板", async () => {
      renderPanel();
      fireEvent.click(await screen.findByTestId("chat-skill-mount"));
      expect(await screen.findByTestId("chat-skill-mount-picker")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByTestId("chat-skill-mount-picker")).not.toBeInTheDocument());
    });

    it("面板内部（比如「取消」按钮）的 mousedown 不会被 outside-click guard 误关；随后真实点击仍照常关闭", async () => {
      renderPanel();
      fireEvent.click(await screen.findByTestId("chat-skill-mount"));
      const cancel = await screen.findByTestId("chat-skill-mount-cancel");

      // ⭐ 核心反证：直接打这个新增的 mousedown 监听本身——containment guard 若把
      // “target 在容器内”判反，这里会先假阳性关闭，下面的断言就会失败。
      fireEvent.mouseDown(cancel);
      expect(screen.getByTestId("chat-skill-mount-picker")).toBeInTheDocument();

      // 按钮自己的 onClick 逻辑不受这次改动影响，真实点击仍然关闭。
      fireEvent.click(cancel);
      await waitFor(() => expect(screen.queryByTestId("chat-skill-mount-picker")).not.toBeInTheDocument());
    });
  },
);

describe("ChatSkillMountPanel 候选面板 —— 卸载后不留 document 监听器", () => {
  it("unmount 之后再在 document 上触发 mousedown/keydown 不抛错、不残留监听（add/remove 配对）", async () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderPanel();
    fireEvent.click(await screen.findByTestId("chat-skill-mount"));
    expect(await screen.findByTestId("chat-skill-mount-picker")).toBeInTheDocument();

    const mousedownAdds = addSpy.mock.calls.filter((call) => call[0] === "mousedown").length;
    const keydownAdds = addSpy.mock.calls.filter((call) => call[0] === "keydown").length;
    expect(mousedownAdds).toBeGreaterThan(0);
    expect(keydownAdds).toBeGreaterThan(0);

    unmount();

    const mousedownRemoves = removeSpy.mock.calls.filter((call) => call[0] === "mousedown").length;
    const keydownRemoves = removeSpy.mock.calls.filter((call) => call[0] === "keydown").length;
    // ⭐ 反证：每一次为 "chat-skill-mount" 效果新增的 mousedown/keydown 监听，
    // effect 清理函数都必须配对移除一次——数量对不上就是漏卸载，会在真实页面里
    // 累积成"卸载了组件、监听器还挂在 document 上"的内存/行为泄漏。
    expect(mousedownRemoves).toBe(mousedownAdds);
    expect(keydownRemoves).toBe(keydownAdds);

    // 卸载后 document 上再触发这两类事件不该抛错（监听器已经真的摘掉，不是
    // 只是逻辑上"应该"摘掉）。
    expect(() => fireEvent.mouseDown(document.body)).not.toThrow();
    expect(() => fireEvent.keyDown(document, { key: "Escape" })).not.toThrow();

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
