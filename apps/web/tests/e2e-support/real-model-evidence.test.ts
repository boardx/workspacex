/**
 * 证据包脱敏的门控（issue #2802）。
 *
 * 为什么值得单测：这条 lane 的产物是**要被上传成 GitHub artifact 的文件**，脱敏失效
 * 的后果不是"测试红了"，而是凭据被传到一个能下载的地方。所以这里既有正样本（该打码
 * 的真打了码），也有反样本（不该打码的没被打成马赛克——否则证据不可读，等于没证据）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { scrubSecrets } from "../../e2e/support/real-model-evidence";

const ORIGINAL = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
});

describe("scrubSecrets", () => {
  it("把进程环境里像凭据的变量值逐字打掉", () => {
    process.env.DASHSCOPE_API_KEY = "sk-abcdef0123456789abcdef";
    const text = `调用失败 key=sk-abcdef0123456789abcdef 状态=401`;
    const scrubbed = scrubSecrets(text);
    expect(scrubbed).not.toContain("sk-abcdef0123456789abcdef");
    expect(scrubbed).toContain("401");
  });

  it("兜住不来自本进程环境的凭据形态（Bearer / Authorization / password 字段）", () => {
    const scrubbed = scrubSecrets(
      'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature\n{"password":"hunter2-very-secret"}',
    );
    expect(scrubbed).not.toContain("eyJhbGciOiJIUzI1NiJ9.payload.signature");
    expect(scrubbed).not.toContain("hunter2-very-secret");
  });

  it("显式传入的额外密文（比如本轮登录口令）也会被打掉", () => {
    const scrubbed = scrubSecrets("login body: pw=Fullstack-E2E-only-387!", ["Fullstack-E2E-only-387!"]);
    expect(scrubbed).not.toContain("Fullstack-E2E-only-387!");
  });

  it("反样本：短开关值与普通日志正文不被误伤——证据必须仍然可读", () => {
    process.env.KERNEL_DEEP_AGENT_STREAM_ENABLED = "1";
    process.env.SOME_TOKEN = "1";
    const text = "KERNEL_DEEP_AGENT_STREAM_ENABLED=1 thread=thread-abc run=run-xyz 已用 95 秒";
    const scrubbed = scrubSecrets(text);
    expect(scrubbed).toContain("thread-abc");
    expect(scrubbed).toContain("run-xyz");
    expect(scrubbed).toContain("已用 95 秒");
  });

  it("反样本：这条门控不是恒真——不打码的实现会红", () => {
    process.env.MODEL_CREDENTIAL_KEY = "credential-value-1234";
    expect(scrubSecrets("k=credential-value-1234")).not.toBe("k=credential-value-1234");
  });
});
