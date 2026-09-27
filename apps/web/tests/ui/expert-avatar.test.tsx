import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ExpertAvatar, ExpertAvatarEditor } from "@/components/itv/expert-avatar";
import { AVATAR_KEYS, defaultExpertAvatar, avatarStorageKey } from "@/lib/interview-expert-avatar";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("expert SVG avatars", () => {
  it("binds stable defaults to identity, not display name", () => {
    expect(AVATAR_KEYS).toHaveLength(25);
    expect(AVATAR_KEYS).toContain(defaultExpertAvatar("expert-1"));
    const { rerender } = render(<ExpertAvatar expertId="expert-1" displayName="名字" />);
    const key = screen.getByRole("img").getAttribute("data-avatar-key");
    rerender(<ExpertAvatar expertId="expert-1" displayName="改名" />);
    expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe(key);
    expect(screen.getByRole("img").querySelector("svg")).not.toBeNull();
  });

  it("saves changes, synchronizes instances and survives remount; cancel does not save", () => {
    const { unmount } = render(<><ExpertAvatar expertId="e1" displayName="专家" /><ExpertAvatarEditor expertId="e1" displayName="专家" /></>);
    fireEvent.click(screen.getByRole("button", { name: "修改专家头像" }));
    let dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "机器人头像" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存头像" }));
    expect(localStorage.getItem(avatarStorageKey("e1"))).toBe("robot");
    expect(screen.getAllByRole("img").every((img) => img.getAttribute("data-avatar-key") === "robot")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "修改专家头像" }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "人物头像 1" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(localStorage.getItem(avatarStorageKey("e1"))).toBe("robot");
    unmount();
    render(<ExpertAvatarEditor expertId="e1" displayName="专家" />);
    expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe("robot");
    fireEvent.click(screen.getByRole("button", { name: "修改专家头像" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    fireEvent.click(screen.getByRole("button", { name: "保存头像" }));
    expect(localStorage.getItem(avatarStorageKey("e1"))).toBeNull();
    expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe(defaultExpertAvatar("e1"));
  });

  it("ignores invalid stored values and reports failed writes without closing", () => {
    localStorage.setItem(avatarStorageKey("e2"), "<svg onload='bad'>");
    render(<ExpertAvatarEditor expertId="e2" displayName="专家" />);
    expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe(defaultExpertAvatar("e2"));
    fireEvent.click(screen.getByRole("button", { name: "修改专家头像" }));
    fireEvent.click(screen.getByRole("button", { name: "机器人头像" }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.click(screen.getByRole("button", { name: "保存头像" }));
    expect(screen.getByRole("alert").textContent).toContain("无法保存");
    expect(screen.getByRole("dialog")).not.toBeNull();
  });
});
