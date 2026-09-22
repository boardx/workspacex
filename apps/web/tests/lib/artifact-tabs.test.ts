import { describe, expect, it } from "vitest";
import {
  ARTIFACT_TAB_LIMIT, EMPTY_ARTIFACT_TABS, activateTab, activeTab, closeTab, openTab,
  type ArtifactTab, type ArtifactTabState,
} from "@/lib/chat-workbench/artifact-tabs";

const item = (id: string): ArtifactTab => ({ artifactId: id, title: `产物 ${id}` } as ArtifactTab);
const ids = (state: ArtifactTabState): string[] => state.tabs.map((t) => t.artifactId);
const open = (...list: string[]): ArtifactTabState =>
  list.reduce((state, id) => openTab(state, item(id)), EMPTY_ARTIFACT_TABS);

describe("openTab", () => {
  it("打开就成为当前那一份", () => {
    const state = open("a", "b");
    expect(ids(state)).toEqual(["a", "b"]);
    expect(activeTab(state)?.artifactId).toBe("b");
  });

  it("已经开着的那一份：切过去，不开第二个", () => {
    const state = openTab(open("a", "b"), item("a"));
    expect(ids(state)).toEqual(["a", "b"]);
    expect(activeTab(state)?.artifactId).toBe("a");
  });

  it("满了淘汰最早打开的那一份", () => {
    const full = open("a", "b", "c", "d");
    expect(full.tabs).toHaveLength(ARTIFACT_TAB_LIMIT);
    const state = openTab(full, item("e"));
    expect(ids(state)).toEqual(["b", "c", "d", "e"]);
    expect(activeTab(state)?.artifactId).toBe("e");
  });
});

describe("closeTab", () => {
  // 这条是本文件最容易写错的一件：删除会让下标整体左移，
  // 拿旧下标去显示就会静默切到隔壁那一份，而用户根本没点过它。
  it("关掉的不是当前这份时，当前这份仍然是当前这份", () => {
    const state = closeTab(activateTab(open("a", "b", "c"), "c"), "a");
    expect(ids(state)).toEqual(["b", "c"]);
    expect(activeTab(state)?.artifactId).toBe("c");
  });

  it("关掉当前这份，落到它右边那一份", () => {
    const state = closeTab(activateTab(open("a", "b", "c"), "b"), "b");
    expect(ids(state)).toEqual(["a", "c"]);
    expect(activeTab(state)?.artifactId).toBe("c");
  });

  it("关掉的是最后一份，落到它左边那一份", () => {
    const state = closeTab(open("a", "b", "c"), "c");
    expect(ids(state)).toEqual(["a", "b"]);
    expect(activeTab(state)?.artifactId).toBe("b");
  });

  it("关掉最后一个，回到空态（activeIndex 是 -1，不是 0）", () => {
    const state = closeTab(open("a"), "a");
    expect(state).toEqual(EMPTY_ARTIFACT_TABS);
    expect(activeTab(state)).toBeNull();
  });

  it("关一个不在里面的 id：原样返回", () => {
    const before = open("a", "b");
    expect(closeTab(before, "zzz")).toBe(before);
  });
});

describe("activateTab", () => {
  it("切到某一份", () => {
    expect(activeTab(activateTab(open("a", "b"), "a"))?.artifactId).toBe("a");
  });
  it("不在里面的 id 原样返回，不静默把它打开", () => {
    const before = open("a");
    expect(activateTab(before, "zzz")).toBe(before);
    expect(ids(before)).toEqual(["a"]);
  });
});

describe("activeTab", () => {
  it("空态是 null", () => {
    expect(activeTab(EMPTY_ARTIFACT_TABS)).toBeNull();
  });
});
