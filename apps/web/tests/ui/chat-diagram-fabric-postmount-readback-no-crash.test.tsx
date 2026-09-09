/**
 * 回归测试（devapp 真实崩溃，2026-08-22，人类实测报告 + 截图 + console 原文）：
 *
 * 访问 `/chat?thread=thr-2608c5aa-...` 时浏览器 console 报
 * `NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is
 * not a child of this node.`，页面渲染崩溃。定位到根因是 issue #1668（挂载即读回，
 * `fetchLatestSavedDiagramSource` 从「只在点最大化时查」改成「挂载滚入视口即自动
 * 查一次」）与 `ChatDiagramFabric`/`ChatCanvasFabric` 自己文件头注释里记录的既有
 * 已知 fabric DOM 包裹节点风险叠加出的真实回归：
 *
 * · 只读预览挂载、校验通过、fabric 已经把 `<canvas>` 包进它自己造的
 *   `.canvas-container` 包裹 div 之后（`status.phase === "valid"`），挂载即读回
 *   那条 effect 异步把 `savedSource` 换成保存版，`previewCode` 随之改变。
 * · 阶段一（校验）effect 依赖 `previewCode`，重新触发校验，但 `status` 在异步校验
 *   完成前**原地保持 "valid"**——阶段二（建 fabric canvas）effect 同样依赖
 *   `previewCode`，立刻在**尚未校验的新内容**上 dispose 旧 canvas、在同一个
 *   `<canvas>` DOM 节点上重建一个新的 FabricCanvas。
 * · 若这次重新校验的新内容后续判定失败（语法错误/白名单落榜/画布模板解析失败），
 *   `status` 会从 "valid" 直接跳到 "error"——JSX 从「挂了 fabric canvas 的那棵子树」
 *   整个换成诚实错误态的那棵子树，React 卸载前者时撞上 fabric 自己塞进去、
 *   React 从未追踪过的包裹节点，抛 `removeChild ... not a child of this node`，
 *   整页崩塌。
 *
 * ── 为什么这里手搭一个「假 FabricCanvas」而不是像别的测试那样把它换成空操作 stub ──
 * 已有的 `chat-fabric-auto-readback-on-mount.test.tsx`/`chat-fabric-preview-syncs-
 * after-save.test.tsx` 都把 `fabric.Canvas` 换成完全不碰 DOM 的空操作类——这两条
 * 测试因此测不到本文件要盯住的这个真事故（它们自己的文件头注释也承认：真实 fabric
 * 在 jsdom 下会撞同一个 `removeChild`，但归因成"jsdom 专属时序问题、真浏览器里
 * fabric 的 DOM 管理是稳的"而绕过，未在生产代码里修——这次 devapp 实测证明真
 * 浏览器同样会崩，那个归因是错的）。real `fabric` 包在 jsdom 下连首次挂载都完不成
 * （jsdom 没有真实 2D canvas 上下文，`markdownToCanvas` 的渲染 promise 永远不 resolve
 * 到「就绪」），没法在组件测试里直接拿真实 fabric 当反证素材。
 *
 * 折中：这里的 `FakeWrappingCanvas` 忠实复刻 fabric 7.4 在 `CanvasDOMManager`
 * 构造函数/`cleanupDOM` 里对 DOM 做的**真实操作**（把传入的 `<canvas>` 包进一个
 * `container` div、塞入一个 `upper-canvas` 兄弟节点；`dispose()` 同步做相反的拆包
 * 还原），源码见 `fabric/src/canvas/DOMManagers/CanvasDOMManager.ts` 的
 * `constructor`/`cleanupDOM`。这样既不依赖 jsdom 的 2D canvas 支持，又忠实复现了
 * 「React 不知道的 DOM 包裹节点」这个真正会撞 `removeChild` 的机制——测的是这个
 * 机制在 previewCode 挂载后再变化一次时会不会被正确处理，不是「fabric 画对了没」。
 *
 * 反证纪律：stash 掉 `chat-diagram-fabric.tsx` 里 `key={previewCode}` + 显式
 * `setStatus({ phase: "validating" })` 两处改动后，这条用例应当真的抛出同样的
 * `removeChild` 错误（已人工验证：见 PR 描述里贴的 stash 前后对比）。
 */
import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";

const { listThreadArtifacts, getThreadArtifactSource } = vi.hoisted(() => ({
  listThreadArtifacts: vi.fn(),
  getThreadArtifactSource: vi.fn(),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listThreadArtifacts,
  getThreadArtifactSource,
}));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org-1" } }),
}));

vi.mock("@repo/fabric-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/fabric-markdown")>();
  return { ...actual, markdownToCanvas: vi.fn().mockResolvedValue({ model: null }), fitToContent: vi.fn() };
});

// 忠实复刻 fabric 7.4 `CanvasDOMManager` 对 DOM 做的真实操作（见文件头注释），不是
// 一个完全不碰 DOM 的空操作 stub——这样才测得到「React 不知道的包裹节点」这个机制。
vi.mock("fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fabric")>();
  class FakeWrappingCanvas {
    private readonly lowerEl: HTMLCanvasElement;
    private readonly upperEl: HTMLCanvasElement;
    private readonly containerEl: HTMLDivElement;
    private disposed = false;

    constructor(el: HTMLCanvasElement) {
      this.lowerEl = el;
      this.upperEl = document.createElement("canvas");
      this.upperEl.className = "upper-canvas";
      this.containerEl = document.createElement("div");
      this.containerEl.setAttribute("data-fabric", "wrapper");
      const parent = el.parentNode;
      if (parent) parent.replaceChild(this.containerEl, el);
      this.containerEl.append(el, this.upperEl);
    }

    forEachObject(): void {}
    requestRenderAll(): void {}

    // 同 fabric 真实的 `dispose()`：同步拆包还原 DOM（`cleanupDOM` 那部分），
    // 异步部分（`destroy()`）与本文件无关，省略。
    dispose(): Promise<boolean> {
      if (this.disposed) return Promise.resolve(false);
      this.disposed = true;
      this.containerEl.removeChild(this.upperEl);
      this.containerEl.removeChild(this.lowerEl);
      const parent = this.containerEl.parentNode;
      if (parent) parent.replaceChild(this.lowerEl, this.containerEl);
      return Promise.resolve(true);
    }
  }
  return { ...actual, Canvas: FakeWrappingCanvas };
});

const mermaidParse = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: (...args: unknown[]) => mermaidParse(...args),
    render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }),
  },
}));

const item = (over: Record<string, unknown>) => ({
  artifactId: "a-new", title: "t", mode: "draft", version: null,
  pinnedBy: null, pinnedAt: null, hasSource: false, messageId: "m-1", ...over,
});

describe("挂载即读回换来一份校验失败的保存版——只读预览不得崩页（devapp 实测回归）", () => {
  let onErrorSpy: ReturnType<typeof vi.fn>;
  let originalOnError: OnErrorEventHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mermaidParse.mockResolvedValue(true);
    onErrorSpy = vi.fn();
    originalOnError = window.onerror;
    window.onerror = (...args) => {
      onErrorSpy(...args);
      return true;
    };
  });

  afterEach(() => {
    window.onerror = originalOnError;
    cleanup();
  });

  it("ChatDiagramFabric：保存版 mermaid 语法有误 —— 不抛 removeChild，诚实转错误态", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [item({})] });
    getThreadArtifactSource.mockResolvedValue({
      markdown: "flowchart TD\n  a-->保存版新节点",
      version: null,
      savedAt: "2026-08-22T01:00:00.000Z",
      savedBy: "u1",
    });
    // 挂载即读回（issue #1668）的 mock 网络请求在 jsdom 下解析得比一次真实网络
    // 往返快得多——不特意等「先按原始内容挂好」这一步（那一步在真实浏览器里
    // 通常有意义的时间窗口，在这里可能被读回的 microtask 抢先），只让**这次
    // 读回换进来的新内容**校验失败（不管它是在 canvas 建好之前还是之后换进来，
    // 两条时序都要走到这里不崩）——这本身就是比人为固定时序更强的反证：无论
    // 竞态先后如何洗牌，都不能崩。
    mermaidParse.mockImplementation((code: string) =>
      code.includes("保存版新节点") ? Promise.reject(new Error("语法错误（探针）")) : Promise.resolve(true),
    );

    const { ChatDiagramFabric } = await import("@/components/chat/chat-diagram-fabric");
    const { container } = render(
      <ChatDiagramFabric
        code={"flowchart TD\n  a-->b"}
        threadId="t" messageId="m-1" bearer="b" projectId="p"
      />,
    );

    // 关键断言：previewCode 换成保存版、重新校验失败、界面转诚实错误态的
    // 全过程不能抛 `removeChild`，也不能被 `window.onerror` 抓到任何未捕获异常。
    await waitFor(
      () => expect(container.querySelector('[data-testid="chat-ai-mermaid-error"]')).toBeTruthy(),
      { timeout: 3000 },
    );

    expect(onErrorSpy).not.toHaveBeenCalled();
  });

  /**
   * issue #3230 —— 这条用例原本把**缺陷写成了期望值**：它喂一份「不是合法工作坊画布
   * 围栏正文」的保存版，然后断言这个围栏**应该**被它顶替、转成 `chat-canvas-error`。
   * 但那份 markdown 根本过不了本围栏的 `accepts` 身份判定——它属于别人（最常见来源是
   * 「落地为产物（草稿）」把整条消息正文落成一条 artifact）。让它顶替，正是人类实测
   * 「刷新后 10 个画布先出现、随后突然消失」的机制本身。
   *
   * 现在拆成两条，各测各的：
   *  ① 不属于本围栏的保存版 ⇒ 一律忽略，原始画布**保持渲染**（#3230 的组件级反证）。
   *  ② 属于本围栏的保存版 ⇒ 照常挂载后换源、整棵安全重挂，不抛 removeChild
   *     （本文件原本要盯住的 fabric 包裹节点机制，逐字保留）。
   * mermaid 那条（D.）不传 `accepts`，「保存版校验失败 ⇒ 转错误态」的崩溃路径仍由它覆盖。
   */
  it("ChatCanvasFabric：保存版不属于本围栏 ⇒ 忽略，原始画布保持渲染（#3230）", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [item({})] });
    getThreadArtifactSource.mockResolvedValue({
      markdown: "以上 10 个战略推演画布均可直接在前端渲染为协作画布。",
      version: null,
      savedAt: "2026-09-09T01:00:00.000Z",
      savedBy: "u1",
    });

    const ORIGINAL_BODY = ["模板: persona", "姓名: 林可", "## 用户描述", "- 项目型采购"].join("\n");
    const { ChatCanvasFabric } = await import("@/components/chat/chat-canvas-fabric");
    const { container } = render(
      <ChatCanvasFabric
        code={ORIGINAL_BODY} lang="canvas"
        threadId="t" messageId="m-1" bearer="b" projectId="p"
      />,
    );

    await waitFor(
      () => expect(container.querySelector('[data-testid="chat-canvas-fabric-surface"]')).toBeTruthy(),
      { timeout: 3000 },
    );
    // 读回请求已经发过并被判否——再等一拍，确认它不会把已经画好的画布换掉。
    await waitFor(() => expect(getThreadArtifactSource).toHaveBeenCalled(), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.querySelector('[data-testid="chat-canvas-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-canvas-fabric-surface"]')).toBeTruthy();
    expect(onErrorSpy).not.toHaveBeenCalled();
  });

  it("ChatCanvasFabric：保存版属于本围栏 ⇒ 挂载后换源整棵安全重挂，不抛 removeChild", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [item({})] });
    getThreadArtifactSource.mockResolvedValue({
      markdown: ["模板: persona", "姓名: 林可", "## 用户描述", "- 保存版改过的描述"].join("\n"),
      version: null,
      savedAt: "2026-08-22T01:00:00.000Z",
      savedBy: "u1",
    });

    const ORIGINAL_BODY = ["模板: persona", "姓名: 林可", "## 用户描述", "- 项目型采购"].join("\n");
    const { ChatCanvasFabric } = await import("@/components/chat/chat-canvas-fabric");
    const { container } = render(
      <ChatCanvasFabric
        code={ORIGINAL_BODY} lang="canvas"
        threadId="t" messageId="m-1" bearer="b" projectId="p"
      />,
    );

    await waitFor(() => expect(getThreadArtifactSource).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(
      () => expect(container.querySelector('[data-testid="chat-canvas-fabric-surface"]')).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(onErrorSpy).not.toHaveBeenCalled();
  });
});
