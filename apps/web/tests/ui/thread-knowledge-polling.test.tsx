/**
 * issue #4350 —— 「记忆」面板在「整理中（N 条）」期间自己重读，直到队列清空。
 *
 * devapp 2026-09-27：面板一直停在「整理中（1 条）」，手动刷新才变——`useThreadKnowledge` 只在换线程 /
 * 点页签 / 人撤销之后重读。这里用假时钟驱动：有待整理的消息就按退避序列轮询；清空、页签不在前台、
 * 窗口隐藏都停；总时长封顶。读取走的是真实的 `fetchThreadKnowledge`，只在 `fetch` 层打桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import type { ThreadKnowledge } from "@/lib/knowledge-graph-api";
import {
  KNOWLEDGE_POLL_DELAYS_MS, KNOWLEDGE_POLL_MAX_MS, useThreadKnowledge,
} from "@/components/chat/knowledge/thread-knowledge-tab";

const THREAD = "thr-kg-poll";

let pending = { queued: 1, running: 0 };
let gets = 0;

function readModel(): ThreadKnowledge {
  return knowledgeGraph.getThreadKnowledge.out.parse({
    scope: { kind: "chat_session", id: THREAD }, revision: 1, objects: [], claims: [], edges: [],
    ingestion: { ...pending, failed: 0, failures: [] },
    canEdit: true, canPromote: true, visibility: "owner_only", extractionActive: true,
  });
}

let hidden = false;
function setHidden(next: boolean) {
  hidden = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  pending = { queued: 1, running: 0 };
  gets = 0;
  hidden = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/knowledge")) throw new Error(`unexpected fetch ${url}`);
    gets += 1;
    return new Response(JSON.stringify(readModel()), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/** 让在途的 fetch / setState 落地（假时钟下 promise 仍是微任务）。 */
async function flush() {
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
}
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await flush();
}

describe("issue #4350: 「整理中」轮询", () => {
  it("有待整理的消息就按退避序列重读；队列清空就停", async () => {
    const { result } = renderHook(() => useThreadKnowledge(THREAD));
    await flush();
    expect(gets).toBe(1);
    expect(result.current.data?.ingestion.queued).toBe(1);

    await advance(KNOWLEDGE_POLL_DELAYS_MS[0]! - 1);
    expect(gets).toBe(1);
    await advance(1);
    expect(gets).toBe(2);
    await advance(KNOWLEDGE_POLL_DELAYS_MS[1]!);
    expect(gets).toBe(3);

    pending = { queued: 0, running: 1 };  // 进行中也算待整理
    await advance(KNOWLEDGE_POLL_DELAYS_MS[2]!);
    expect(gets).toBe(4);
    expect(result.current.data?.ingestion.running).toBe(1);

    pending = { queued: 0, running: 0 };
    await advance(KNOWLEDGE_POLL_DELAYS_MS[3]!);
    expect(gets).toBe(5);
    expect(result.current.data?.ingestion).toMatchObject({ queued: 0, running: 0 });
    await advance(KNOWLEDGE_POLL_MAX_MS);
    expect(gets).toBe(5);  // 清空之后一次都不再读
  });

  it("没有待整理的消息：一次都不轮询", async () => {
    pending = { queued: 0, running: 0 };
    renderHook(() => useThreadKnowledge(THREAD));
    await flush();
    await advance(KNOWLEDGE_POLL_MAX_MS);
    expect(gets).toBe(1);
  });

  it("窗口隐藏就停；回到前台重新开始", async () => {
    renderHook(() => useThreadKnowledge(THREAD));
    await flush();
    await advance(KNOWLEDGE_POLL_DELAYS_MS[0]!);
    expect(gets).toBe(2);
    await act(async () => { setHidden(true); });
    await advance(KNOWLEDGE_POLL_MAX_MS);
    expect(gets).toBe(2);
    await act(async () => { setHidden(false); });
    await advance(KNOWLEDGE_POLL_DELAYS_MS[0]!);
    expect(gets).toBe(3);
  });

  it("「记忆」页签不在前台（active = false）就停；切回来重新开始", async () => {
    const { rerender } = renderHook(({ active }) => useThreadKnowledge(THREAD, { active }), { initialProps: { active: true } });
    await flush();
    rerender({ active: false });
    await advance(KNOWLEDGE_POLL_MAX_MS);
    expect(gets).toBe(1);
    rerender({ active: true });
    await advance(KNOWLEDGE_POLL_DELAYS_MS[0]!);
    expect(gets).toBe(2);
  });

  it("一直有待整理的消息：间隔封顶在最后一档，总时长封顶后停", async () => {
    renderHook(() => useThreadKnowledge(THREAD));
    await flush();
    const last = KNOWLEDGE_POLL_DELAYS_MS[KNOWLEDGE_POLL_DELAYS_MS.length - 1]!;
    // 走完退避序列
    for (const d of KNOWLEDGE_POLL_DELAYS_MS) await advance(d);
    const afterRamp = gets;
    await advance(last);
    expect(gets).toBe(afterRamp + 1);  // 封顶档反复用
    await advance(KNOWLEDGE_POLL_MAX_MS);
    const capped = gets;
    const elapsedPolls = capped - 1;
    const bound = KNOWLEDGE_POLL_DELAYS_MS.length + Math.ceil(KNOWLEDGE_POLL_MAX_MS / last);
    expect(elapsedPolls).toBeLessThanOrEqual(bound);
    await advance(KNOWLEDGE_POLL_MAX_MS * 3);
    expect(gets).toBe(capped);  // 过了上限一次都不再读
  });
});
