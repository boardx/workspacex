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

const SKILL_POOL = [{ skillId: "sk_aaa", name: "pptx", status: "已启用" as const }];

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
