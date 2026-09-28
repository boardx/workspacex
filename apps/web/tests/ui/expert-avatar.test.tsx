import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { ExpertAvatar, ExpertAvatarEditor } from "@/components/itv/expert-avatar";
import { AVATAR_KEYS, defaultExpertAvatar, avatarStorageKey } from "@/lib/interview-expert-avatar";
import { DigitalExpertDetail } from "@/components/itv/digital-expert-detail";
import { MOCK_DIGITAL_EXPERTS } from "@/lib/mock/digital-expert-personas";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("expert SVG avatars", () => {
  it("saves a virtual expert through its interview revision and isolates the same anchor in another interview", async () => {
    localStorage.setItem("wsx.sessionToken", "virtual-avatar-session");
    let first = { expertId: "virtual-shared", avatarKey: "person-7", version: 2 };
    vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
      if (!url.includes("/markdown/experts/virtual-shared/avatar")) return new Response("{}", { status: 404 });
      const isFirst = url.includes("/source-first/");
      if (options.method === "PATCH") {
        const body = JSON.parse(options.body as string);
        if (!isFirst || body.revisionId !== "revision-first" || body.expectedVersion !== first.version) return new Response("{}", { status: 409 });
        first = { ...first, avatarKey: body.avatarKey, version: first.version + 1 };
      }
      return new Response(JSON.stringify(isFirst ? first : { expertId: "virtual-shared", avatarKey: "person-9", version: 1 }), { status: 200 });
    });
    render(<><ExpertAvatarEditor expertId="virtual-shared" displayName="教师" context={{ interviewId: "source-first", revisionId: "revision-first" }} /><ExpertAvatar expertId="virtual-shared" displayName="其他访谈教师" context={{ interviewId: "source-second", revisionId: "revision-second" }} /></>);
    await waitFor(() => expect(screen.getByRole("img", { name: "教师的插画头像" }).getAttribute("data-avatar-key")).toBe("person-7"));
    await waitFor(() => expect(screen.getByRole("img", { name: "其他访谈教师的插画头像" }).getAttribute("data-avatar-key")).toBe("person-9"));
    fireEvent.click(screen.getByRole("button", { name: "修改教师头像" }));
    fireEvent.click(screen.getByRole("button", { name: "机器人头像" }));
    fireEvent.click(screen.getByRole("button", { name: "保存头像" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("img", { name: "教师的插画头像" }).getAttribute("data-avatar-key")).toBe("robot");
    expect(screen.getByRole("img", { name: "其他访谈教师的插画头像" }).getAttribute("data-avatar-key")).toBe("person-9");
  });

  it("disables avatar editing for an unsaved expert with explicit save-first guidance", () => {
    render(<ExpertAvatarEditor expertId="virtual-unsaved" displayName="教师" disabled disabledReason="请先保存专家草稿，再修改头像" />);
    expect((screen.getByRole("button", { name: "修改教师头像" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("请先保存专家草稿，再修改头像")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "修改教师头像" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("loads and saves authenticated preferences then reads them in a fresh session without browser avatar data", async () => {
    localStorage.setItem("wsx.sessionToken", "avatar-session-one");
    localStorage.setItem(avatarStorageKey("remote-expert"), "person-1");
    let saved: { expertId: string; avatarKey: string | null; version: number } = { expertId: "remote-expert", avatarKey: "person-4", version: 3 };
    vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => {
      if (options.method === "PATCH") {
        const body = JSON.parse(options.body as string);
        if (body.expectedVersion !== saved.version) return new Response(JSON.stringify({ message: "conflict" }), { status: 409 });
        saved = { ...saved, avatarKey: body.avatarKey, version: saved.version + 1 };
      }
      return new Response(JSON.stringify(saved), { status: 200 });
    });
    const { unmount } = render(<ExpertAvatarEditor expertId="remote-expert" displayName="专家" />);
    await waitFor(() => expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe("person-4"));
    fireEvent.click(screen.getByRole("button", { name: "修改专家头像" }));
    fireEvent.click(screen.getByRole("button", { name: "机器人头像" }));
    fireEvent.click(screen.getByRole("button", { name: "保存头像" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe("robot");
    unmount();
    localStorage.clear();
    localStorage.setItem("wsx.sessionToken", "avatar-session-two");
    render(<ExpertAvatar expertId="remote-expert" displayName="改名" />);
    await waitFor(() => expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe("robot"));
  });

  it("keeps the editor open and the displayed avatar unchanged when the server rejects a stale save", async () => {
    localStorage.setItem("wsx.sessionToken", "avatar-stale-session");
    vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => new Response(JSON.stringify(
      options.method === "PATCH" ? { message: "conflict" } : { expertId: "stale-expert", avatarKey: "person-2", version: 1 },
    ), { status: options.method === "PATCH" ? 409 : 200 }));
    render(<ExpertAvatarEditor expertId="stale-expert" displayName="专家" />);
    await waitFor(() => expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe("person-2"));
    fireEvent.click(screen.getByRole("button", { name: "修改专家头像" }));
    fireEvent.click(screen.getByRole("button", { name: "机器人头像" }));
    fireEvent.click(screen.getByRole("button", { name: "保存头像" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("无法保存"));
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByRole("img", { hidden: true }).getAttribute("data-avatar-key")).toBe("person-2");
  });
  it("shows saved avatars and editing on the standalone expert detail route", () => {
    const expert = MOCK_DIGITAL_EXPERTS[0]!;
    localStorage.setItem(avatarStorageKey(expert.expertId), "robot");
    render(<DigitalExpertDetail expertId={expert.expertId} />);
    expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe("robot");
    expect(screen.getByRole("button", { name: `修改${expert.displayName}头像` })).not.toBeNull();
  });
  it("binds stable defaults to identity, not display name", () => {
    expect(AVATAR_KEYS).toHaveLength(25);
    expect(AVATAR_KEYS).toContain(defaultExpertAvatar("expert-1"));
    const { rerender } = render(<ExpertAvatar expertId="expert-1" displayName="名字" />);
    const key = screen.getByRole("img").getAttribute("data-avatar-key");
    rerender(<ExpertAvatar expertId="expert-1" displayName="改名" />);
    expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe(key);
    expect(screen.getByRole("img").querySelector("svg")).not.toBeNull();
  });

  it("saves changes, synchronizes instances and survives remount; cancel does not save", async () => {
    const { unmount } = render(<><ExpertAvatar expertId="e1" displayName="专家" /><ExpertAvatarEditor expertId="e1" displayName="专家" /></>);
    fireEvent.click(screen.getByRole("button", { name: "修改专家头像" }));
    let dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "机器人头像" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存头像" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(localStorage.getItem(avatarStorageKey("e1"))).toBeNull();
    expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe(defaultExpertAvatar("e1"));
  });

  it("ignores invalid stored values and reports failed writes without closing", async () => {
    localStorage.setItem(avatarStorageKey("e2"), "<svg onload='bad'>");
    render(<ExpertAvatarEditor expertId="e2" displayName="专家" />);
    expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe(defaultExpertAvatar("e2"));
    fireEvent.click(screen.getByRole("button", { name: "修改专家头像" }));
    fireEvent.click(screen.getByRole("button", { name: "机器人头像" }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.click(screen.getByRole("button", { name: "保存头像" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("无法保存"));
    expect(screen.getByRole("dialog")).not.toBeNull();
  });
});
