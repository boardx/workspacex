/**
 * issue #2637 ⑤ —— 语音转录混进多余中文标点（"、。"伪影）。见 `use-asr-draft.ts`
 * 里 `sanitizeAsrSegment` 的头注：`turn_detection: server_vad` 把一句话切成多轮，
 * 每轮各自带标点，拼起来就是"早上好。我想说的是、今天…"这种样子。
 */
import { describe, expect, it } from "vitest";
import { sanitizeAsrSegment } from "@/lib/use-asr-draft";

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
