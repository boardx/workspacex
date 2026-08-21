"use client";
import * as React from "react";
import { Maximize2 } from "lucide-react";
import { Canvas as FabricCanvas } from "fabric";
import {
  markdownToCanvas,
  fitToContent,
  wrapAsMermaidBlock,
} from "@repo/fabric-markdown";
import { resolveDiagramType } from "@/lib/mermaid-diagram-type";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatDiagramCanvasModal, type DiagramSavedSource } from "./chat-diagram-canvas-modal";
import { fetchLatestSavedDiagramSource } from "@/lib/chat/diagram-readback";

/**
 * 单个 ```mermaid 围栏在 AI 气泡内的 **fabric 渲染**（VZ-02，替换 VZ-01 的静态 SVG）。
 *
 * 用户诉求（devapp 实测）：「渲染的这个图，必须要可以最大化，必须是使用 fabricjs
 * 渲染的，修改渲染以后的内容可以保存下来。参考 packages/fabric-markdown。」
 *
 * ── 状态机：validating → (valid | error)，**先判后挂** ────────────────────────
 * 关键架构约束：fabric 会把 `<canvas>` 元素包进它自己造的 `.canvas-container` div
 * 并加一层 upper-canvas 兄弟节点。**这些 DOM 节点不是 React 建的**。若我们先挂
 * canvas、渲染后才发现语法错、再把 canvas 卸载换成错误框，React 的 reconciler 会
 * 撞上 fabric 塞进来的包裹节点，抛 `removeChild ... not a child of this node`，
 * **整页崩塌**（实测：scene=error 时 xychart 的错误框也一起消失）。
 * 因此：**先**做白名单 + `mermaid.parse` 校验（此阶段不挂任何 canvas），只有
 * 校验通过（status==="valid"）才把 `<canvas>` 挂进 DOM 并交给 fabric。错误内容
 * 从头到尾不碰 fabric → 不会有 fabric 包裹节点 → 不会崩。
 *
 * 三条出口（沿用 VZ-01 诚实契约，无静默丢弃、无崩溃、绝不留破损/空白画布）：
 * · 图类型**不在**白名单 → 错误态（不支持的图类型 + 原始围栏源）。
 * · 在白名单但 `mermaid.parse` 抛错（语法错误）→ 错误态（语法错误 + 原始围栏源）。
 * · 白名单内且 parse 通过 → 挂 canvas，`markdownToCanvas` 渲成**只读** fabric 图，
 *   `fitToContent` 适配气泡尺寸。
 *
 * 「最大化」→ 打开可编辑全屏 `ChatDiagramCanvasModal`（复用 `CanvasStage`）。
 * 复用（不重写）：`markdownToCanvas` / `fitToContent` / `wrapAsMermaidBlock`。
 * 性能：每张图一张 fabric 画布是重对象 → 按「进入视口才校验+渲染」惰性化。
 *
 * ── 根因修复（issue #1668 引入的回归，devapp 实测崩溃，2026-08-22）───────────
 * #1668 之前，`previewCode`（真正喂给上面这套状态机的源）只在**首次挂载**时确定
 * 一次；之后只有用户手动「最大化→编辑→保存→关闭」才会变，而那条路径本就会先经过
 * modal 的独立保存校验，不太可能产出一份未经校验的坏内容。#1668 加了「挂载即
 * 读回」：previewCode 现在会在**组件已经挂了 fabric canvas 之后**（`status.phase
 * === "valid"`）被异步换成服务端保存版——如果这次读回来的保存版重新校验时判定
 * 失败（语法错误/白名单落榜），`status` 就会从 "valid" 直接跳到 "error"，
 * 而这一次 fabric **已经真的包过 DOM**——不再是上面「先判后挂」保证的
 * 「错误内容从头到尾不碰 fabric」。更棘手的是，即便只是把 `status` 暂时拨回
 * "validating"（不确定新内容有效与否）也一样会崩：JSX 三元表达式在**同一个**
 * 容器 div 里把 `<canvas>` 换成占位 loading div，这仍然是「同一个 DOM 位置，
 * 子节点从『fabric 已经改写过内部结构的 canvas』换成别的东西」——React 不知道
 * fabric 在里面动过手脚，试图 `removeChild` 时同样会撞上「不是这个节点的子节点」。
 *
 * 出口不是"让状态机永不离开 valid"（那样就没法诚实反映新内容的校验结果），而是
 * **让状态机的每一轮生命周期，只要曾经挂过 fabric canvas，就永远不在同一个 DOM
 * 位置上做「valid → 别的状态」这一步**。做法：把整套状态机（`status`/`ready`/
 * `canvasElRef`/`fabricRef` + 两条 effect + 两个分支的 JSX）搬进下面的
 * `DiagramCanvasBody` 子组件，由 `ChatDiagramFabric` 用 `key={previewCode}`
 * 渲染它——previewCode 一变，React 把**整个旧子组件实例连同它内部所有 DOM
 * （含 fabric 从未被 React 追踪过的包裹节点）一次性作为一棵子树摘除**（对它的
 * 父节点而言只是一次单一、干净的 `removeChild`，fabric 在这棵子树内部做了什么
 * 完全不影响这次摘除是否成功），再从头挂一个全新实例（全新 `canvasElRef` 指向
 * 的全新 `<canvas>` 节点，从未被 fabric 碰过）。新实例的 `status` 用
 * `useState` 初值重新从 "validating" 起步，不会有任何一刻在同一个 DOM 位置上
 * 把「已经 fabric 化的 canvas」换成别的东西。
 */
type Status =
  | { phase: "validating" }
  | { phase: "valid" }
  | { phase: "error"; reason: "whitelist" | "syntax"; detail: string };

export function ChatDiagramFabric({
  code, threadId, messageId, bearer, projectId,
}: {
  code: string;
  /** 「最大化」后真实持久化保存所需——三者俱全才接 `landAsArtifact`，见
   * `ChatDiagramCanvasModal` 文件头注释。原样透传，本组件不判断。 */
  threadId?: string;
  messageId?: string;
  bearer?: string;
  /**
   * G1 读回（design-delta chat-persona-roundtrip）所需：`listThreadArtifacts` /
   * `getThreadArtifactSource` 都要 projectId 判权。个人线程（无 projectId）维持
   * 现状本地行为，不做读回——缺省即关闭，与 threadId/messageId/bearer 同一态度。
   */
  projectId?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [inView, setInView] = React.useState(false);
  const [maximized, setMaximized] = React.useState(false);
  const [savedSource, setSavedSource] = React.useState<DiagramSavedSource | null>(null);
  const [openingReadback, setOpeningReadback] = React.useState(false);
  // 只读预览（气泡里那张小图）实际要画的源——优先用「这次会话里最新保存版」（无论
  // 是 G1 从服务端读回的，还是本地演示保存后 modal 关闭时带回来的），没有保存版
  // 才退回原始消息文本。此前恒用 `code`：保存/关闭全屏后气泡卡片纹丝不动就是因为
  // 这条预览渲染从没读过 `savedSource`（人类实测反馈）。
  const previewCode = savedSource?.markdown ?? code;

  /**
   * G1 读回（design-delta chat-persona-roundtrip，confirmed 2026-08-18）：点「最大化」
   * 先查该 (threadId, messageId) 是否有本人可见的保存版——有则取回最新一次的 markdown
   * 交给 modal 初始化（modal 里的提示条保证不静默替换）。查不到 / NOT_VISIBLE（他人
   * 草稿，签核：不提示存在性）/ 任何读回失败 ⇒ 与今天完全一致地用原始消息文本打开。
   *
   * `projectId` 不再是发不发请求的门（**2026-08-21 人类裁决反转**：个人线程
   * `projectId` 恒 undefined，但个人对话现在也真的能持久化——见 `PERSONAL_THREAD_
   * CAPABILITIES`）。`fetchLatestSavedDiagramSource` 接受 `projectId: string | null`，
   * 这里把 `undefined` 归一成 `null`，`resolveVisibility` 按 `null` 分派到个人线程
   * 判权分支（同 `land-as-artifact.ts` 同一条分派规则）。只有 threadId/messageId/
   * bearer 三者不全（预览页/流式草稿，本来就没有稳定身份可挂）才不发请求。
   */
  const openMaximized = React.useCallback(async () => {
    // 见下方「挂载即读回」effect：那条 effect 已经在 inView 时查过一次。这里仍然
    // 独立重查一遍（不是复用它的结果）——理由：openMaximized 可能在挂载 effect
    // 还没跑完（用户手快，图刚进入视口就点最大化）或者失败之后触发，modal 打开前
    // 必须有自己的一份确定性读回序列，不能依赖另一条 effect 的时序。轻微冗余（同一
    // 请求可能打两次）换取两条路径互不依赖，均在各自小节测试里钉死。
    if (openingReadback) return;
    if (!threadId || !messageId || bearer === undefined) {
      // 无鉴权预览 / 流式草稿：不发 G1 读回请求，但也**不**把 savedSource 清空——
      // 它可能是这次会话里刚关闭的本地演示保存（见下面 onClose），清空会让刚保存
      // 的编辑一重新打开全屏就凭空消失，比不读回还倒退。
      setMaximized(true);
      return;
    }
    setOpeningReadback(true);
    // 取数序列（list → 过滤 messageId → 最新 → source）与「失败静默退回原始版」
    // 都在 `fetchLatestSavedDiagramSource` 一处（组件级测试钉住那份逻辑）。
    const saved = await fetchLatestSavedDiagramSource({
      threadId, messageId, projectId: projectId ?? null, bearer,
    });
    setSavedSource(saved);
    setOpeningReadback(false);
    setMaximized(true);
  }, [openingReadback, threadId, messageId, projectId, bearer]);

  /**
   * 挂载即读回（design-delta chat-diagram-artifact-reference，issue #1668）：此前
   * G1 读回只挂在「点最大化」这一个触发点上——`savedSource` 在那之前恒为 `null`，
   * 只读小图（气泡里的预览）永远画 `code`（消息原文）。真机实测复现：编辑保存
   * → 关闭全屏 → **刷新页面** → 气泡预览回到编辑前的内容，因为刷新后组件重新挂载，
   * `savedSource` 又是 `null`，而用户这次没有再点一次「最大化」。
   *
   * 人类裁决（2026-08-21，issue #1668）：不回写消息 `text`（维持不可变），而是让
   * 只读预览也接上已经建好的引用解析（同一份 `fetchLatestSavedDiagramSource`，不
   * 新起端口）——图表挂载滚入视口时就查一次该消息名下最新的落地版本，命中则预览
   * 直接画保存版，未命中/无权限（I-36 静默）则保持原始消息文本，与今天行为一致。
   *
   * 只在 `savedSource` 还是 `null` 时查一次：已经有值（无论是这条 effect 自己查到
   * 的、还是 `openMaximized`/`onClose` 带回的）就不用再查——避免挂载查一次、用户
   * 又手动点最大化再查一次时把已经拿到的保存版覆盖回一次网络竞态。失败（网络错误/
   * 404 他人草稿）与 `openMaximized` 同一条降级：静默保持 `null`，画原始消息文本。
   *
   * ⚠ 这条 effect 是 previewCode 会在**首次挂载之后**发生变化的唯一来源
   * （`onClose` 带回保存结果是另一条，但那条路径本就先过 modal 自己的保存校验）。
   * 它带来的 DOM 崩溃风险由下面 `DiagramCanvasBody` 的 `key={previewCode}`
   * 承接，见本文件头部大注释。
   */
  React.useEffect(() => {
    if (!inView) return;
    if (savedSource !== null) return;
    if (!threadId || !messageId || bearer === undefined) return;
    let cancelled = false;
    void (async () => {
      const saved = await fetchLatestSavedDiagramSource({
        threadId, messageId, projectId: projectId ?? null, bearer,
      });
      if (!cancelled && saved !== null) setSavedSource(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, [inView, savedSource, threadId, messageId, projectId, bearer]);

  // 惰性化：进入视口才校验+渲染（性能——一张图一张 fabric 画布）。停在 outer：
  // `previewCode` 变化触发的重挂载只发生在**已经进过视口一次之后**（读回本身就要
  // `inView` 才会发起），这条 observer 不需要跟着 `DiagramCanvasBody` 一起重来。
  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <DiagramCanvasBody
        key={previewCode}
        previewCode={previewCode}
        inView={inView}
        containerRef={containerRef}
        openMaximized={openMaximized}
        openingReadback={openingReadback}
      />

      {maximized && (
        <ChatDiagramCanvasModal
          code={code}
          onClose={(result) => {
            // 关闭时如果带回了保存结果（真实落库或本地演示皆算），更新 previewCode
            // 的源——这样退出全屏后气泡里的只读预览立刻跟着变，不用等重新拉整个
            // 消息列表（这条链路目前也不会真的把编辑写回 chat_messages，见调用方
            // 文件头「G1 读回」注释）。
            if (result) setSavedSource({ markdown: result.markdown, savedAt: new Date().toISOString() });
            setMaximized(false);
          }}
          threadId={threadId}
          messageId={messageId}
          bearer={bearer}
          savedSource={savedSource}
        />
      )}
    </>
  );
}

/**
 * 只读预览的状态机本体（validating → valid | error）+ fabric canvas 挂载/卸载。
 * 由 `ChatDiagramFabric` 用 `key={previewCode}` 渲染——previewCode 变化时整个
 * 组件实例连同其内部 DOM（含 fabric 未经 React 追踪的包裹节点）一起被摘除重挂，
 * 状态机永远从干净的 "validating" 起步，不会在同一个 DOM 位置上把已经 fabric
 * 化的 canvas 换成别的东西。见 `ChatDiagramFabric` 文件头大注释。
 */
function DiagramCanvasBody({
  previewCode, inView, containerRef, openMaximized, openingReadback,
}: {
  previewCode: string;
  inView: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  openMaximized: () => void;
  openingReadback: boolean;
}) {
  const canvasElRef = React.useRef<HTMLCanvasElement>(null);
  const fabricRef = React.useRef<FabricCanvas | null>(null);
  const [status, setStatus] = React.useState<Status>({ phase: "validating" });
  const [ready, setReady] = React.useState(false);
  const { rawToken, inWhitelist } = React.useMemo(() => resolveDiagramType(previewCode), [previewCode]);

  // 阶段一：校验（**不挂 canvas**）。白名单闸门 + mermaid.parse 语法闸门（与 VZ-01 一致）。
  // `previewCode` 在这个组件实例的生命周期内不会变（变化即换 key、换实例），这里
  // 依赖它只是保持一般 React 卫生习惯，不代表期待它在本实例内被重新触发。
  React.useEffect(() => {
    if (!inView) return;
    if (!inWhitelist) {
      setStatus({ phase: "error", reason: "whitelist", detail: rawToken || "（空）" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        // parse 先行：fabric 的 mermaidToModel 比 mermaid.parse 宽容，会把残缺围栏
        // 解析成「部分模型」而不抛错。若直接喂给 fabric，语法错的图会渲成半截/空白
        // 画布，违背「诚实错误态」。故让 fabric **只**看到已过 parse 的合法源。
        await mermaid.parse(previewCode);
        if (!cancelled) setStatus({ phase: "valid" });
      } catch (e) {
        if (!cancelled)
          setStatus({
            phase: "error",
            reason: "syntax",
            detail: e instanceof Error ? e.message : String(e),
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewCode, inWhitelist, rawToken, inView]);

  // 阶段二：仅当 valid（<canvas> 已挂）时建 FabricCanvas 并渲染（只读）。
  React.useEffect(() => {
    if (status.phase !== "valid") return;
    const el = canvasElRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const width = Math.max(320, Math.floor(container.getBoundingClientRect().width) - 2);
    const canvas = new FabricCanvas(el, {
      width,
      height: 320,
      selection: false,
      skipTargetFind: true,
    });
    fabricRef.current = canvas;
    let cancelled = false;
    markdownToCanvas(wrapAsMermaidBlock(previewCode), canvas)
      .then(() => {
        if (cancelled) return;
        canvas.forEachObject((obj) => {
          obj.selectable = false;
          obj.evented = false;
        });
        fitToContent(canvas, { padding: 24 });
        canvas.requestRenderAll();
        setReady(true);
      })
      .catch(() => {
        // parse 已通过却仍渲染失败：不切错误框（避免卸载 fabric 包裹节点崩页），
        // 仅保持画布容器、标记未就绪。parse 通过后理论上不该到这里。
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
      canvas.dispose();
      fabricRef.current = null;
    };
    // 本组件实例内 previewCode 恒定不变（见组件头注释），status.phase 是这条
    // effect 唯一真正会变化的依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.phase, previewCode]);

  if (status.phase === "error") {
    // VZ-01 诚实错误态：testid / 结构 / 文案与 VZ-01 一致。此分支从未挂过 fabric canvas。
    return (
      <div
        data-testid="chat-ai-mermaid-error"
        data-error-reason={status.reason}
        className="my-2 overflow-hidden rounded-md border border-destructive/40 bg-destructive/5"
      >
        <div className="flex items-center gap-1.5 border-b border-destructive/30 px-2.5 py-1.5 text-11 font-medium text-destructive">
          无法渲染此图（
          {status.reason === "whitelist" ? `不支持的图类型：${status.detail}` : "语法错误"}）
        </div>
        <pre className="overflow-x-auto px-2.5 py-2 font-mono text-11 leading-relaxed text-muted-foreground">
          <code>{previewCode}</code>
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="chat-diagram-fabric"
      data-diagram-type={rawToken}
      data-ready={ready}
      className="group relative my-2 overflow-hidden rounded-md border border-border-subtle bg-card"
    >
      <div className="pointer-events-none absolute left-2 top-2 z-10">
        <Badge tone="outline">fabric 渲染 · 只读预览</Badge>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void openMaximized()}
        data-testid="chat-diagram-maximize"
        className="absolute right-2 top-2 z-10"
        aria-label="最大化并编辑此图"
        disabled={status.phase !== "valid" || openingReadback}
      >
        <Maximize2 aria-hidden className="h-3.5 w-3.5" />
        {openingReadback ? "读取保存版…" : "最大化"}
      </Button>

      {/* <canvas> 只有校验通过（valid）才挂——错误内容永不触碰 fabric（见文件头注释）。 */}
      {status.phase === "valid" ? (
        <canvas ref={canvasElRef} data-testid="chat-diagram-fabric-surface" />
      ) : (
        <div
          data-testid="chat-diagram-loading"
          className="flex h-40 items-center justify-center text-11 text-muted-foreground"
        >
          {inView ? "校验并渲染图中…" : "滚动到此处即渲染"}
        </div>
      )}
      {status.phase === "valid" && !ready && (
        <div
          data-testid="chat-diagram-loading"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-11 text-muted-foreground"
        >
          渲染图中…
        </div>
      )}
    </div>
  );
}
