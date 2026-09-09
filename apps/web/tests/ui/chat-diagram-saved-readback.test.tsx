/**
 * G1 读回（design-delta chat-persona-roundtrip，confirmed 2026-08-18）组件级钉死：
 *
 * A. `fetchLatestSavedDiagramSource` 的请求序列——`listThreadArtifacts` →
 *    按 messageId 过滤取最新（多次保存不去重，列表升序取最后一条）→
 *    `getThreadArtifactSource`；无保存版 ⇒ null（不打 source 请求）；
 *    404（他人草稿）⇒ null（静默，不提示存在性——I-36）。
 *
 * B. `ChatDiagramCanvasModal` 的读回呈现——有 `savedSource` 时初始内容为保存版
 *    markdown、`chat-diagram-loaded-saved` 提示条可见；点 `chat-diagram-revert-original`
 *    后编辑区变回原始消息内容、提示条切「正在查看原始版本」+「回到保存版」出口；
 *    无 `savedSource` 时无提示条、初始内容为原始消息内容（回归既有行为）。
 *    真实 fabric 画布 jsdom 建不出（VZ-fabric 系列既有测试头注），CanvasStage
 *    换成回显 markdown 的探针——够钉住「初始化内容 + 版本切换」这份接线。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { wrapAsMermaidBlock } from "@repo/fabric-markdown/markdown";
import { ApiError } from "@/lib/api-client";

const { listThreadArtifacts, getThreadArtifactSource } = vi.hoisted(() => ({
  listThreadArtifacts: vi.fn(),
  getThreadArtifactSource: vi.fn(),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listThreadArtifacts, getThreadArtifactSource,
}));

// `CanvasStage` 从这个探针替换开始就是 `React.forwardRef` 组件（导出画布截图的
// 命令式句柄需要它）——探针跟着换成 forwardRef，不然 `ChatDiagramCanvasModal`
// 传 `ref={stageRef}` 给它会撞 React 的 "Function components cannot be given
// refs" 警告（不影响这几条测试断言，但是噪音，留着不修就是往后每次跑测试都要
// 看一遍这条无关警告）。
vi.mock("@/components/canvas/canvas-stage", () => ({
  CanvasStage: React.forwardRef(function CanvasStageProbe(props: { markdown: string }, _ref) {
    return <pre data-testid="canvas-stage-probe">{props.markdown}</pre>;
  }),
}));

import { fetchLatestSavedDiagramSource } from "@/lib/chat/diagram-readback";
import { ChatDiagramCanvasModal } from "@/components/chat/chat-diagram-canvas-modal";

// ⚠ hasSource 恒 false 是**有意的**：modal 保存的 draft 无 citations ⇒ 契约的
// hasSource（「有出处引用」）恒 false。读回逻辑不得拿它当「有源字节」过滤——
// e2e 首轮实测就因为这个误用把每条保存版都滤掉了，此处钉死回归。
const item = (over: Record<string, unknown>) => ({
  artifactId: "a", title: "t", mode: "draft", version: null,
  pinnedBy: null, pinnedAt: null, hasSource: false, messageId: "m-1", ...over,
});

describe("A · fetchLatestSavedDiagramSource 请求序列", () => {
  beforeEach(() => vi.clearAllMocks());

  it("按 messageId 过滤取最新一条（列表升序 ⇒ 最后一条命中），再取 source", async () => {
    listThreadArtifacts.mockResolvedValue({
      items: [
        item({ artifactId: "a-old", messageId: "m-1" }),
        item({ artifactId: "a-other", messageId: "m-2" }),
        item({ artifactId: "a-new", messageId: "m-1" }),
      ],
    });
    getThreadArtifactSource.mockResolvedValue({
      markdown: "flowchart TD\n  a-->第二次保存", version: null,
      savedAt: "2026-08-18T01:00:00.000Z", savedBy: "u1",
    });

    const saved = await fetchLatestSavedDiagramSource({
      threadId: "t", messageId: "m-1", projectId: "p", bearer: "b",
    });

    expect(listThreadArtifacts).toHaveBeenCalledWith("t", "p", "b");
    expect(getThreadArtifactSource).toHaveBeenCalledWith("t", "a-new", "p", "b");
    expect(saved).toEqual({ markdown: "flowchart TD\n  a-->第二次保存", savedAt: "2026-08-18T01:00:00.000Z" });
  });

  it("无本消息的保存版 ⇒ null，且不打 source 请求", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [item({ messageId: "m-other" })] });
    const saved = await fetchLatestSavedDiagramSource({
      threadId: "t", messageId: "m-1", projectId: "p", bearer: "b",
    });
    expect(saved).toBeNull();
    expect(getThreadArtifactSource).not.toHaveBeenCalled();
  });

  it("读回 404（他人草稿，I-36）⇒ 静默 null，不提示存在性", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [item({})] });
    getThreadArtifactSource.mockRejectedValue(new ApiError(404, null, undefined));
    const saved = await fetchLatestSavedDiagramSource({
      threadId: "t", messageId: "m-1", projectId: "p", bearer: "b",
    });
    expect(saved).toBeNull();
  });

  it("同一消息有两个不同画布时，按围栏身份取各自最新保存版", async () => {
    listThreadArtifacts.mockResolvedValue({
      items: [
        item({ artifactId: "canvas-persona" }),
        item({ artifactId: "canvas-journey" }),
      ],
    });
    getThreadArtifactSource.mockImplementation(async (_threadId: string, artifactId: string) => ({
      markdown: artifactId === "canvas-persona"
        ? "模板: persona\n## 目标\n- 保存后的画像"
        : "模板: journey-map\n## 阶段\n- 保存后的旅程",
      version: null,
      savedAt: artifactId === "canvas-persona" ? "2026-09-07T01:00:00.000Z" : "2026-09-07T02:00:00.000Z",
      savedBy: "u1",
    }));

    const persona = await fetchLatestSavedDiagramSource({
      threadId: "t", messageId: "m-1", projectId: "p", bearer: "b",
      accepts: (markdown) => markdown.startsWith("模板: persona\n"),
    });

    expect(persona?.markdown).toContain("保存后的画像");
    expect(getThreadArtifactSource).toHaveBeenCalledWith("t", "canvas-persona", "p", "b");
  });

  /**
   * issue #3230 —— 「一条消息里 10 个画布，刷新后先出现、随后突然消失」的反证。
   *
   * 一条助手消息里有 N 个画布围栏，但这条消息名下**只有一条**已落地产物（最常见的
   * 来源是「落地为产物（草稿）」把**整条消息正文**落成一条 artifact，也可能是只保存
   * 过其中一个围栏）。此前 `candidates.length === 1` 这条旁路会把那条唯一的产物
   * **绕过 `accepts` 身份判定**直接返回，于是每一个围栏挂载即读回都拿到同一份不属于
   * 自己的 markdown ⇒ `previewCode` 被换掉 ⇒ 外层 `key` 变 ⇒ 已经画好的 fabric
   * 整棵重挂 ⇒ 新内容过不了 `checkCanvasFence` ⇒ 画布「先出现、随后变成错误框」。
   *
   * 调用方传了 `accepts` 就是在说「这份源必须属于这个围栏」；数量是 1 不改变这句话。
   */
  it("只有一条保存版但不属于本围栏（accepts 判否）⇒ null，不拿它顶替本围栏（#3230）", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [item({ artifactId: "landed-whole-message" })] });
    getThreadArtifactSource.mockResolvedValue({
      // 「落地为产物」落的是整条消息正文：10 个围栏拼在一起，任何单个围栏都不认它。
      markdown: "以上为 10 个战略推演画布…\n\n```canvas\n模板: persona\n```\n",
      version: null, savedAt: "2026-09-09T01:00:00.000Z", savedBy: "u1",
    });

    const saved = await fetchLatestSavedDiagramSource({
      threadId: "t", messageId: "m-1", projectId: "p", bearer: "b",
      accepts: (markdown) => markdown.startsWith("模板: journey-map\n"),
    });

    expect(saved).toBeNull();
  });

  it("只有一条保存版且属于本围栏（accepts 判是）⇒ 照常返回（不误伤单画布消息）", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [item({ artifactId: "canvas-journey" })] });
    getThreadArtifactSource.mockResolvedValue({
      markdown: "模板: journey-map\n## 阶段\n- 保存后的旅程",
      version: null, savedAt: "2026-09-09T02:00:00.000Z", savedBy: "u1",
    });

    const saved = await fetchLatestSavedDiagramSource({
      threadId: "t", messageId: "m-1", projectId: "p", bearer: "b",
      accepts: (markdown) => markdown.startsWith("模板: journey-map\n"),
    });

    expect(saved?.markdown).toContain("保存后的旅程");
  });

  it("不传 accepts（mermaid 单图路径）⇒ 行为逐字不变：唯一保存版照常返回", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [item({ artifactId: "only" })] });
    getThreadArtifactSource.mockResolvedValue({
      markdown: "flowchart TD\n  a-->保存版", version: null,
      savedAt: "2026-09-09T03:00:00.000Z", savedBy: "u1",
    });
    const saved = await fetchLatestSavedDiagramSource({
      threadId: "t", messageId: "m-1", projectId: "p", bearer: "b",
    });
    expect(saved?.markdown).toContain("保存版");
  });
});

const ORIGINAL_CODE = "flowchart TD\n  a-->b";
const SAVED_MERMAID = "flowchart TD\n  a-->b\n  b-->新节点X";

describe("B · ChatDiagramCanvasModal 读回呈现（不静默替换）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("有保存版：初始内容为保存版，提示条可见；回到原始版本 ⇒ 内容切回原文 + 可再切回保存版", async () => {
    render(
      <ChatDiagramCanvasModal
        code={ORIGINAL_CODE}
        onClose={() => {}}
        threadId="t" messageId="m-1" bearer="b"
        savedSource={{ markdown: SAVED_MERMAID, savedAt: "2026-08-18T01:00:00.000Z" }}
      />,
    );

    expect(screen.getByTestId("canvas-stage-probe").textContent).toBe(wrapAsMermaidBlock(SAVED_MERMAID));
    expect(screen.getByTestId("chat-diagram-loaded-saved")).toBeTruthy();

    fireEvent.click(screen.getByTestId("chat-diagram-revert-original"));
    expect(screen.getByTestId("canvas-stage-probe").textContent).toBe(wrapAsMermaidBlock(ORIGINAL_CODE));
    expect(screen.queryByTestId("chat-diagram-loaded-saved")).toBeNull();
    expect(screen.getByTestId("chat-diagram-viewing-original")).toBeTruthy();

    fireEvent.click(screen.getByTestId("chat-diagram-back-to-saved"));
    expect(screen.getByTestId("canvas-stage-probe").textContent).toBe(wrapAsMermaidBlock(SAVED_MERMAID));
    expect(screen.getByTestId("chat-diagram-loaded-saved")).toBeTruthy();
  });

  it("无保存版：无提示条，初始内容为原始消息内容（回归既有行为）", () => {
    render(
      <ChatDiagramCanvasModal code={ORIGINAL_CODE} onClose={() => {}} threadId="t" messageId="m-1" bearer="b" />,
    );
    expect(screen.getByTestId("canvas-stage-probe").textContent).toBe(wrapAsMermaidBlock(ORIGINAL_CODE));
    expect(screen.queryByTestId("chat-diagram-loaded-saved")).toBeNull();
    expect(screen.queryByTestId("chat-diagram-viewing-original")).toBeNull();
  });
});
