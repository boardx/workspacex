/**
 * issue #2686 —— 等待 399s 后，前端只把无稳定码的原始传输异常 message 当 code
 * 查表，落进通用兜底文案「这次执行没有成功，请重试或联系管理员」，用户看不出
 * "是超时"这个可行动信息。修复见 `copilotkit-v2-error-copy.ts` 的
 * `classifyTransportFailureMessage`：把常见的超时/连接中断类原始异常文案统一
 * 分类成 `AGENT_RUN_TIMEOUT` 的既有专属文案。
 */
import { describe, expect, it } from "vitest";
import { describeCopilotkitV2RunError } from "@/lib/copilotkit-v2-error-copy";

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
