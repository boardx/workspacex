/**
 * A4（`docs/agents/team2-acceptance-rubric.md`）—— 发起链路**本身**被测。
 *
 * 此前只有组件测试，它把 `launchRatingThread` 整个 mock 掉了：按钮点得动、跳得走，
 * 而这个函数内部到底有没有把 Agent 挂进编制、有没有把附件 id 带进消息，**没有任何
 * 断言**。少挂一步的表现是「对话建起来了，Agent 不说话」或「Agent 说话了但看不见附件」
 * ——两者都不会抛异常，静态检查也全绿。
 *
 * 这里只 mock 网络边界（`@/lib/live-chat`），断言真实的调用序列与参数。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const createPersonalThread = vi.fn();
const getAgentPanel = vi.fn();
const updateAgentRoster = vi.fn();
const uploadAttachment = vi.fn();
const createMessage = vi.fn();

vi.mock("@/lib/live-chat", () => ({
  createPersonalThread: (...a: unknown[]) => createPersonalThread(...a),
  getAgentPanel: (...a: unknown[]) => getAgentPanel(...a),
  updateAgentRoster: (...a: unknown[]) => updateAgentRoster(...a),
  uploadAttachment: (...a: unknown[]) => uploadAttachment(...a),
  createMessage: (...a: unknown[]) => createMessage(...a),
}));

const { launchRatingThread } = await import("@/lib/postinvest-rating/launch-rating-thread");
const { EMPTY_MISSING_REASON } = await import("@/lib/postinvest-rating/missing-reason");
const { RATING_MEMO_TAG } = await import("@/lib/postinvest-rating/rating-memo");

const file = (name: string) => new File(["x"], name, { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  createPersonalThread.mockResolvedValue({ threadId: "t1" });
  getAgentPanel.mockResolvedValue({ rosterVersion: 7 });
  updateAgentRoster.mockResolvedValue({});
  uploadAttachment.mockImplementation((_t: string, f: File) => Promise.resolve({ id: `att-${f.name}` }));
  createMessage.mockResolvedValue({});
});

const run = () =>
  launchRatingThread({
    agentId: "agent-team2",
    files: [file("2025年报.pdf"), file("审计报告.pdf")],
    missingReason: { ...EMPTY_MISSING_REASON, reasons: ["lost_contact"] },
  });

describe("launchRatingThread 的五步链路", () => {
  /**
   * 2026-09-15 人类实测 403：绑项目那条路要求调用者在该项目里有非 observer 的成员角色
   * （`mutate-thread.ts` 的 NO_WRITE_ROLE）。而项目选择器是按**可见性**填的，可见 ≠ 可写。
   * 组织管理员能看见全部项目却一个都不能写，于是「所有人都能用」被前端自己挡住了。
   * 个人线程是 `mutate-thread.ts` 的第一条分支，无需项目成员资格。
   */
  it("走个人线程：不调用需要项目写权的 createThread", async () => {
    await run();
    expect(createPersonalThread).toHaveBeenCalledTimes(1);
    expect(createPersonalThread.mock.calls[0]![0]).toContain("投后评级");
  });

  it("Agent 真的被挂进这条线程的编制，且带上读到的 rosterVersion", async () => {
    await run();
    expect(getAgentPanel).toHaveBeenCalledWith("t1", null);
    expect(updateAgentRoster).toHaveBeenCalledWith("t1", null, {
      add: ["agent-team2"], remove: [], expectedRosterVersion: 7,
    });
  });

  it("每一份材料都上传到这条线程，一份都不漏", async () => {
    await run();
    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(uploadAttachment.mock.calls.map((c) => (c[1] as File).name))
      .toEqual(["2025年报.pdf", "审计报告.pdf"]);
    expect(uploadAttachment.mock.calls.every((c) => c[0] === "t1")).toBe(true);
  });

  it("消息带上全部 attachmentId 与 agentId——少了任一项 Agent 就看不到材料或不应答", async () => {
    await run();
    const body = createMessage.mock.calls[0]![1];
    expect(createMessage.mock.calls[0]![0]).toBe("t1");
    expect(body.agentId).toBe("agent-team2");
    expect(body.attachmentIds).toEqual(["att-2025年报.pdf", "att-审计报告.pdf"]);
    expect(body.clientMessageId).toBeTruthy();
  });

  it("任务书带上材料名、人工确认事实与记忆协议", async () => {
    await run();
    const text: string = createMessage.mock.calls[0]![1].text;
    expect(text).toContain("2025年报.pdf");
    expect(text).toContain("失联");           // 人工确认事实进了任务书
    expect(text).toContain(RATING_MEMO_TAG);  // 记忆协议在
  });

  it("顺序不能乱：先建线程、再挂编制、再传附件、最后发消息", async () => {
    const order: string[] = [];
    createPersonalThread.mockImplementation(() => { order.push("thread"); return Promise.resolve({ threadId: "t1" }); });
    updateAgentRoster.mockImplementation(() => { order.push("roster"); return Promise.resolve({}); });
    uploadAttachment.mockImplementation((_t: string, f: File) => { order.push("upload"); return Promise.resolve({ id: `att-${f.name}` }); });
    createMessage.mockImplementation(() => { order.push("message"); return Promise.resolve({}); });
    await run();
    expect(order).toEqual(["thread", "roster", "upload", "upload", "message"]);
  });

  it("返回本次线程，供调用方跳转", async () => {
    await expect(run()).resolves.toEqual({ threadId: "t1" });
  });
});
