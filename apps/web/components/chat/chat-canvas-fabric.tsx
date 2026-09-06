"use client";
import * as React from "react";
import { Maximize2 } from "lucide-react";
import { Canvas as FabricCanvas } from "fabric";
import { markdownToCanvas, fitToContent, wrapAsMermaidBlock, getTemplate } from "@repo/fabric-markdown";
import { checkCanvasFence, type CanvasFenceLang } from "@/lib/canvas/canvas-fence";
import { ensureCanvasFenceTemplate, type CanvasFenceTemplateSource } from "@/lib/canvas/fence-template-resolver";
import { capFenceBulletsToCapacity, sectionRenderCapacities } from "@/lib/canvas/cap-fence-bullets";
import { useOptionalSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatCanvasModal } from "./chat-canvas-modal";
import { fetchLatestSavedDiagramSource } from "@/lib/chat/diagram-readback";

/**
 * 单个 ```canvas / ```persona 围栏在 AI 气泡内的 **fabric 渲染**。
 *
 * ── 先分清两套东西（人类 2026-08-18 明确澄清）─────────────────────────────────
 * · **mermaid 图表**（flowchart / 类图 / 状态图 / 时序图 / mindmap / gantt … 13 种）：
 *   标准图表类型，一次性画出来给人看的**示意图**，没有分区、不能贴便签。
 *   它们走 `ChatDiagramFabric`，闸门是 `MermaidDiagramType` 白名单 + `mermaid.parse`。
 * · **工作坊画布模板**（用户画像 / 用户旅程图 / 同理心地图 / 商业模式画布 …，
 *   内置 19 个 + 组织自建）：**便签协作模板** —— 分区框 + 可贴便签 + 多人一起贴。
 *   它们走本组件，闸门是 `checkCanvasFence` + `ensureCanvasFenceTemplate`。
 *
 * 两套系统**完全独立**：没有共用的类型判断、没有共用的校验函数、没有一条
 * 既判 mermaid 类型又判画布模板 key 的分支链。本文件里出现的「画布」一律指后者，
 * 不要读成 mermaid 图表。
 *
 * 在此之前 `markdown-message.tsx` 用 `.filter(b => b.lang === "mermaid")` 把这两种围栏
 * **主动丢掉**，于是它们落回 ReactMarkdown 渲成一块灰底代码块 —— 后台辛苦建的工作坊
 * 画布模板在 chat 里一次都没被用上。本组件是那条链路的最后一段。
 *
 * ── 为什么不复用 `ChatDiagramFabric` ────────────────────────────────────────
 * 它的两道闸门都是 mermaid 专用：`resolveDiagramType` 的 12 型白名单、`mermaid.parse`。
 * 工作坊画布围栏喂进去必然判失败（它压根不是 mermaid 语法）。所以这里**另起一个
 * 独立校验器**（`checkCanvasFence` + `ensureCanvasFenceTemplate`），但**沿用同一条纪律**：
 *
 * ⚠ **先判后挂**：fabric 会把 `<canvas>` 包进它自己造的 `.canvas-container` div。
 *   若先挂 canvas、渲染失败再换成错误框，React 的 reconciler 会撞上 fabric 塞进来的
 *   包裹节点抛 `removeChild ... not a child of this node`，**整页崩塌**（这是
 *   `chat-diagram-fabric.tsx` 注释里记录的实测事故）。因此错误内容从头到尾不碰 fabric。
 *
 * ── 状态机 ────────────────────────────────────────────────────────────────
 * validating → resolving（拉组织模板）→ valid | error。
 * 失败态**沿用** `chat-ai-mermaid-error` 那套视觉形状（原因 + 原始围栏源码），
 * 因为对用户而言「这块渲不出来」是同一件事，没必要在同一条消息里有两种错误框长相。
 * 但 **testid 是独立的 `chat-canvas-error`** —— 工作坊画布模板不是 mermaid 图表，
 * 让断言、埋点、e2e 选择器共用一个叫「mermaid-error」的钩子，等于在最容易被
 * 复制粘贴的地方把两套系统混读。形状可以共用，身份不行。
 *
 * ── 个人对话 ──────────────────────────────────────────────────────────────
 * 本路径**不读 `projectId`**，也不依赖 `artifact.land` 能力位（那是「保存产物」才需要的）。
 * 组织模板只需要会话里的 `currentOrgId`，个人对话跑在个人组织里，一样有。
 *
 * ── 「最大化」按钮（人类 2026-08-19 推翻此前判断，要求补上）──────────────────
 * 此前的判断是「宁可暂时没有这个入口，也不给一枚会静默损坏用户内容的按钮」——
 * 因为 `ChatDiagramCanvasModal` 是 mermaid 专用的，直接复用会保存出 lang 错、
 * 内容被 mermaid 序列化器改写过的源。现在补的不是"直接复用那个 modal"，是一个
 * 独立的 `ChatCanvasModal`（同一个 `CanvasStage` 编辑器，换了三处：入参带 lang、
 * 保存时按 `isCanvasFenceLang` 过滤、工具条只留选择/＋便签/删除），细节见该文件
 * 文件头注释。G1 读回（`fetchLatestSavedDiagramSource`）与围栏语言无关，直接复用
 * mermaid 路径同一份逻辑。
 *
 * ── 流式中间态不判定格式（issue #2298，2026-08-28）───────────────────────────
 * 真实截图证据：`模板「ch」的围栏里没有任何「## 分区」标题` 这个终态红色报错，
 * 出现在同一条消息的「正在生成…」chip **仍在显示**的时候——`模板「ch」` 正是
 * 模板 key `chat-read-e2e-canvas` 流到第二个字符时的截断值。根因是
 * `checkCanvasFence` 把「围栏还没写完」和「围栏写完了但格式真的错」两件事
 * 当成同一件事：`markdownToCanvas`/`extractMermaidBlocks` 对未闭合围栏返回
 * 「到文档结尾为止」的半截 `code`，而本组件此前对这段半截内容照样立刻起跑
 * 校验，必然经历「没有模板 key」「有 key 但没有分区标题」这些中间态，每一个
 * 都被判成终态错误。
 * 修法：`extractMermaidBlocks` 现在吐出 `closed: boolean`（围栏是否真的闭合），
 * `markdown-message.tsx` 原样透传给本组件的 `closed` prop。`closed === false`
 * 时校验 effect 整个跳过，状态机停在 "validating"（渲成「解析工作坊画布模板
 * 中…」loading 态，不进错误分支）——直到围栏闭合（`closed` 变 true，因为
 * `previewCode` 也变了，`key={previewCode}` 使实例整个重挂，从干净的
 * "validating" 重新起跑）才真正跑 `checkCanvasFence`。围栏闭合后格式确实有
 * 误，报错逻辑原样保留，不受影响。
 *
 * ── 根因修复（issue #1668 引入的回归，与 `ChatDiagramFabric` 同款，同一次 devapp
 * 崩溃排查，2026-08-22）──────────────────────────────────────────────────────
 * 挂载即读回把 `previewCode` 换成保存版这一步，如果发生在「已经挂了 fabric
 * canvas」之后（`status.phase === "valid"`），而新内容重新校验又失败，`status`
 * 会从 "valid" 跳到别的状态——这一次 fabric 已经真的包过 DOM，React 卸载/替换
 * 这棵子树时会撞上它塞进去的包裹节点崩页。修法与 `ChatDiagramFabric` 逐字对称：
 * 把整套状态机搬进 `CanvasFabricBody` 子组件，由外层用 `key={previewCode}` 渲染——
 * previewCode 一变就整个子组件实例连同内部 DOM 一起摘除重挂，状态机永远从干净的
 * "validating" 起步。完整推导见 `chat-diagram-fabric.tsx` 同名注释，不复述。
 */
type Status =
  | { phase: "validating" }
  | { phase: "valid"; source: CanvasFenceTemplateSource }
  | { phase: "error"; reason: "syntax" | "template" | "org" | "fetch"; detail: string };

const ERROR_TITLE: Record<Extract<Status, { phase: "error" }>["reason"], string> = {
  syntax: "围栏格式有误",
  template: "找不到这个工作坊画布模板",
  org: "还没有组织上下文",
  fetch: "读取组织的工作坊画布模板失败",
};

export function ChatCanvasFabric({
  code, lang, closed = true, threadId, messageId, bearer, projectId,
}: {
  code: string;
  lang: CanvasFenceLang;
  /**
   * 围栏是否已闭合（issue #2298）。`false` = 流式增量文本里这个围栏还没收到
   * 闭合 ``` ——`code` 是「到目前为止」的半截内容，不是作者的最终产出，校验
   * 必须整个跳过、停在加载态。默认 `true`（历史调用方/测试直传固定字符串，
   * 视为已完成的最终内容，行为与改动前一致）。
   */
  closed?: boolean;
  /** 「最大化」后真实持久化保存所需——三者俱全才接 `landAsArtifact`，见
   * `ChatCanvasModal` 文件头注释。原样透传，本组件不判断。 */
  threadId?: string;
  messageId?: string;
  bearer?: string;
  /** G1 读回判权用；个人线程（无 projectId）不发读回请求，见 `ChatDiagramFabric` 同款注释。 */
  projectId?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [inView, setInView] = React.useState(false);
  const [maximized, setMaximized] = React.useState(false);
  const [savedSource, setSavedSource] = React.useState<{ readonly markdown: string; readonly savedAt: string } | null>(null);
  const [openingReadback, setOpeningReadback] = React.useState(false);
  // 只读预览（气泡里那张小画布）实际要画的源——优先用「这次会话里最新保存版」（无论
  // 是 G1 从服务端读回的，还是本地演示保存后 modal 关闭时带回来的），没有保存版
  // 才退回原始消息文本。此前恒用 `code`：保存/关闭全屏后气泡卡片纹丝不动就是因为
  // 这条预览渲染从没读过 `savedSource`（人类实测反馈，同 `ChatDiagramFabric` 同款修法）。
  const previewCode = savedSource?.markdown ?? code;
  // `useOptionalSession`：组件可能被渲染在没有 SessionProvider 的上下文里（预览页、
  // 组件测试）。那时 orgId 为 null，内置模板照样渲染，组织模板给诚实错误态。
  const orgId = useOptionalSession()?.session?.currentOrgId ?? null;

  // G1 读回（同 `ChatDiagramFabric.openMaximized`）：点「最大化」先查本消息是否有
  // 保存版，有则用它初始化 modal；查不到/失败一律退回原始消息文本。`projectId`
  // 不是发不发请求的门（2026-08-21 人类裁决反转：个人线程 `projectId` 恒
  // undefined，但个人对话现在也真的能持久化+读回，见 `ChatDiagramFabric` 同名
  // 方法注释）——只有 threadId/messageId/bearer 三者不全才不发请求。
  const openMaximized = React.useCallback(async () => {
    if (openingReadback) return;
    if (!threadId || !messageId || bearer === undefined) {
      // 无鉴权预览 / 流式草稿：不发 G1 读回请求，但也**不**把 savedSource 清空——
      // 它可能是这次会话里刚关闭的本地演示保存（见下面 onClose），清空会让刚保存
      // 的编辑一重新打开全屏就凭空消失，比不读回还倒退。
      setMaximized(true);
      return;
    }
    setOpeningReadback(true);
    const saved = await fetchLatestSavedDiagramSource({
      threadId, messageId, projectId: projectId ?? null, bearer,
    });
    setSavedSource(saved);
    setOpeningReadback(false);
    setMaximized(true);
  }, [openingReadback, threadId, messageId, projectId, bearer]);

  // 挂载即读回（design-delta chat-diagram-artifact-reference，issue #1668）——与
  // `ChatDiagramFabric` 同款修法（该文件有完整背景注释，此处不复述）：图表消息
  // 挂载滚入视口时就查一次本消息名下最新的落地版本，命中则只读预览直接画保存版，
  // 不用再等用户点一次「最大化」才触发读回。工作坊画布模板与 mermaid 标准图表
  // 共享同一份 `fetchLatestSavedDiagramSource`，两处改动逐字对称。
  //
  // ⚠ 这条 effect 是 previewCode 会在**首次挂载之后**发生变化的唯一来源——它带来
  // 的 DOM 崩溃风险由下面 `CanvasFabricBody` 的 `key={previewCode}` 承接，见本
  // 文件头部大注释。
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

  // 惰性化：进入视口才校验+渲染（与 mermaid 那条同样的理由——一张画布一个 fabric 实例
  // 是重对象）。停在 outer：previewCode 变化触发的重挂载只发生在**已经进过视口一次
  // 之后**（读回本身就要 `inView` 才会发起），这条 observer 不需要跟着子组件重来。
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
      <CanvasFabricBody
        key={previewCode}
        previewCode={previewCode}
        lang={lang}
        orgId={orgId}
        inView={inView}
        // 有 `savedSource` 时 `previewCode` 已经是落库的最终内容（G1 读回或
        // modal 保存回填），恒当「已闭合」处理——`closed` 只描述**原始消息
        // 流式片段**是否收全，不适用于保存版。
        closed={savedSource !== null ? true : closed}
        containerRef={containerRef}
        openMaximized={openMaximized}
        openingReadback={openingReadback}
      />

      {maximized && (
        <ChatCanvasModal
          code={code}
          lang={lang}
          onClose={(result) => {
            // 关闭时如果带回了保存结果（真实落库或本地演示皆算），更新只读预览的
            // 渲染源——不然「保存」点了、「已保存」徽标也亮了，退出全屏后气泡卡片
            // 却纹丝不动（人类实测反馈，同 `ChatDiagramFabric` 同款修法）。
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
 * 只读预览的状态机本体（validating → resolving → valid | error）+ fabric canvas
 * 挂载/卸载。由 `ChatCanvasFabric` 用 `key={previewCode}` 渲染——previewCode 变化时
 * 整个组件实例连同内部 DOM 一起被摘除重挂。见 `ChatCanvasFabric`/`ChatDiagramFabric`
 * 文件头大注释。
 */
function CanvasFabricBody({
  previewCode, lang, orgId, inView, closed, containerRef, openMaximized, openingReadback,
}: {
  previewCode: string;
  lang: CanvasFenceLang;
  orgId: string | null;
  inView: boolean;
  /** 见 `ChatCanvasFabric` 同名 prop 注释（issue #2298）：`false` 时校验 effect 整个跳过。 */
  closed: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  openMaximized: () => void;
  openingReadback: boolean;
}) {
  const canvasElRef = React.useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = React.useState<Status>({ phase: "validating" });
  const [ready, setReady] = React.useState(false);

  // 阶段一：校验（**不挂 canvas**）。纯函数闸门 → 模板解析闸门（可能发一次 GET）。
  // `previewCode`/`lang`/`orgId` 在这个组件实例的生命周期内不会变（previewCode 变化
  // 即换 key、换实例）；`orgId` 理论上可能因为登录状态变化而变，沿用既有依赖数组。
  React.useEffect(() => {
    if (!inView) return;
    // 围栏还没闭合（issue #2298）：流式增量文本里的半截内容，不是作者的最终
    // 产出——跳过校验，状态机停在 "validating"（渲成加载态），不判定格式。
    if (!closed) return;
    const check = checkCanvasFence(previewCode, lang);
    if (!check.ok) {
      setStatus({ phase: "error", reason: "syntax", detail: check.detail });
      return;
    }
    let cancelled = false;
    void (async () => {
      const outcome = await ensureCanvasFenceTemplate({ key: check.key, orgId });
      if (cancelled) return;
      if (outcome.ok) {
        setStatus({ phase: "valid", source: outcome.source });
        return;
      }
      setStatus({
        phase: "error",
        reason: outcome.reason === "no-org" ? "org" : outcome.reason === "fetch-failed" ? "fetch" : "template",
        detail:
          outcome.reason === "not-found"
            ? `模板 key「${outcome.detail}」既不是内置模板，当前组织的模板库里也没有它。`
            : outcome.reason === "no-org"
              ? `模板「${outcome.detail}」不是内置模板，需要登录后才能读到组织的模板库。`
              : outcome.detail,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [previewCode, lang, orgId, inView, closed]);

  // 阶段二：仅当 valid（<canvas> 已挂）时建 FabricCanvas 并渲染（只读）。
  React.useEffect(() => {
    if (status.phase !== "valid") return;
    const el = canvasElRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const width = Math.max(320, Math.floor(container.getBoundingClientRect().width) - 2);
    const canvas = new FabricCanvas(el, { width, height: 360, selection: false, skipTargetFind: true });
    let cancelled = false;
    // issue #2564：模型实际产出的条数可能比某个分区的框实际放得下的多——vendor
    // 引擎（`template-engine.ts`）不裁剪，超出的便签会画进相邻分区（标题条/便签
    // 互相压住）。`status.phase === "valid"` 意味着阶段一的 `checkCanvasFence` 已经
    // 成功解析出 `key`（这里再解析一次是同一个纯函数、同一份 `previewCode`，不会
    // 失败）；渲染前用 `key` 对应的已注册 `spec` 算出每个分区的真实容量，截掉超出
    // 部分——见 `cap-fence-bullets.ts` 文件头，与 `template-simulate-dialog.tsx`
    // 「chat 模拟」共用同一份逻辑（两条路径此前就被要求「渲染引擎完全一致」）。
    const check = checkCanvasFence(previewCode, lang);
    const spec = check.ok ? getTemplate(check.key) : undefined;
    const cappedPreviewCode = spec
      ? capFenceBulletsToCapacity(previewCode, sectionRenderCapacities(spec))
      : previewCode;
    // 复用唯一入口 `markdownToCanvas`（它按围栏 lang 分派到 templateToModel），
    // 不在这里另写一份 templateToModel + renderToCanvas 的组合。
    markdownToCanvas(wrapAsMermaidBlock(cappedPreviewCode, lang), canvas)
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
        // 校验已过却仍渲染失败：不切错误框（避免卸载 fabric 包裹节点崩页），只标未就绪。
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
      canvas.dispose();
    };
    // 本组件实例内 previewCode/lang 恒定不变（见组件头注释），status.phase 是这条
    // effect 唯一真正会变化的依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.phase, previewCode, lang]);

  if (status.phase === "error") {
    // 诚实错误态：与 mermaid 那条同样的结构与文案节奏（「原因 + 原始源码」），
    // 但独立 testid（见文件头「状态机」一节）。
    return (
      <div
        data-testid="chat-canvas-error"
        data-error-reason={status.reason}
        data-fence-lang={lang}
        className="my-2 overflow-hidden rounded-md border border-destructive/40 bg-destructive/5"
      >
        <div className="flex items-center gap-1.5 border-b border-destructive/30 px-2.5 py-1.5 text-11 font-medium text-destructive">
          无法渲染此工作坊画布模板（{ERROR_TITLE[status.reason]}：{status.detail}）
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
      data-testid="chat-canvas-fabric"
      data-fence-lang={lang}
      data-template-source={status.phase === "valid" ? status.source : undefined}
      data-ready={ready}
      className="group relative my-2 overflow-hidden rounded-md border border-border-subtle bg-card"
    >
      {/* issue #2838：角标与「最大化」原先是 absolute 压在画布左上/右上角，而模板几何
          的标题条恰好画在顶部（`fitToContent` padding 24 后标题就落在角标底下），
          「价值主张宣言」等 title 被角标盖住。改成独立一行 header（普通文档流），
          画布内容区从 header 下方开始，不再与任何模板几何争位。 */}
      <div
        data-testid="chat-canvas-fabric-header"
        className="flex items-center justify-between gap-2 border-b border-border-subtle bg-card px-2 py-1.5"
      >
        <Badge tone="outline">工作坊画布模板 · 只读预览</Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void openMaximized()}
          data-testid="chat-canvas-maximize"
          className="shrink-0"
          aria-label="最大化并编辑此画布"
          disabled={status.phase !== "valid" || openingReadback}
        >
          <Maximize2 aria-hidden className="h-3.5 w-3.5" />
          {openingReadback ? "读取保存版…" : "最大化"}
        </Button>
      </div>

      <div data-testid="chat-canvas-fabric-body" className="relative">
        {/* <canvas> 只有校验通过（valid）才挂——错误内容永不触碰 fabric（见文件头注释）。 */}
        {status.phase === "valid" ? (
          <canvas ref={canvasElRef} data-testid="chat-canvas-fabric-surface" />
        ) : (
          <div
            data-testid="chat-canvas-loading"
            className="flex h-40 items-center justify-center text-11 text-muted-foreground"
          >
            {!inView ? "滚动到此处即渲染" : !closed ? "画布内容生成中…" : "解析工作坊画布模板中…"}
          </div>
        )}
        {status.phase === "valid" && !ready && (
          <div
            data-testid="chat-canvas-loading"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-11 text-muted-foreground"
          >
            渲染画布中…
          </div>
        )}
      </div>
    </div>
  );
}
