/**
 * 2026-09-08 —— `setInboxItemTags`：鉴权门 + 标签归一化（去空白 / 去空 / 去重）。
 */
import { describe, expect, it, vi } from "vitest";
import { setInboxItemTags, InboxPermissionRevokedError } from "../../src/application/inbox/set-inbox-item-tags";
import { normalizeInboxTags } from "../../src/domain/inbox/tags";

describe("setInboxItemTags", () => {
  it("不是本组织成员 ⇒ InboxPermissionRevokedError，不写库", async () => {
    const setTags = vi.fn(async () => undefined);
    await expect(
      setInboxItemTags({ tags: { getTags: async () => new Map(), setTags } }, { viewerOrgRole: null, kind: "feedback", id: "fb-1", tags: ["a"] }),
    ).rejects.toBeInstanceOf(InboxPermissionRevokedError);
    expect(setTags).not.toHaveBeenCalled();
  });

  it("归一化后覆盖式写入并原样返回", async () => {
    const setTags = vi.fn(async () => undefined);
    const out = await setInboxItemTags(
      { tags: { getTags: async () => new Map(), setTags } },
      { viewerOrgRole: "consultant", kind: "design", id: "dp-1", tags: [" 登录 ", "登录", "", "P1"] },
    );
    expect(setTags).toHaveBeenCalledWith("design", "dp-1", ["登录", "P1"]);
    expect(out).toEqual({ kind: "design", id: "dp-1", tags: ["登录", "P1"] });
  });

  it("normalizeInboxTags 保留首次出现顺序", () => {
    expect(normalizeInboxTags(["b", "a", "b", " a"])).toEqual(["b", "a"]);
  });
});
