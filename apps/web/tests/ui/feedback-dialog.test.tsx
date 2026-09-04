/**
 * FB-2 —— 导航栏反馈弹层与 chat 内 agent/skill 反馈按钮的采集侧行为。
 *
 * ## 这个文件断的六件事
 *
 *   ① **请求体恰好六个字段，没有 `submittedBy`、没有 `status`**——按**实际发出的
 *      请求体**断言，不是按组件源码：源码里没写 ≠ 运行时没发。
 *   ② **目标随入口变**：产品入口发 `{kind:"product"}`，skill 按钮发
 *      `{kind:"skill", skillId}`。发错目标 = 这条意见挂到别的对象上，而界面看不出来。
 *   ③ **不做乐观提交**。失败时明确说「没有被保存」——反馈是一次性表达，
 *      用户以为提交成功就不会再提第二次。
 *   ④ **成功后切到「我提过的」**并标出刚提交的那条。闭环的可见性就是这一下。
 *   ⑤ **上下文是显式展示的**（I-F1）：屏上要能读到"将附带当前页面"。
 *   ⑥ **没有 Provider 时按钮不渲染**，而不是渲染一个点了没反应的按钮。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});
const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: () => "/chat", useRouter: () => ({ push: routerPush, replace: vi.fn() }) }));

// 2026-09-04 review fix —— issue #2637 ④ 的录音胶囊用例需要自己驱动 `onLevel`/
// `onFinished` 这些 handler，不能等真实 WebSocket；同 `chat-live-message-panel-mic.test.tsx`
// 既有写法，只 mock 这一层网络边界，其余（`use-asr-draft.ts` 的状态机、组件本身）都是真的。
const { openAsrDraftStream } = vi.hoisted(() => ({ openAsrDraftStream: vi.fn() }));
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()),
  openAsrDraftStream,
}));

import { FeedbackProvider } from "@/components/feedback/feedback-provider";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import type { FeedbackTarget } from "@/lib/live-feedback";
import type { AsrDraftStreamHandlers } from "@/lib/live-asr-draft";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function openDialogFor(target: FeedbackTarget, label: string | null = null) {
  render(
    <FeedbackProvider>
      <FeedbackButton target={target} targetLabel={label} testid="open-feedback" />
    </FeedbackProvider>,
  );
  fireEvent.click(screen.getByTestId("open-feedback"));
}

/**
 * issue #2679 ②——表单现在是两段式：compose（只有「详细说说」+ 语音）→ 点「下一步」
 * 交给 AI 整理 → review（这时才有 kind/标题/结构化字段/附件/提交按钮）。
 * `proceedToReview` 把 compose→review 这一步封装起来，`fillAndSubmit` 在此基础上
 * 直接把整段流程走完到「直接提交」——多数既有用例只关心提交请求体，不关心中间那屏。
 */
async function proceedToReview() {
  fireEvent.click(screen.getByTestId("feedback-proceed-review"));
  await screen.findByTestId("feedback-submit");
}

async function fillAndSubmit(detail: string) {
  fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: detail } });
  await proceedToReview();
  fireEvent.click(screen.getByTestId("feedback-submit"));
}

/**
 * 提交成功 + 随后「我提过的」的读取，都走同一个 mock。
 *
 * ⚠ 2026-09-04（issue #2638）：打字提交时 `send()` 会先打一次 `/feedback/structure-draft`
 *   起 AI 标题，再打 `/feedback` 真正提交——两条都是 POST，必须按 **path** 分流，不能再用
 *   「是不是 POST」一刀切，否则起标题那次请求会被误当成提交、拿到不含 `title` 的响应形状。
 *   默认让起标题**失败**（`aiTitleFails: true`）：这样多数既有用例（断言 title 来自
 *   `deriveFeedbackTitle` 首句）不用逐个改判断，行为等价于"AI 不可用时静默退回派生标题"。
 */
function mockSubmitThenList(item: Record<string, unknown>, opts: { aiTitle?: string; aiTitleFails?: boolean } = {}) {
  const { aiTitleFails = true, aiTitle } = opts;
  apiRequest.mockImplementation(async (path: string, requestOpts?: { method?: string }) => {
    if (path === "/feedback/structure-draft") {
      if (aiTitleFails) throw new Error("structure-draft unavailable");
      return { kind: "缺陷", title: aiTitle, detail: "整理过的正文" };
    }
    if (requestOpts?.method === "POST") return { feedbackId: "fb-new", status: "待处理" };
    return { items: [item] };
  });
}

const mineItem = {
  id: "fb-new", kind: "缺陷", target: { kind: "product" }, targetLabel: null,
  title: "点了没反应", detail: "批准卡点了不动", attachments: [], status: "待处理", statusReason: null,
  votes: 0, votedByMe: false, submittedByMe: true,
  occurredRoute: "/chat", appVersion: null, createdAt: "2026-08-15T00:00:00.000Z",
};

describe("FB-2 反馈弹层（采集侧）", () => {
  it("① 请求体恰好六个字段（结构化字段全空 ⇒ 不带 structured 键），没有 submittedBy / status —— 按实际发出的请求断言", async () => {
    mockSubmitThenList(mineItem);
    openDialogFor({ kind: "product" });
    await fillAndSubmit("点了没反应。批准卡点了不动");

    await screen.findByTestId("feedback-just-submitted");
    // ⚠ 不再是 `mock.calls[0]`——打字提交先打一次 `/feedback/structure-draft` 起 AI 标题
    //   （见 `mockSubmitThenList` 头注），真正的提交请求按 path 找。
    const submitCall = apiRequest.mock.calls.find(([p]) => p === "/feedback");
    const [path, opts] = submitCall as [string, { method: string; body: Record<string, unknown> }];
    expect(path).toBe("/feedback");
    expect(opts.method).toBe("POST");
    expect(Object.keys(opts.body).sort()).toEqual(
      ["appVersion", "detail", "kind", "occurredRoute", "target", "title"].sort(),
    );
    expect(opts.body).not.toHaveProperty("submittedBy");
    expect(opts.body).not.toHaveProperty("status");
    // I-F1：发生位置由客户端给，且给的是真实当前路由。
    expect(opts.body.occurredRoute).toBe("/chat");
    // 标题从正文派生：第一句（到第一个句号）。
    expect(opts.body.title).toBe("点了没反应");
    expect(opts.body.detail).toBe("点了没反应。批准卡点了不动");
  });

  it("① 打字提交也会调 AI 起标题（issue #2638）：成功时用 AI 给的标题，不是正文首句", async () => {
    mockSubmitThenList(mineItem, { aiTitleFails: false, aiTitle: "批准按钮点击后无响应" });
    openDialogFor({ kind: "product" });
    await fillAndSubmit("点了没反应。批准卡点了不动");

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/feedback/structure-draft",
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/feedback",
      expect.objectContaining({ method: "POST" }),
    ));
    const submitCall = apiRequest.mock.calls.find(([path]) => path === "/feedback");
    const [, opts] = submitCall as [string, { body: Record<string, unknown> }];
    // issue #2679 ②——AI 整理现在发生在 compose→review 那一步（`proceedToReview`），
    // 与语音路径同一个用例、同一套语义：kind/title/detail 都换成 AI 整理过的版本，
    // 用户在 review 阶段还能看着改。所以这里正文也是 AI 给的那版，不再是"只取标题、
    // 正文原样"的旧语义（那是打字路径在提交前才顺手调一次 AI 的做法，已被 review
    // 阶段的整理取代）。
    expect(opts.body.title).toBe("批准按钮点击后无响应");
    expect(opts.body.detail).toBe("整理过的正文");
  });

  it("① 打字提交时 AI 起标题失败——静默退回正文首句，不报错、不挡提交", async () => {
    mockSubmitThenList(mineItem, { aiTitleFails: true });
    openDialogFor({ kind: "product" });
    await fillAndSubmit("点了没反应。批准卡点了不动");

    await screen.findByTestId("feedback-just-submitted");
    const submitCall = apiRequest.mock.calls.find(([path]) => path === "/feedback");
    const [, opts] = submitCall as [string, { body: Record<string, unknown> }];
    expect(opts.body.title).toBe("点了没反应");
    expect(screen.queryByTestId("feedback-submit-error")).toBeNull();
  });

  it("② skill 入口发的是 {kind:'skill', skillId}，不是产品级目标", async () => {
    mockSubmitThenList(mineItem);
    openDialogFor({ kind: "skill", skillId: "skill-3" }, "会议纪要");
    // 标题里要出现目标，否则用户不知道自己在对谁说话。
    expect(screen.getByTestId("feedback-dialog-title").textContent).toContain("会议纪要");

    await fillAndSubmit("输出格式不稳。有时候是表格有时候是段落");
    await screen.findByTestId("feedback-just-submitted");
    const submitCall = apiRequest.mock.calls.find(([p]) => p === "/feedback");
    const [, opts] = submitCall as [string, { body: Record<string, unknown> }];
    expect(opts.body.target).toEqual({ kind: "skill", skillId: "skill-3" });
  });

  it("② agent 入口发的是 {kind:'agent', agentId}", async () => {
    mockSubmitThenList(mineItem);
    openDialogFor({ kind: "agent", agentId: "agent-7" }, "调研助手");
    await fillAndSubmit("老是漏附件。上传了三个文件只读了一个");
    await screen.findByTestId("feedback-just-submitted");
    const submitCall = apiRequest.mock.calls.find(([p]) => p === "/feedback");
    const [, opts] = submitCall as [string, { body: Record<string, unknown> }];
    expect(opts.body.target).toEqual({ kind: "agent", agentId: "agent-7" });
  });

  it("③ 提交失败时明确说没有保存，且不切标签页", async () => {
    apiRequest.mockRejectedValue(new Error("boom"));
    openDialogFor({ kind: "product" });
    await fillAndSubmit("点了没反应。批准卡点了不动");

    const err = await screen.findByTestId("feedback-submit-error");
    expect(err.textContent).toContain("没有被保存");
    // 仍然停在提交表单上——切走会让用户以为提交成功了。
    expect(screen.getByTestId("feedback-form")).toBeTruthy();
  });

  it("④ 成功后切到「我提过的」，并把刚提交的那条标出来", async () => {
    mockSubmitThenList(mineItem);
    openDialogFor({ kind: "product" });
    await fillAndSubmit("点了没反应。批准卡点了不动");

    expect(await screen.findByTestId("feedback-mine-list")).toBeTruthy();
    expect(screen.getByTestId("feedback-just-submitted")).toBeTruthy();
    expect(screen.getByTestId("feedback-mine-item-fb-new")).toBeTruthy();
  });

  it("④ 「我提过的」读取失败时是失败态，不是空态 —— 两者必须分得开", async () => {
    apiRequest.mockRejectedValue(new Error("offline"));
    openDialogFor({ kind: "product" });
    fireEvent.click(screen.getByTestId("feedback-tab-mine"));

    const failed = await screen.findByTestId("feedback-mine-failed");
    expect(failed.textContent).toContain("没有丢");
    expect(screen.queryByTestId("feedback-mine-empty")).toBeNull();
  });

  it("⑤ 上下文明写在屏上（review 阶段），不是偷偷带上的", async () => {
    openDialogFor({ kind: "product" });
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "有正文了" } });
    await proceedToReview();
    const notice = screen.getByTestId("feedback-context-notice");
    expect(notice.textContent).toContain("当前页面");
    expect(notice.textContent).toContain("/chat");
  });

  it("⑤ compose 阶段正文为空时「下一步」不可点；写了内容才能进 review 看到标题/提交按钮", async () => {
    openDialogFor({ kind: "product" });
    // issue #2679 ②——compose 阶段只有「详细说说」+ 语音，压根没有标题框、kind 选择、
    // 结构化字段，也没有直接提交按钮——这些都要进了 review 才出现。
    expect(screen.queryByTestId("feedback-title-input")).toBeNull();
    expect(screen.queryByTestId("feedback-submit")).toBeNull();
    const proceed = screen.getByTestId("feedback-proceed-review") as HTMLButtonElement;
    expect(proceed.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "   " } });
    expect((screen.getByTestId("feedback-proceed-review") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "有正文了" } });
    expect((screen.getByTestId("feedback-proceed-review") as HTMLButtonElement).disabled).toBe(false);

    await proceedToReview();
    // review 阶段：标题框出现，且已经被派生标题填好（AI 整理未 mock，静默退回派生规则）；
    // 提交按钮此刻可点（正文非空、标题非空）。
    expect(screen.getByTestId("feedback-title-input")).toBeTruthy();
    expect((screen.getByTestId("feedback-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("⑥ 没有 Provider 时按钮**不渲染** —— 入口消失比入口失灵诚实", () => {
    render(<FeedbackButton target={{ kind: "product" }} targetLabel={null} testid="orphan-feedback" />);
    expect(screen.queryByTestId("orphan-feedback")).toBeNull();
  });

  it("⑥ 反证：有 Provider 时它确实渲染（否则上一条靠「永远不渲染」平凡通过）", () => {
    render(
      <FeedbackProvider>
        <FeedbackButton target={{ kind: "product" }} targetLabel={null} testid="wired-feedback" />
      </FeedbackProvider>,
    );
    expect(screen.getByTestId("wired-feedback")).toBeTruthy();
  });
});

/**
 * FB-5 补（2026-09-02 devapp 实测复盘）：部署重启窗口里传图/提交，浏览器只给一句
 * `TypeError: Failed to fetch`——原样显示等于什么都没说，而且失败的图只能删掉重选。
 * 这里断两件事：⑦ 网络层失败翻成人话；⑧ 失败的图能用当初那个 File 直接重试，重试成功
 * 之后提交请求体里带上它的 id。
 */
describe("FB-5 网络层失败的可读性与重试", () => {
  it("⑦ 提交遇到 TypeError: Failed to fetch —— 屏上是「无法连接服务器」，不是那行英文", async () => {
    // ⚠ 不用 `mockRejectedValueOnce`——打字提交会先打一次 `/feedback/structure-draft`
    //   起 AI 标题（被静默吞掉，不影响这条用例），真正要断言的失败发生在随后的
    //   `/feedback` 提交请求上，两次调用都该拒绝成同一种网络层失败。
    apiRequest.mockRejectedValue(new TypeError("Failed to fetch"));
    openDialogFor({ kind: "product" });
    await fillAndSubmit("点了没反应。批准卡点了不动");
    const err = await screen.findByTestId("feedback-submit-error");
    expect(err.textContent).toContain("无法连接服务器");
    expect(err.textContent).not.toContain("Failed to fetch");
    expect(err.textContent).toContain("没有被保存");
  });

  it("⑧ 传图失败可重试，重试成功后提交带上 attachmentIds", async () => {
    const createObjectURL = vi.fn(() => "blob:preview");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        ok: true, status: 201,
        text: async () => JSON.stringify({ attachmentId: "att-1", url: "/feedback/attachments/att-1" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    try {
      mockSubmitThenList({ ...mineItem, attachments: [] });
      openDialogFor({ kind: "product" });
      // issue #2679 ②——附件区在 review 阶段才存在，先进 review。
      fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "带图的反馈。见截图" } });
      await proceedToReview();
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", { type: "image/png" });
      fireEvent.change(screen.getByTestId("feedback-attachment-input"), { target: { files: [file] } });

      const errEl = await screen.findByTestId(/^feedback-attachment-error-/);
      expect(errEl.textContent).toContain("无法连接服务器");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId(/^feedback-attachment-retry-/));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByTestId(/^feedback-attachment-error-/)).toBeNull());
      // 重试发的是同一个 File（multipart 的 file 字段），不是要求用户重新选。
      const sentForm = (fetchMock.mock.calls[1]?.[1] as RequestInit).body as FormData;
      expect((sentForm.get("file") as File).name).toBe("shot.png");

      fireEvent.click(screen.getByTestId("feedback-submit"));
      await screen.findByTestId("feedback-just-submitted");
      // 按 path 找真正的提交请求——不能再靠"第一条 POST"，起标题那次也是 POST。
      const submitCall = apiRequest.mock.calls.find(([p]) => p === "/feedback");
      expect((submitCall![1] as { body: { attachmentIds?: string[] } }).body.attachmentIds).toEqual(["att-1"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * 2026-09-03 新增：⑨「套用模板」按当前 kind 填复现步骤/期望结果/实际结果（或需求版）
 * 进「详细说说」，已有内容不覆盖只追加；⑩ 拖图片进附件区等价于点「加图片」选中，
 * 走同一条上传路径。
 */
describe("FB-5 补：套用模板 / 拖拽上传", () => {
  // issue #2679 ②——「套用模板」现在只在 review 阶段才存在（compose 阶段还没有
  // kind/结构化字段的概念），所以每条用例先用一句占位话进 review，需要测「空正文」
  // 场景的再在 review 里把正文清空——两件事不冲突：进 review 的门槛是"曾经非空"，
  // 不是"此刻非空"。
  it("⑨ 空正文时点「套用模板」——缺陷 kind 填复现步骤/期望结果/实际结果结构", async () => {
    openDialogFor({ kind: "product" });
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "占位" } });
    await proceedToReview();
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("feedback-template-button"));
    const detail = screen.getByTestId("feedback-detail-input") as HTMLTextAreaElement;
    expect(detail.value).toContain("复现步骤");
    expect(detail.value).toContain("期望结果");
    expect(detail.value).toContain("实际结果");
  });

  it("⑨ 需求 kind 套用的是需求版模板，不是缺陷版", async () => {
    openDialogFor({ kind: "product" });
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "占位" } });
    await proceedToReview();
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("feedback-kind-需求"));
    fireEvent.click(screen.getByTestId("feedback-template-button"));
    const detail = screen.getByTestId("feedback-detail-input") as HTMLTextAreaElement;
    expect(detail.value).toContain("期望的效果");
    expect(detail.value).not.toContain("复现步骤");
  });

  it("⑨ 已经写了内容再点「套用模板」——追加在后面，不覆盖已写的话", async () => {
    openDialogFor({ kind: "product" });
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "已经写的话" } });
    await proceedToReview();
    fireEvent.click(screen.getByTestId("feedback-template-button"));
    const detail = screen.getByTestId("feedback-detail-input") as HTMLTextAreaElement;
    expect(detail.value.startsWith("已经写的话")).toBe(true);
    expect(detail.value).toContain("复现步骤");
  });

  it("⑨ 剩余空间放不下完整模板时——拒绝套用、正文原样不动，不插入半截模板", async () => {
    openDialogFor({ kind: "product" });
    // fireEvent.change 走的是程序化写值（同 setDetail），不受 textarea maxLength 限制，
    // 用来在测试里复现"正文已经很接近 4000 字上限"这个只有程序化写入才够得到的状态。
    const nearLimit = "字".repeat(3990);
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: nearLimit } });
    await proceedToReview();
    const templateButton = screen.getByTestId("feedback-template-button");
    fireEvent.click(templateButton);
    const detail = screen.getByTestId("feedback-detail-input") as HTMLTextAreaElement;
    // 正文没被半截模板污染——还是原来那 3990 个字，一个都没多。
    expect(detail.value).toBe(nearLimit);
    expect(detail.value).not.toContain("复现步骤");
    expect(screen.getByTestId("feedback-template-notice").textContent).toContain("放不下");
    // 提交按钮的可用性不受影响（正文本身没变，仍然合法）。
    expect((screen.getByTestId("feedback-submit") as HTMLButtonElement).disabled).toBe(false);

    // 连点两下同样不越界、不报第二次错以外的副作用。
    fireEvent.click(templateButton);
    expect(detail.value.length).toBeLessThanOrEqual(4000);
  });

  it("⑨ 套用一次因空间不够被拒绝后，先删点字腾出空间——再点就能成功套用", async () => {
    openDialogFor({ kind: "product" });
    const nearLimit = "字".repeat(3990);
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: nearLimit } });
    await proceedToReview();
    const templateButton = screen.getByTestId("feedback-template-button");
    fireEvent.click(templateButton);
    expect(screen.getByTestId("feedback-template-notice")).toBeTruthy();

    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "短一点的正文" } });
    // 手动改过正文后，上一次的提示应该已经清掉——不是挂在屏上的死提示。
    expect(screen.queryByTestId("feedback-template-notice")).toBeNull();

    fireEvent.click(templateButton);
    const detail = screen.getByTestId("feedback-detail-input") as HTMLTextAreaElement;
    expect(detail.value).toContain("复现步骤");
    expect(screen.queryByTestId("feedback-template-notice")).toBeNull();
  });

  it("⑩ 把图片拖进附件区（不点「加图片」）也能触发上传，同一条 addAttachments 路径", async () => {
    const createObjectURL = vi.fn(() => "blob:preview");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 201,
      text: async () => JSON.stringify({ attachmentId: "att-drop", url: "/feedback/attachments/att-drop" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      openDialogFor({ kind: "product" });
      fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "占位" } });
      await proceedToReview();
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "dropped.png", { type: "image/png" });
      const dropzone = screen.getByTestId("feedback-attachment-dropzone");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByTestId(/^feedback-attachment-error-/)).toBeNull());
      const sentForm = (fetchMock.mock.calls[0]?.[1] as RequestInit).body as FormData;
      expect((sentForm.get("file") as File).name).toBe("dropped.png");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * 2026-09-04 review fix（PR #2644 reviewer diagnostic，反复三轮要求的证据缺口）——
 * 下面三组用例分别锚定 issue #2637 ①②④ 三个此前只有"改动了源码"、没有可执行断言
 * 的用户可见变化：弹窗尺寸、附件懒加载真的等到进视口才发请求、录音胶囊的状态与
 * 无障碍属性。全部驱动真实组件，不 mock 掉被测的那一层。
 */
describe("issue #2637 ① —— 反馈弹窗放大到预期尺寸", () => {
  it("对话框容器带 max-w-2xl 与 h-[min(85vh,54rem)]，不再是旧的 512px 小窗", () => {
    openDialogFor({ kind: "product" });
    const dialog = screen.getByTestId("feedback-dialog");
    expect(dialog.className).toContain("max-w-2xl");
    expect(dialog.className).toContain("h-[min(85vh,54rem)]");
    // 反证：旧尺寸 class 不该再出现，防止两条 class 同时挂着、样式互相打架却测不出来。
    expect(dialog.className).not.toContain("max-w-lg");
  });
});

describe("issue #2637 ② —— 「我提过的」附件缩略图懒加载", () => {
  /** 可控的 IntersectionObserver 假实现：测试自己决定什么时候"滚进视口"。 */
  function stubIntersectionObserver() {
    const instances: {
      callback: IntersectionObserverCallback;
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }[] = [];
    class FakeIntersectionObserver {
      readonly observe = vi.fn();
      readonly disconnect = vi.fn();
      constructor(private readonly callback: IntersectionObserverCallback) {
        instances.push({ callback, observe: this.observe, disconnect: this.disconnect });
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver as unknown as typeof IntersectionObserver);
    return instances;
  }

  it("缩略图不在视口时不发起带鉴权的下载；滚进视口后才发起一次并断开观察，反复进出视口不重复请求", async () => {
    const instances = stubIntersectionObserver();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["x"]),
    });
    vi.stubGlobal("fetch", fetchMock);
    // Only stub the two object-URL statics -- replacing the whole `URL` global would also
    // break `new URL(...)` (used by `apiUrl()` to build the fetch target itself).
    const createObjectURL = vi.fn(() => "blob:thumb");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    // 2026-09-04 review fix 第四轮 -- 没有存过 session token 时 `Authorization` 头压根不会
    // 被设置（`getStoredSessionToken()` 返回 null 时代码直接跳过那一行），这里显式存一个，
    // 让"带鉴权"这个断言真的有东西可断，不是巧合地测了个空头部。
    window.localStorage.setItem("wsx.sessionToken", "tok-123");
    try {
      mockSubmitThenList({
        ...mineItem,
        attachments: [{ id: "att-1", url: "/feedback/attachments/att-1", mime: "image/png" }],
      });
      openDialogFor({ kind: "product" });
      fireEvent.click(screen.getByTestId("feedback-tab-mine"));
      await screen.findByTestId("feedback-mine-attachments-fb-new");

      // 卡片已经渲染（占位骨架），但 `AttachmentThumbnail` 的 IntersectionObserver 还没
      // 报告命中——此刻绝不该已经发出下载请求，这正是人类反馈"默认全加载"想要修掉的行为。
      expect(fetchMock).not.toHaveBeenCalled();

      const [observed] = instances;
      expect(observed).toBeTruthy();
      observed!.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        observed as unknown as IntersectionObserver,
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(requestInit.headers.Authorization).toBe("Bearer tok-123");
      // 命中一次后应当断开观察，不再持续监听。
      expect(observed!.disconnect).toHaveBeenCalledTimes(1);

      // 反证：即便上游（真实浏览器里不会发生，但这里直接摆出最坏情况）又报一次命中，
      // `inView` 已经是 true，`setInView(true)` 对同值 state 是 no-op，触发下载的
      // effect 不会重新跑——"只发一次"不是靠 mock 侥幸没被再调用一次撑起来的。
      observed!.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        observed as unknown as IntersectionObserver,
      );
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      window.localStorage.removeItem("wsx.sessionToken");
      vi.unstubAllGlobals();
    }
  });
});

describe("issue #2637 ④ —— 录音胶囊状态与无障碍", () => {
  function stubCaptureSupport() {
    vi.stubGlobal("WebSocket", class {} as unknown as typeof WebSocket);
    vi.stubGlobal("AudioContext", class {} as unknown as typeof AudioContext);
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
  }

  it("只在 listening 时红点脉冲、音量条随真实 level 变化；connecting/stopping 不假装还在录", async () => {
    stubCaptureSupport();
    let handlers: AsrDraftStreamHandlers | null = null;
    // `await Promise.resolve()` before `onFinished()` matters: a synchronous mock would
    // resolve `finish()` in the same tick as `stop()` is called, collapsing the observable
    // "stopping" window to nothing (same pitfall documented in
    // chat-live-message-panel-mic.test.tsx's own `deferredStream()`).
    const stop = vi.fn(async () => { await Promise.resolve(); handlers?.onFinished(); });
    // A deferred (test-controlled) promise, not an immediately-resolving async mock: an
    // immediate resolve races ahead of `findByTestId`'s own polling and the "connecting"
    // phase becomes unobservable (the exact pitfall `chat-live-message-panel-mic.test.tsx`'s
    // `deferredStream()` exists to avoid) -- here we resolve it ourselves, on our own schedule.
    let resolveOpen: ((handle: { stop: typeof stop }) => void) | null = null;
    openAsrDraftStream.mockImplementation((h: AsrDraftStreamHandlers) => {
      handlers = h;
      return new Promise((resolve) => { resolveOpen = resolve; });
    });
    try {
      openDialogFor({ kind: "product" });
      fireEvent.click(screen.getByTestId("feedback-voice-button"));

      // connecting：`open()` 还没 resolve，还没听到任何声音，胶囊必须存在但不能假装在脉冲。
      const pill = await screen.findByTestId("feedback-voice-recording");
      expect(pill.querySelector(".animate-ping")).toBeNull();
      expect(screen.getByTestId("feedback-voice-stop")).toBeDisabled();

      await waitFor(() => expect(handlers).not.toBeNull());
      await act(async () => { resolveOpen!({ stop }); await Promise.resolve(); });
      // 模拟真实采到的音量：此刻已进入 listening。
      act(() => { handlers!.onLevel?.(0.6); });
      await waitFor(() => expect(screen.getByTestId("feedback-voice-stop")).not.toBeDisabled());

      const listeningPill = screen.getByTestId("feedback-voice-recording");
      expect(listeningPill.querySelector(".animate-ping")).not.toBeNull(); // 呼吸动画只在真正 listening 时出现
      const meter = screen.getByRole("meter", { name: "音量" });
      expect(meter.getAttribute("aria-valuenow")).toBe("0.6");
      // 停止按钮此刻可点（未在 stopping/connecting），取消按钮同理可点。
      expect(screen.getByTestId("feedback-voice-cancel")).not.toBeDisabled();

      // 点「说完了」进入 stopping：停止按钮必须立刻 disabled，防止用户在等待收尾期间
      // 又点一次触发第二条 finish() 竞态。`stop()` 的 mock 随后异步 resolve `onFinished`，
      // 胶囊会整个卸载（回到 idle）——那之后的状态不再是这条用例要断言的"stopping 中"。
      fireEvent.click(screen.getByTestId("feedback-voice-stop"));
      expect(screen.getByTestId("feedback-voice-stop")).toBeDisabled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
