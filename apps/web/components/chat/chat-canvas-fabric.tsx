"use client";
import * as React from "react";
import { Maximize2 } from "lucide-react";
import { Canvas as FabricCanvas } from "fabric";
import { markdownToCanvas, fitToContent, wrapAsMermaidBlock } from "@repo/fabric-markdown";
import { checkCanvasFence, type CanvasFenceLang } from "@/lib/canvas/canvas-fence";
import { ensureCanvasFenceTemplate, type CanvasFenceTemplateSource } from "@/lib/canvas/fence-template-resolver";
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
  code, lang, threadId, messageId, bearer, projectId,
}: {
  code: string;
  lang: CanvasFenceLang;
  /** 「最大化」后真实持久化保存所需——三者俱全才接 `landAsArtifact`，见
   * `ChatCanvasModal` 文件头注释。原样透传，本组件不判断。 */
  threadId?: string;
  messageId?: string;
  bearer?: string;
  /** G1 读回判权用；个人线程（无 projectId）不发读回请求，见 `ChatDiagramFabric` 同款注释。 */
  projectId?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasElRef = React.useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = React.useState<Status>({ phase: "validating" });
  const [ready, setReady] = React.useState(false);
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

  // 惰性化：进入视口才校验+渲染（与 mermaid 那条同样的理由——一张画布一个 fabric 实例是重对象）。
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

  // 阶段一：校验（**不挂 canvas**）。纯函数闸门 → 模板解析闸门（可能发一次 GET）。
  React.useEffect(() => {
    if (!inView) return;
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
  }, [previewCode, lang, orgId, inView]);

  // 阶段二：仅当 valid（<canvas> 已挂）时建 FabricCanvas 并渲染（只读）。
  React.useEffect(() => {
    if (status.phase !== "valid") return;
    const el = canvasElRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const width = Math.max(320, Math.floor(container.getBoundingClientRect().width) - 2);
    const canvas = new FabricCanvas(el, { width, height: 360, selection: false, skipTargetFind: true });
    let cancelled = false;
    // 复用唯一入口 `markdownToCanvas`（它按围栏 lang 分派到 templateToModel），
    // 不在这里另写一份 templateToModel + renderToCanvas 的组合。
    markdownToCanvas(wrapAsMermaidBlock(previewCode, lang), canvas)
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
    <>
      <div
        ref={containerRef}
        data-testid="chat-canvas-fabric"
        data-fence-lang={lang}
        data-template-source={status.phase === "valid" ? status.source : undefined}
        data-ready={ready}
        className="group relative my-2 overflow-hidden rounded-md border border-border-subtle bg-card"
      >
        <div className="pointer-events-none absolute left-2 top-2 z-10">
          <Badge tone="outline">工作坊画布模板 · 只读预览</Badge>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void openMaximized()}
          data-testid="chat-canvas-maximize"
          className="absolute right-2 top-2 z-10"
          aria-label="最大化并编辑此画布"
          disabled={status.phase !== "valid" || openingReadback}
        >
          <Maximize2 aria-hidden className="h-3.5 w-3.5" />
          {openingReadback ? "读取保存版…" : "最大化"}
        </Button>

        {/* <canvas> 只有校验通过（valid）才挂——错误内容永不触碰 fabric（见文件头注释）。 */}
        {status.phase === "valid" ? (
          <canvas ref={canvasElRef} data-testid="chat-canvas-fabric-surface" />
        ) : (
          <div
            data-testid="chat-canvas-loading"
            className="flex h-40 items-center justify-center text-11 text-muted-foreground"
          >
            {inView ? "解析工作坊画布模板中…" : "滚动到此处即渲染"}
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
