/**
 * issue #2637 ⑤ —— 语音转录混进多余中文标点（"、。"伪影）。见 `use-asr-draft.ts`
 * 里 `sanitizeAsrSegment` 的头注：`turn_detection: server_vad` 把一句话切成多轮，
 * 每轮各自带标点，拼起来就是"早上好。我想说的是、今天…"这种样子。
 *
 * @vitest-environment jsdom
 * 文件名仍是 `.ts`（不是 `.tsx`）——`vitest.config.ts` 的 `environmentMatchGlobs` 只按
 * `.tsx` 匹配 jsdom，这里下半部分新增的 `renderHook` 用例需要 `window`/`navigator`，用
 * 每文件 docblock 覆盖默认的 `node` 环境，不为此把整个文件改名（改名会丢 git blame）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { sanitizeAsrSegment, useAsrDraft } from "@/lib/use-asr-draft";
import type { AsrDraftStreamHandle, AsrDraftStreamHandlers } from "@/lib/live-asr-draft";

describe("sanitizeAsrSegment", () => {
  it("collapses runs of repeated/adjacent punctuation into the last mark", () => {
    expect(sanitizeAsrSegment("你好。、今天天气不错")).toBe("你好、今天天气不错");
    expect(sanitizeAsrSegment("好的，，我知道了")).toBe("好的，我知道了");
    expect(sanitizeAsrSegment("完成了。。")).toBe("完成了。");
  });

  it("strips a stray leading 、 or ， that begins a new turn (server-VAD boundary artifact)", () => {
    expect(sanitizeAsrSegment("、今天天气怎么样")).toBe("今天天气怎么样");
    expect(sanitizeAsrSegment("，我想说的是")).toBe("我想说的是");
  });

  it("leaves ordinary mid-sentence punctuation untouched", () => {
    expect(sanitizeAsrSegment("我想说的是，今天的兼容性问题。")).toBe("我想说的是，今天的兼容性问题。");
  });

  it("leaves text with no punctuation artifacts unchanged", () => {
    expect(sanitizeAsrSegment("你好")).toBe("你好");
    expect(sanitizeAsrSegment("")).toBe("");
  });
});

/**
 * 2026-09-04 review fix（PR #2644 reviewer diagnostic）—— 上面这组用例只验证
 * `sanitizeAsrSegment` 对**单个孤立字符串**的效果，从没真的走过 `useAsrDraft` 的
 * `onFinal` 序列——而人类实测反馈报的正是"早上好。我想说的是。今天…"这种**跨段**
 * 拼接后的样子：`server_vad` 把一句连续的话切成好几个各自带句号的 final。这里直接
 * 驱动 hook 收连续多段 final，断言拼出来的整段文本只在真正说完的末尾留一个标点，
 * 中间每一轮的收尾句号都被去掉，而不是像 `sanitizeAsrSegment` 单测那样看不出这个
 * 跨段问题是否真的被修掉。
 */
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()),
  openAsrDraftStream: vi.fn(),
}));

describe("useAsrDraft — sequential server_vad finals across turns", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", class {} as unknown as typeof WebSocket);
    vi.stubGlobal("AudioContext", class {} as unknown as typeof AudioContext);
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("strips the turn-boundary period from each earlier final once the next final arrives, keeping only the last segment's trailing punctuation", async () => {
    const { openAsrDraftStream } = await import("@/lib/live-asr-draft");
    let handlers: AsrDraftStreamHandlers | null = null;
    const handle: AsrDraftStreamHandle = { stop: vi.fn(async () => handlers?.onFinished()) };
    vi.mocked(openAsrDraftStream).mockImplementation(async (h) => {
      handlers = h;
      return handle;
    });

    const onTranscript = vi.fn();
    const { result } = renderHook(() =>
      useAsrDraft({ onTranscript, getBaseText: () => "", sessionToken: "t" }),
    );

    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });

    act(() => {
      handlers?.onFinal("早上好。");
      handlers?.onFinal("我想说的是。");
      handlers?.onFinal("今天…");
    });

    const lastCall = onTranscript.mock.calls.at(-1)?.[0] as string;
    // 三段各自的收尾句号被剥到只剩最后一段的省略号——没有"。 。"这种每段都留一个的样子，
    // 也没有把中间的标点整个删没（那会读不出停顿）。
    expect(lastCall).toBe("早上好 我想说的是 今天…");
    expect(lastCall.match(/。/g)).toBeNull();
  });
});
