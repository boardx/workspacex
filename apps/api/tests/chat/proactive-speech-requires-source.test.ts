/**
 * F113 —— AI 主动发言必带来源（chat 束 domain.md I-19，uc-8-2 规则 1 / AC4 / E1d / A5 / V6）。
 *
 * ⚠ **纯逻辑单测，不连数据库**（issue #74：本地不跑任何需要 Postgres 的测试）。
 *   被测的是 `domain/chat/proactive-speech.ts` 这一处唯一的判定。
 *
 * ## 这个文件最重要的一条断言
 *
 * 契约逐字：「取不到来源时是『正常返回但不发言』，不是错误」。所以下面**没有**任何
 * `expect(...).rejects` / `toThrow` 断言取不到来源的分支——一个把它实现成
 * `throw` 的版本必须在这里当场报错（因为函数签名根本不是 async / 不抛错），
 * 而不是被一条宽松的 `try/catch` 悄悄接住。
 */
import { describe, expect, it } from "vitest";
import { chat as C } from "@repo/contracts";
import { decideProactiveSpeech } from "../../src/domain/chat/proactive-speech";

describe("F113 AI 主动发言必带来源", () => {
  it("V6：有来源且开关为开 ⇒ emitted:true，reason 为 null", () => {
    const r = decideProactiveSpeech({ agentOptedIn: true, hasSource: true });
    expect(r.emitted).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("V6：取不到来源 ⇒ emitted:false 且 reason:'no-source'，不是抛错", () => {
    const r = decideProactiveSpeech({ agentOptedIn: true, hasSource: false });
    expect(r.emitted).toBe(false);
    expect(r.reason).toBe("no-source");
  });

  it("A5：单个 agent 关闭主动插话后，即使这次有来源也不发言", () => {
    const r = decideProactiveSpeech({ agentOptedIn: false, hasSource: true });
    expect(r.emitted).toBe(false);
  });

  it("反证：关闭 + 无来源两个理由同时成立时仍然只是不发言，不因为两个理由叠加而报错", () => {
    const r = decideProactiveSpeech({ agentOptedIn: false, hasSource: false });
    expect(r.emitted).toBe(false);
    expect(r.reason).toBe("no-source");
  });

  it("反证：判定顺序——把「关闭」误判成「有来源就该发」的实现会在这条上变红", () => {
    // agentOptedIn:false 且 hasSource:true 本该在「先看开关」这一步就返回，
    // 一个「先查来源、来源为真就直接 emitted:true」的错误实现会让这条断言变红。
    const r = decideProactiveSpeech({ agentOptedIn: false, hasSource: true });
    expect(r.emitted).toBe(false);
  });

  it("emitted:false 时 reason 恒非空——四选二矩阵里没有一格是 {false, null}", () => {
    const matrix = [
      { agentOptedIn: true, hasSource: true },
      { agentOptedIn: true, hasSource: false },
      { agentOptedIn: false, hasSource: true },
      { agentOptedIn: false, hasSource: false },
    ];
    for (const input of matrix) {
      const r = decideProactiveSpeech(input);
      if (!r.emitted) expect(r.reason).not.toBeNull();
      else expect(r.reason).toBeNull();
    }
  });

  it("产出能过契约 agentProactiveSpeak.out 的 safeParse（messageId 由调用方在真正写入后填入）", () => {
    const r = decideProactiveSpeech({ agentOptedIn: true, hasSource: false });
    const parsed = C.operations.agentProactiveSpeak.out.safeParse({ ...r, messageId: null });
    expect(parsed.success).toBe(true);
  });

  it("非空转：emitted:true 的产出同样能过 safeParse（带一个假的 messageId）", () => {
    const r = decideProactiveSpeech({ agentOptedIn: true, hasSource: true });
    const parsed = C.operations.agentProactiveSpeak.out.safeParse({ ...r, messageId: "m-1" });
    expect(parsed.success).toBe(true);
  });
});
