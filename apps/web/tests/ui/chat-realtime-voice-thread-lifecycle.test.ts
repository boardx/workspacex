/**
 * 新对话里的「实时对话」不留空线程：本次通话自建的线程在一轮都没落库时挂断即删除、不回写地址栏；
 * 落了库才回写；已有线程永远不删。
 */
import { describe, expect, it, vi } from "vitest";
import { createVoiceThreadLifecycle, pickVoiceSubtitle } from "@/components/chat/chat-realtime-voice-entry";

function setup(existing: string | null = null) {
  const deps = { create: vi.fn(async () => ({ threadId: "t-new", version: 3 })), discard: vi.fn(async () => ({})) };
  const onPersisted = vi.fn();
  const life = createVoiceThreadLifecycle({ existingThreadId: () => existing, projectId: null, onPersisted }, deps);
  return { deps, onPersisted, life };
}

describe("createVoiceThreadLifecycle", () => {
  it("deletes the voice-created thread on hang-up when no turn was saved, without resolving the URL", async () => {
    const { deps, onPersisted, life } = setup();
    expect(await life.resolveThreadId()).toBe("t-new");
    life.onEnded({ threadId: "t-new", persistedMessageIds: [] });
    expect(deps.discard).toHaveBeenCalledWith("t-new", null, 3);
    expect(onPersisted).not.toHaveBeenCalled();
  });

  it("keeps the thread and reports it (createdByVoice) once a turn was saved", async () => {
    const { deps, onPersisted, life } = setup();
    await life.resolveThreadId();
    await life.resolveThreadId(); // reconnect reuses the same thread
    expect(deps.create).toHaveBeenCalledTimes(1);
    life.onEnded({ threadId: "t-new", persistedMessageIds: ["m-1"] });
    expect(deps.discard).not.toHaveBeenCalled();
    expect(onPersisted).toHaveBeenCalledWith({ threadId: "t-new", createdByVoice: true, messageIds: ["m-1"] });
  });

  it("never creates or deletes an existing thread", async () => {
    const { deps, onPersisted, life } = setup("t-existing");
    expect(await life.resolveThreadId()).toBe("t-existing");
    life.onEnded({ threadId: "t-existing", persistedMessageIds: [] });
    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.discard).not.toHaveBeenCalled();
    life.onEnded({ threadId: "t-existing", persistedMessageIds: ["m-2"] });
    expect(onPersisted).toHaveBeenCalledWith({ threadId: "t-existing", createdByVoice: false, messageIds: ["m-2"] });
  });

  it("tells the caller when nothing was saved (so the UI does not imply it was)", async () => {
    const deps = { create: vi.fn(async () => ({ threadId: "t-new", version: 1 })), discard: vi.fn(async () => ({})) };
    const onNothingSaved = vi.fn();
    const life = createVoiceThreadLifecycle({ existingThreadId: () => null, projectId: null, onPersisted: vi.fn(), onNothingSaved }, deps);
    await life.resolveThreadId();
    life.onEnded({ threadId: "t-new", persistedMessageIds: [] });
    expect(onNothingSaved).toHaveBeenCalledTimes(1);
  });
});

describe("pickVoiceSubtitle", () => {
  it("uses the duty one-liner, falls back to roleLabel, never repeats the name", () => {
    expect(pickVoiceSubtitle({ name: "研究员小周", duty: "行业研究与竞品分析", roleLabel: "研究员" })).toBe("行业研究与竞品分析");
    expect(pickVoiceSubtitle({ name: "研究与知识分析师", duty: "研究与知识分析师", roleLabel: "知识分析" })).toBe("知识分析");
    expect(pickVoiceSubtitle({ name: "研究与知识分析师", duty: "研究与知识分析师", roleLabel: "研究与知识分析师" })).toBeNull();
    expect(pickVoiceSubtitle({ name: "A", duty: null })).toBeNull();
  });
});
