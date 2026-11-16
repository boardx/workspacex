/**
 * issue #2686 —— 等待 399s 后，前端只把无稳定码的原始传输异常 message 当 code
 * 查表，落进通用兜底文案「这次执行没有成功，请重试或联系管理员」，用户看不出
 * "是超时"这个可行动信息。修复见 `copilotkit-v2-error-copy.ts` 的
 * `classifyTransportFailureMessage`：把常见的超时/连接中断类原始异常文案统一
 * 分类成 `AGENT_RUN_TIMEOUT` 的既有专属文案。
 */
import { describe, expect, it } from "vitest";
import { describeCopilotkitV2RunError } from "@/lib/copilotkit-v2-error-copy";
import { AidtContextErrorCode } from "@repo/contracts/aidt-run-context";

describe("describeCopilotkitV2RunError", () => {
  it("译出已登记的传输层稳定码", () => {
    expect(describeCopilotkitV2RunError("AGENT_RUN_TIMEOUT")).toBe("这次执行超时了，还没有等到结果");
  });

  it("译出已登记的 run 终态枚举码", () => {
    expect(describeCopilotkitV2RunError("MODEL_CALL_FAILED")).toBe("模型这次没能返回可用结果");
  });

  it("空/未知码给通用兜底", () => {
    expect(describeCopilotkitV2RunError(undefined)).toBe("执行失败，原因未知");
    expect(describeCopilotkitV2RunError("")).toBe("执行失败，原因未知");
  });

  // issue #2686 的实测场景：原始 undici/网关传输异常 message，没有 in-band 稳定码。
  it.each([
    "terminated",
    "fetch failed",
    "The operation was aborted",
    "UND_ERR_HEADERS_TIMEOUT: Headers Timeout Error",
    "socket hang up",
    "read ECONNRESET",
  ])("把原始传输超时/中断异常 message 分类成超时文案: %s", (rawMessage) => {
    expect(describeCopilotkitV2RunError(rawMessage)).toBe("这次执行超时了，还没有等到结果");
  });

  // issue #2786 实测场景：浏览器原生 fetch() 网络失败文案（三大浏览器各不相同），
  // 之前的正则只覆盖了 Node/undici 侧文案，漏判这三种，落进了通用兜底。
  it.each([
    ["Chrome/Edge", "Failed to fetch"],
    ["Firefox", "NetworkError when attempting to fetch resource."],
    ["Safari", "Load failed"],
  ])("把浏览器原生 fetch 失败文案分类成超时文案（%s: %s）", (_browser, rawMessage) => {
    expect(describeCopilotkitV2RunError(rawMessage)).toBe("这次执行超时了，还没有等到结果");
  });

  it("与超时/中断无关的陌生原始 message 仍落通用兜底（不误判）", () => {
    expect(describeCopilotkitV2RunError("SomeVendorSpecificWeirdError: 0x80")).toBe(
      "这次执行没有成功，请重试或联系管理员",
    );
  });
});


const aidtCopy = {
  AIDT_CONTEXT_INVALID: "本次教学材料选择无效，请重新读取并选择已保存版本后发送",
  AIDT_CONTEXT_TOO_LARGE: "本次教学材料请求过大，请减少所选历史修订后重新发送",
  AIDT_CONTEXT_NOT_AVAILABLE: "当前无法使用所选教学材料，请核对小组、步骤和已保存版本后重新读取",
  AIDT_CONTEXT_CONFLICT: "这条消息与已提交的内容或教学材料选择不一致，请按原请求重试，或重新发送新消息",
  AIDT_CONTEXT_UNAVAILABLE: "教学材料服务暂时不可用，请稍后重试",
  AIDT_CONTEXT_SNAPSHOT_MISSING: "这次运行的教学材料记录缺失，无法沿用，请重新读取材料后发送新消息",
  AIDT_CONTEXT_SNAPSHOT_MISMATCH: "这次运行的教学材料与原记录不一致，无法继续沿用，请重新读取材料后发送新消息",
} satisfies Record<AidtContextErrorCode, string>;

describe("approved AIDT context failure copy", () => {
  it.each(AidtContextErrorCode.options)("describes the exact closed code without exposing technical details: %s", code => {
    expect(describeCopilotkitV2RunError(code)).toBe(aidtCopy[code]);
    expect(describeCopilotkitV2RunError(code)).not.toContain("AIDT_CONTEXT_");
  });
  it.each(AidtContextErrorCode.options)("decodes the installed AG-UI client's actual non-2xx message wrapper: %s", code => {
    const status = code === "AIDT_CONTEXT_CONFLICT" ? 409 : code === "AIDT_CONTEXT_NOT_AVAILABLE" ? 404 : code === "AIDT_CONTEXT_INVALID" || code === "AIDT_CONTEXT_TOO_LARGE" ? 422 : 503;
    const raw = `HTTP ${status}: ${JSON.stringify({ error: "closed-http-error", reasonCode: code, traceId: "trace-only", debug: "PRIVATE_SOURCE_SQL_TOKEN" })}`;
    const result = describeCopilotkitV2RunError(raw);
    expect(result).toBe(aidtCopy[code]);
    expect(result).not.toContain("PRIVATE_SOURCE_SQL_TOKEN");
    expect(result).not.toContain("trace-only");
  });
  it.each([
    "AIDT_CONTEXT_UNAPPROVED",
    "diagnostic: AIDT_CONTEXT_INVALID private-value",
    'HTTP 422: {"reasonCode":"AIDT_CONTEXT_UNAPPROVED","private":"hidden"}',
    'HTTP 422: {"reasonCode":123}',
    'HTTP 422: {"reasonCode":"AIDT_CONTEXT_INVALID"',
    'HTTP 422: ["AIDT_CONTEXT_INVALID"]',
    'HTTP 422: {"code":"AIDT_CONTEXT_INVALID"}',
    'HTTP 200: {"reasonCode":"AIDT_CONTEXT_INVALID"}',
    `HTTP 422: ${JSON.stringify({reasonCode:"AIDT_CONTEXT_INVALID",private:"x".repeat(16_384)})}`,
  ])("keeps unknown, embedded, malformed or oversized input on the safe fallback", raw => {
    expect(describeCopilotkitV2RunError(raw)).toBe("这次执行没有成功，请重试或联系管理员");
  });
  it("retains the existing ordinary SSE conflict and authorization wording", () => {
    expect(describeCopilotkitV2RunError("IDEMPOTENCY_CONFLICT")).toBe("这次请求与另一次正在进行的请求冲突，请重试");
    expect(describeCopilotkitV2RunError("AUTHZ_UNAVAILABLE")).toBe("权限校验服务暂时不可用，请稍后重试");
    expect(describeCopilotkitV2RunError("THREAD_NOT_VISIBLE")).toBe("这个对话你当前没有查看权限");
  });
});
