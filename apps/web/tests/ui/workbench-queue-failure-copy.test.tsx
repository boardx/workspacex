import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * issue #3317 ②：待发送消息面板的失败文案判据。
 *
 * 判据钉在**用户看见的那句话**上（`role="alert"` 的 textContent），不是「有 error 字段」——
 * 裸的 `http_502` 能轻松通过后者，那种断言在本缺陷下无法被证伪。
 *
 * 这里刻意走真实链路：真实 `ApiError`（只把 `apiRequest` 换成会拒绝的替身）
 * → 真实 `useThreadMessageQueue` → 真实 `QueuedMessagesPanel`。
 * 只有整条链上都接了文案层，这三条才可能绿。
 */
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest: request,
}));

const { ApiError } = await import("@/lib/api-client");
const { useThreadMessageQueue } = await import("@/lib/chat-workbench/use-thread-message-queue");
const { QueuedMessagesPanel } = await import("@/components/chat/workbench/queued-messages-panel");
const { BARE_STATUS_CODE_PATTERN } = await import("@/lib/chat-workbench/queue-failure-copy");

/** devapp 上网关真实回的是一整页 HTML，`JSON.parse` 失败 ⇒ `reasonCode === null`。 */
const GATEWAY_502 = new ApiError(502, null, undefined, "<html><head><title>502 Bad Gateway</title></head></html>");

function Harness() {
  const queue = useThreadMessageQueue("thread", "agent", "token");
  return <QueuedMessagesPanel items={queue.items} cancel={queue.cancel} cancelling={queue.cancelling} edit={queue.edit} error={queue.error} canWrite />;
}

async function alertText(): Promise<string> {
  const alert = await screen.findByRole("alert");
  return (alert.textContent ?? "").trim();
}

afterEach(() => { request.mockReset(); });

describe("#3317 待发送消息面板：失败时说的是人话，不是裸状态码", () => {
  it("网关 502 时，用户看见的那句话不是裸状态码，且说清哪一步/为什么/产物在不在/要不要重试", async () => {
    request.mockRejectedValue(GATEWAY_502);
    render(<Harness />);
    const text = await waitFor(async () => {
      const value = await alertText();
      expect(value.length).toBeGreaterThan(0);
      return value;
    });

    // ① 缺陷形状本身：整句就是一个裸码 —— 这正是 devapp 上人类看到的东西。
    expect(text, "失败文案整体是一个裸状态码，用户读不出任何信息").not.toMatch(BARE_STATUS_CODE_PATTERN);
    // ② 更强的一条：`ApiError.message` 在这条路径上恰好是 `http_502`，文案不得等于它。
    expect(text, "文案直接把 ApiError.message 印出来了（没有接文案层）").not.toBe(GATEWAY_502.message);
    expect(text).not.toContain("http_502");

    // ③ 用户当场会问的四件事，逐条落在这句话里。
    expect(text, "没说哪一步失败").toContain("读取待发送消息列表");
    expect(text, "没说为什么").toContain("网关");
    expect(text, "没说在途任务与产物还在不在").toContain("正在执行的任务和已经生成的产物不受影响");
    expect(text, "没说要不要用户做什么").toContain("自动重试");
  });

  it("两种不同成因的失败，面板上说的不是同一句话", async () => {
    request.mockRejectedValue(GATEWAY_502);
    const gateway = render(<Harness />);
    const gatewayText = await waitFor(async () => {
      const value = await alertText();
      expect(value.length).toBeGreaterThan(0);
      return value;
    });
    gateway.unmount();

    request.mockReset();
    request.mockRejectedValue(new ApiError(403, "NO_WRITE_ROLE", { error: "NO_WRITE_ROLE" }));
    render(<Harness />);
    const rejectedText = await waitFor(async () => {
      const value = await alertText();
      expect(value.length).toBeGreaterThan(0);
      expect(value).not.toBe(gatewayText);
      return value;
    });

    expect(rejectedText).not.toBe(gatewayText);
    expect(gatewayText).toContain("网关");
    expect(rejectedText).toContain("NO_WRITE_ROLE");
    expect(rejectedText).not.toMatch(BARE_STATUS_CODE_PATTERN);
  });

  it("非 ApiError 的传输失败也走文案层，不把开发者字符串单独甩给用户", async () => {
    request.mockRejectedValue(new Error("Failed to fetch"));
    render(<Harness />);
    const text = await waitFor(async () => {
      const value = await alertText();
      expect(value.length).toBeGreaterThan(0);
      return value;
    });
    expect(text).not.toBe("Failed to fetch");
    expect(text).toContain("读取待发送消息列表");
    expect(text).toContain("正在执行的任务和已经生成的产物不受影响");
  });
});
