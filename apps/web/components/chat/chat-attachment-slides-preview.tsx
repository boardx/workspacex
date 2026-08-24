"use client";

/**
 * issue #1980 —— pptx 内联预览。纯前端渲染，不依赖后端转换。
 *
 * 用开源库 `pptx-preview`（ISC，npm 包本身「自用商用均可免费使用」——注意它的源码另有
 * 「仅供个人学习、不得转为自有项目开源」的限制条款，我们只是把编译产物当依赖装，不涉及
 * 修改/转发源码，不冲突）。`init(dom, options).preview(arrayBuffer)`：ESM、带 `.d.ts`
 * 类型、无 jQuery 依赖，`mode: "list"` 一次把全部幻灯片渲染成可滚动列表，不需要额外做
 * 轮播控件。
 *
 * 字节来源：父组件 `ChatAttachmentPreviewModal` 已经用 `useAuthedImageSrc` 把附件字节拉成
 * blob URL（`src`）。这里 `fetch(src)` 读的是浏览器本地 blob 存储，不是再打一次带鉴权的
 * 网络请求——避免重复打 `.../content` 端点。
 *
 * `pptx-preview` 依赖 `echarts`（渲染图表用），体积不小，所以用动态 `import()` 放进
 * `useEffect`，只有真的挂载出一个 pptx 预览时才加载，不进主 bundle、也不在 SSR 阶段跑
 * （父组件本身已经是仅客户端挂载的 portal，这里再动态 import 双重保险）。
 *
 * ⚠ 2026-08-24 黑屏回归（#1980 跟进，人类实测截图：整块预览区纯黑）—— 根因排查（读
 * `node_modules/pptx-preview/dist/pptx-preview.es.js` 源码，非猜测）：
 *
 * 1. **外层 wrapper 硬编码纯黑背景**：库自己的 `renderContainer()` 对
 *    `.pptx-preview-wrapper` 执行 `style.setProperty("background", "#000")`——设计意图是
 *    「正常情况下会被每张幻灯片自己的白色/主题背景完全盖住，用户看不到这层黑」。一旦某一张
 *    （或全部）幻灯片因为库内部某个解析分支抛错/提前返回而没有真的把
 *    `.pptx-preview-slide-wrapper` append 上去，`preview()` 的 Promise 依然会正常
 *    resolve（内部错误没有冒泡到我们的 `catch`）——用户看到的就是这层裸黑背景，控制台
 *    干净、没有任何异常，这正是人类报告「没有报错，就是纯黑」的实际机制。
 * 2. **背景图 `background-size` 是无单位数字，CSS 判定非法而被忽略**：库渲染图片填充
 *    背景时 `r.style.backgroundSize = "".concat(g," ").concat(x)`（`g`/`x` 是
 *    `renderPort.width/height` 乘一个比例算出来的纯数字，没有拼 `"px"`）——
 *    `background-size: 400 300`（不带单位）是非法值，浏览器整条声明静默丢弃、退回
 *    `background-size: auto`，图片按原始像素铺贴，常见结果是背景图裁到看不见/铺不满，
 *    与上游仓库一个从未修复的 open issue 逐字对应
 *    （github.com/501351981/pptx-preview issue #12「PPT 背景图片加载成功但因样式导致
 *    未显示」）。这类背景图常常就是封面页的整页配图——它「未显示」时，用户看到的还是
 *    上面第 1 点那层裸黑背景。
 *
 * 两条根因指向同一个可见症状（纯黑），且都是「库不抛错、DOM 半渲染」——所以修法必须是
 * **渲染完成后主动体检**，不能依赖 `preview()` 的 resolve/reject 语义：
 *   a) `preview()` resolve 后，检查真的 append 出了 `.pptx-preview-slide-wrapper`
 *      （数量 > 0）——数量为 0 视同渲染失败，走 failed 分支，不放任一块裸黑显示给用户。
 *   b) 补丁扫一遍容器内所有 `element.style.backgroundImage` 非空的节点，把非法
 *      （不带单位、或计算值达不到覆盖效果）的 `backgroundSize` 强制改写成 `cover`——
 *      这是本仓在渲染产物上打的补丁，不改 `node_modules` 里的第三方源码。
 *   c) 把 wrapper 自己的裸黑 `#000` 背景换成本仓语义 token（`--muted`），即使
 *      a/b 两条防线都没兜住某个更冷门的内部渲染失败分支，用户看到的也是一块中性灰、
 *      不是一块吓人的纯黑（这条不是主防线，是最后一层安全网）。
 */
import * as React from "react";
import { cn } from "@/lib/utils";

type PptxPreviewer = { preview: (file: ArrayBuffer) => Promise<unknown>; destroy: () => void };

/**
 * 渲染后体检 + 打补丁，见上方文件头「2026-08-24 黑屏回归」注释 a/b/c 三条防线。
 * 返回渲染出的幻灯片张数——0 张视同「实质上没有渲染出内容」，调用方应该走 failed 分支；
 * >0 时顺带把张数喂给「共 N 页」指示条（第二轮 UX 迭代新增，见 `ChatAttachmentSlidesPreview`）。
 */
function sanityCheckAndPatchRender(container: HTMLElement): number {
  const wrapper = container.querySelector<HTMLElement>(".pptx-preview-wrapper");
  if (!wrapper) return 0;

  // 防线 c：裸黑 wrapper 背景换成中性 token——即使下面两条防线都没兜住，用户看到的也不是
  // 纯黑，而是一块和弹窗其余区域协调的中性灰（light/dark 两套主题都定义了 --muted）。
  wrapper.style.setProperty("background", "hsl(var(--muted))");

  // 防线 b：修补「非法/不生效的 background-size」这个已知上游缺陷（issue #12）。
  const withBgImage = wrapper.querySelectorAll<HTMLElement>('[style*="background-image"]');
  withBgImage.forEach((el) => {
    const size = el.style.backgroundSize;
    // 合法值要么是关键字（cover/contain/auto…），要么每个分量都带单位（px/%/…）。
    // 库产出的坏值形如 "412.5 231"——纯数字、没有单位，用这个特征识别，不误伤合法值。
    const looksUnitless = /^\s*-?[\d.]+(\s+-?[\d.]+)?\s*$/.test(size);
    if (!size || looksUnitless) {
      el.style.backgroundSize = "cover";
    }
  });

  // 防线 a：真的渲染出了至少一张幻灯片，才算数——数量为 0 就是「有 DOM 骨架、没有内容」，
  // 与用户报告的黑屏是同一个可见症状。
  return wrapper.querySelectorAll(".pptx-preview-slide-wrapper").length;
}

export function ChatAttachmentSlidesPreview({
  src, filename,
}: {
  src: string;
  filename: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [failed, setFailed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [slideCount, setSlideCount] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    let previewer: PptxPreviewer | null = null;
    setFailed(false);
    setLoading(true);
    setSlideCount(0);

    (async () => {
      try {
        const [{ init }, res] = await Promise.all([import("pptx-preview"), fetch(src)]);
        if (cancelled) return;
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) throw new Error("slides_container_unmounted");
        container.innerHTML = "";
        previewer = init(container, { width: 960, height: 540, mode: "list" }) as unknown as PptxPreviewer;
        await previewer.preview(buffer);
        if (cancelled) return;
        // 库不抛错也可能「没真的渲染出东西」（见文件头黑屏回归注释）——渲染后体检，
        // 不能只信任 preview() 的 resolve 语义。
        const count = sanityCheckAndPatchRender(container);
        if (count === 0) throw new Error("slides_render_empty");
        setSlideCount(count);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      previewer?.destroy();
    };
  }, [src]);

  if (failed) {
    // 与「该文件类型不支持预览」区分开——这里是「有渲染器但渲染失败」的运行时异常态，
    // 不是「压根没有渲染器」，文案不能混用。
    return (
      <p className="text-13 text-muted-foreground" data-testid="chat-attachment-preview-slides-failed">
        预览渲染失败，请下载查看。
      </p>
    );
  }

  return (
    <div className="relative w-full">
      {loading && (
        // 骨架屏：pptx-preview 本身要下载~1.2MB 的异步 chunk + 解析 zip + 逐张幻灯片布局，
        // 不是瞬时的——从「弹窗刚打开」到「第一张幻灯片画出来」之间给一个明确的中间态，
        // 不能让用户盯着空白猜是不是卡住了。
        <div
          role="status"
          aria-live="polite"
          className="flex h-[338px] w-full flex-col items-center justify-center gap-2 rounded-md border border-border-subtle bg-muted/30"
          data-testid="chat-attachment-preview-slides-loading"
        >
          <span
            className="h-5 w-5 motion-safe:animate-spin rounded-full border-2 border-muted-foreground/40 border-t-foreground"
            aria-hidden
          />
          <p className="text-13 text-muted-foreground">正在解析幻灯片…</p>
        </div>
      )}
      <div
        ref={containerRef}
        aria-label={filename}
        className={cn(
          "max-h-[60vh] w-full overflow-y-auto rounded-md border border-border-subtle",
          loading && "hidden",
        )}
        data-testid="chat-attachment-preview-slides"
      />
      {!loading && slideCount > 0 && (
        // 「共 N 页」指示条：mode:"list" 把全部幻灯片纵向拼成一个可滚动列表，没有分页控件，
        // 用户容易看了第一页就以为「预览只有这一页」——右上角浮一个轻量计数，不需要点开
        // 才知道这份文件有多少页。sticky 定位贴容器右上角，不挡内容、也不随内容滚走。
        <span
          className="pointer-events-none absolute right-2 top-2 rounded-full bg-inverse/70 px-2 py-0.5 text-11 text-inverse-foreground backdrop-blur-sm"
          data-testid="chat-attachment-preview-slides-count"
        >
          共 {slideCount} 页
        </span>
      )}
    </div>
  );
}
