/**
 * **issue #3252 的反证**：同一条助手消息里两个**同模板**画布，各自的保存版不互相认领。
 *
 * ## 缺陷形状
 *
 * 保存链路上唯一的关联键是 `(threadId, messageId)`——`chat_artifact_landings` 既没有
 * 围栏序号也没有模板列。围栏之间的区分此前完全靠 `chat-canvas-fabric.tsx` 这一句：
 *
 * ```ts
 * return checked.ok && checked.key === sourceTemplateKey;   // ← 只比模板 key
 * ```
 *
 * 于是「同模板」就等于「同一个围栏」：编辑并保存第一个之后，第二个在挂载即读回 /
 * 打开全屏时把第一个的字节当成自己的读进来。
 *
 * ## 为什么用两个**同模板**围栏
 *
 * 两个**不同**模板的围栏在缺陷版本下也会通过（`checked.key` 不同就拒了），写出来的
 * 用例对这个缺陷恒绿，等于没测——`chat-fabric-auto-readback-on-mount.test.tsx` 里
 * 那条「两个不同模板」正是这个形状，它挡不住 #3252。缺陷的形状是「同模板不可分」，
 * 判据必须长成同一个形状。
 *
 * ## 判据是**内容**，不是「元素在不在」
 *
 * 全屏编辑器（`ChatCanvasModal`）用哪份 markdown 初始化，是这件事唯一的结构事实：
 * 探针 `canvas-stage-probe` 把它原样吐出来。含「之一」= 认领了第一个围栏的保存版
 * （缺陷现形），含「之二」= 用的是自己的原文（应该的样子）。本仓纪律：不拿
 * 「提示条存在/不存在」当业务断言——提示条只说明「读回发生了没有」，不说明
 * 「读回的是谁的」。
 *
 * ## 与浏览器那条门的关系
 *
 * `apps/web/e2e/chat-path-c2-canvas-fence-identity.spec.ts` 是同一判据在真实浏览器
 * 里的门（本次一并从 `test.fixme` 转成真断言）。本文件是它在组件层的对应物：不需要
 * docker / 浏览器 / 真实模型就能跑，因此是这次修复的反证主体。
 */
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { canvasFenceIdentity, tagCanvasArtifactTitle } from "@/lib/canvas/canvas-fence-identity";
import { __resetFenceTemplateCache } from "@/lib/canvas/fence-template-resolver";

const { listThreadArtifacts, getThreadArtifactSource, landAsArtifact, markdownToCanvas } = vi.hoisted(() => ({
  listThreadArtifacts: vi.fn(),
  getThreadArtifactSource: vi.fn(),
  landAsArtifact: vi.fn(),
  markdownToCanvas: vi.fn(),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listThreadArtifacts,
  getThreadArtifactSource,
  landAsArtifact,
}));

const listCanvasTemplates = vi.fn();
vi.mock("@/lib/live-canvas", () => ({
  listCanvasTemplates: (...args: unknown[]) => listCanvasTemplates(...args),
}));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org-1" } }),
}));

// 见 `chat-fabric-auto-readback-on-mount.test.tsx` 同名注释：jsdom 下真实 fabric
// 会撞自建 DOM 包裹节点的拆装时序，与本文件要验的归属判定无关，换成不碰 DOM 的桩。
vi.mock("@repo/fabric-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/fabric-markdown")>();
  return { ...actual, markdownToCanvas, fitToContent: vi.fn() };
});
vi.mock("fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fabric")>();
  class StubCanvas {
    forEachObject(): void {}
    requestRenderAll(): void {}
    dispose(): void {}
  }
  return { ...actual, Canvas: StubCanvas };
});

// 全屏编辑器实际吃到哪份 markdown —— 本文件的判据就读它。
vi.mock("@/components/canvas/canvas-stage", () => ({
  CanvasStage: React.forwardRef(function CanvasStageProbe(props: { markdown: string }, _ref) {
    return <pre data-testid="canvas-stage-probe">{props.markdown}</pre>;
  }),
}));

/** C4 剧本（`loopback-model-provider.ts` 的 `canvasFence`）的形状：同模板、表头字段带「之一/之二」。 */
const fence = (suffix: string) =>
  ["模板: persona", `姓名: 林可${suffix}`, "## 用户描述", `- 项目型采购${suffix}`].join("\n");
const FENCE_FIRST = fence("之一");
const FENCE_SECOND = fence("之二");
const MESSAGE = ["```canvas", FENCE_FIRST, "```", "", "```canvas", FENCE_SECOND, "```"].join("\n");

/** 第一个围栏被编辑过一次后落库的字节——它仍然是「之一」那一份，多了一张便签。 */
const FIRST_SAVED = ["模板: persona", "姓名: 林可之一", "## 用户描述", "- 项目型采购之一", "- 新便签"].join("\n");

const artifact = (over: Record<string, unknown>) => ({
  artifactId: "a-first", title: "工作坊画布 · 2026/9/21 10:00:00", mode: "draft", version: null,
  pinnedBy: null, pinnedAt: null, hasSource: false, messageId: "m-1", ...over,
});

function renderMessage() {
  return render(
    <MarkdownMessage text={MESSAGE} threadId="t" messageId="m-1" bearer="b" projectId="p" />,
  );
}

/** 打开第 n 个围栏的全屏编辑器，返回它初始化用的 markdown。 */
async function openFence(index: number, total = 2): Promise<string> {
  await waitFor(() => {
    const buttons = screen.getAllByTestId("chat-canvas-maximize");
    expect(buttons).toHaveLength(total);
    expect(buttons[index]).toBeEnabled();
  });
  fireEvent.click(screen.getAllByTestId("chat-canvas-maximize")[index]!);
  await screen.findByTestId("chat-canvas-modal");
  const probe = await screen.findByTestId("canvas-stage-probe");
  return probe.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetFenceTemplateCache();
  listCanvasTemplates.mockResolvedValue({ templates: [] });
  markdownToCanvas.mockResolvedValue({ model: null });
  getThreadArtifactSource.mockResolvedValue({
    markdown: FIRST_SAVED, version: null, savedAt: "2026-09-21T01:00:00.000Z", savedBy: "u1",
  });
});

describe("同一消息内两个同模板画布：保存版不互相认领（#3252）", () => {
  it("带围栏身份的保存版：第一个围栏读回自己的，第二个拿到的是自己的原文", async () => {
    listThreadArtifacts.mockResolvedValue({
      items: [artifact({
        title: tagCanvasArtifactTitle(
          "工作坊画布 · 2026/9/21 10:00:00",
          canvasFenceIdentity(FENCE_FIRST, "canvas"),
        ),
      })],
    });

    renderMessage();

    // ① 第一个围栏：保存版是它自己的，必须读回来。
    const first = await openFence(0);
    expect(first).toContain("新便签");
    expect(first).toContain("林可之一");

    fireEvent.click(screen.getByTestId("chat-canvas-close"));
    await waitFor(() => expect(screen.queryByTestId("chat-canvas-modal")).toBeNull());

    // ② 第二个围栏从头到尾没被碰过——它必须看到自己的原文，而不是第一个的保存字节。
    const second = await openFence(1);
    expect(second, "第二个围栏必须用自己的原文初始化").toContain("林可之二");
    expect(
      second,
      "出现第一个围栏的表头字段值 = 两个同模板画布互相认领了保存版（#3252）",
    ).not.toContain("林可之一");
    expect(second, "第一个围栏编辑出来的便签绝不该出现在第二个围栏里").not.toContain("新便签");
  });

  it("旧存量保存版（标题里没有围栏身份）：两个同模板围栏都不认领，各自退回原文", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [artifact({})] });

    renderMessage();

    const first = await openFence(0);
    expect(first).toContain("林可之一");
    expect(first, "归属无从判断时不猜——退回围栏原文，而不是挑一个给它").not.toContain("新便签");
  });

  it("保存时把围栏身份写进落地标题（下一次读回靠它分辨围栏）", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [] });
    landAsArtifact.mockResolvedValue({ artifactId: "a-new" });

    renderMessage();
    await openFence(1);
    fireEvent.click(screen.getByTestId("chat-canvas-save"));

    await waitFor(() => expect(landAsArtifact).toHaveBeenCalledTimes(1));
    const [, payload] = landAsArtifact.mock.calls[0]!;
    expect(payload.messageId).toBe("m-1");
    expect(payload.title).toBe(tagCanvasArtifactTitle(
      payload.title.replace(/\s·\s围栏\s[0-9a-f]{8}$/, ""),
      canvasFenceIdentity(FENCE_SECOND, "canvas"),
    ));
    // 身份算自**第二个**围栏的原文，不是第一个的（两者同模板，只有身份分得开）。
    expect(payload.title).not.toContain(canvasFenceIdentity(FENCE_FIRST, "canvas"));
  });
});

describe("单个围栏的既有行为不变（修复不许把老用户的保存版读丢）", () => {
  it("一条消息只有一个围栏时，没有围栏身份的旧存量照样读回来", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [artifact({})] });

    render(
      <MarkdownMessage
        text={["```canvas", FENCE_FIRST, "```"].join("\n")}
        threadId="t" messageId="m-1" bearer="b" projectId="p"
      />,
    );

    const initial = await openFence(0, 1);
    expect(initial).toContain("新便签");
  });
});
