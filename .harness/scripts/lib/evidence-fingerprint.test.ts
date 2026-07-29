// 这组测试是 2026-07-29 承重测试的固化：审计当时，手写一份含 [exit 0] 的日志
// 就能让 doctor 报「审计链完整」。下面每条都是那次穿透路径的反证。
import { describe, it, expect } from "vitest";
import { appendFingerprint, checkFingerprint } from "./evidence-fingerprint";

const REAL_LOG = `$ pnpm vitest run tests/kernel/foo.test.ts
[exit 0]
 ✓ tests/kernel/foo.test.ts (7 tests)`;

describe("evidence 指纹", () => {
  it("verify 产出的日志能通过校验（正向回路）", () => {
    expect(checkFingerprint(appendFingerprint(REAL_LOG)).kind).toBe("ok");
  });

  it("手写的日志没有指纹——即使内容含 [exit 0]、长得完全像真的", () => {
    expect(checkFingerprint(REAL_LOG).kind).toBe("missing");
  });

  it("产出后被追加内容 → tampered", () => {
    const forged = appendFingerprint(REAL_LOG).replace("[exit 0]", "[exit 0]\n 伪造的额外通过记录");
    expect(checkFingerprint(forged).kind).toBe("tampered");
  });

  it("把失败改成成功 → tampered", () => {
    const real = appendFingerprint(REAL_LOG.replace("[exit 0]", "[exit 1]"));
    expect(checkFingerprint(real.replace("[exit 1]", "[exit 0]")).kind).toBe("tampered");
  });

  it("照抄别处的合法尾行贴到自己的假日志上 → tampered", () => {
    const stolen = appendFingerprint(REAL_LOG).split("\n").at(-1)!;
    expect(checkFingerprint(`$ 我什么都没跑\n[exit 0]\n${stolen}`).kind).toBe("tampered");
  });

  it("空正文也参与哈希，不能靠清空正文绕过", () => {
    const real = appendFingerprint(REAL_LOG);
    expect(checkFingerprint(real.split("\n").at(-1)!).kind).toBe("tampered");
  });
});
