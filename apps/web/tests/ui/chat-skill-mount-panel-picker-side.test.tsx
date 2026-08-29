import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * issue #2321 追加 —— 真实 devapp 实测：`variant="pill"` 挂在 composer 图标行时，
 * composer 贴着视口底部，挂载浮层此前恒定往下开（`top-full`），在真实布局里开到
 * 视口外/被裁掉，用户完全看不见。同一行的 `CapabilityPicker`（agent 选择器）早就
 * 用 `side="up"` 解决过一模一样的问题（`chat-composer-pickers.tsx`），这里补上
 * 同一套口子（`pickerSide`）并反证：
 * ① 默认（不传 `pickerSide`）仍然往下开——与升级前逐字节兼容，`variant="row"`
 *   使用方（`chat-read-screen.tsx`/`personal-chat-screen.tsx`）不受影响。
 * ② `pickerSide="up"` 时浮层改为往上开，真正解决"贴底看不见"这个问题。
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

beforeEach(() => {
  listThreadMounts.mockReset().mockResolvedValue({ temporary: [], version: "0" });
  mountSkills.mockReset();
  unmountSkill.mockReset();
  listSkills.mockReset().mockResolvedValue(SKILL_POOL);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function openPicker() {
  fireEvent.click(await screen.findByTestId("chat-skill-mount"));
  return screen.findByTestId("chat-skill-mount-picker");
}

describe("ChatSkillMountPanel（variant=\"pill\"）浮层开合方向 pickerSide（issue #2321）", () => {
  it("默认（不传 pickerSide）往下开 -- 与升级前逐字节兼容", async () => {
    render(<ChatSkillMountPanel variant="pill" threadId="thr-1" orgId="org-1" bearer="bearer-1" />);
    const picker = await openPicker();
    expect(picker.className).toContain("top-full");
    expect(picker.className).not.toContain("bottom-full");
  });

  it("pickerSide=\"up\" 往上开 -- composer 贴视口底部时浮层真正可见", async () => {
    render(
      <ChatSkillMountPanel
        variant="pill"
        pickerSide="up"
        threadId="thr-1"
        orgId="org-1"
        bearer="bearer-1"
      />,
    );
    const picker = await openPicker();
    expect(picker.className).toContain("bottom-full");
    expect(picker.className).not.toContain("top-full");
  });
});
