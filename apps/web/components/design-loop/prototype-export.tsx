"use client";
/**
 * 迭代 8 —— 导出菜单：设计文档（.md）/ 原型规格（.json）/ 当前页 PNG / 复制 JSON。
 *
 * 全部在客户端完成：素材都在 `DesignProject` 里，多一个接口只是多一份可漂移的副本（同迭代 0 的取舍）。
 * PNG 用 `html2canvas` 动态 import（只在点击时加载 ~200KB），目标是画布上 `data-frame-index` 等于当前页
 * 的那块屏——单页视图与画板视图都挂了这个属性。jsdom 里 `URL.createObjectURL` / 剪贴板 / html2canvas
 * 都由测试 mock。
 */
import * as React from "react";
import { Download, FileDown, FileJson, Image as ImageIcon, Copy, Check, Loader2, MousePointerClick, Printer, FileCode2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildDesignDocMarkdown, designDocFileName, buildPrototypeSpecJson, prototypeSpecFileName } from "@/lib/design-doc-markdown";
import { buildPrototypeExportHtml, collectPageCss, prototypeExportHtmlFileName } from "@/lib/prototype-export-html";
import { renderScreensToMarkup } from "@/lib/prototype-export-render";
import { buildPrototypeReactTsx, prototypeReactFileName } from "@/lib/prototype-react-export";
import type { DesignProject } from "@/lib/live-design-workbench";
import { describeFailure } from "@/lib/design-failure";
import { exportFileStem, loadRomanize } from "@/lib/export-file-name";

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 不能同步 revoke：Chromium 在 click 之后才开始读 blob，立刻 revoke 会让下载拿到空文件/默认名（e2e 实测）。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 当前页在画布上的那块屏（单页 / 画板都挂 `data-frame-index`）。 */
export function frameElementFor(index: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="design-detail-phone"][data-frame-index="${index}"]`);
}

export function PrototypeExportMenu({ project, frame }: { project: DesignProject; frame: number }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  /**
   * 迭代 29 —— 导出失败过去是**静默**的。
   *
   * 六个动作全是 `try { … } finally { setBusy(null) }`，没有一个 catch：剪贴板被浏览器拒、
   * html2canvas 抛、弹窗被拦——用户看到的是转圈停下、菜单关掉，然后什么也没有。他会再点一次，
   * 再什么也没有。「交出去」这一步一旦不说话，人只能以为是自己点错了。
   */
  const [failed, setFailed] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    /*
     * `role="menu"` 对读屏用户是一句承诺：上下键能在项之间走。原来只有 Esc，
     * Tab 会一路走出菜单（而菜单是绝对定位浮层，走出去等于走丢）。
     * 禁用项跳过——停在一个点不动的项上等于卡住。
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
      const root = rootRef.current;
      if (root === null) return;
      const items = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'));
      if (items.length === 0) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === "Home" ? 0
        : e.key === "End" ? items.length - 1
        : e.key === "ArrowDown" ? (at + 1) % items.length
        : (at <= 0 ? items.length : at) - 1;
      items[next]?.focus();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  /** 「已复制」那一下的定时器：卸载时要清掉，否则菜单先关、1.5 秒后还往一个没了的组件里写。 */
  const flashTimer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
  }, []);
  const flash = (key: string) => {
    setDone(key);
    setFailed(null);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setDone(null), 1500);
  };
  /** 失败一律落到这里：菜单**不关**（关掉等于把话说完就跑），并说清下一步。 */
  const fail = (what: string, err: unknown) => { setFailed(`没能${what}（${describeFailure(err)}）`); };

  /*
   * 迭代 39：上面迭代 29 那段说的是「六个动作全没有 catch」，但它只补了四个——
   * 这两条**同样会抛**（`URL.createObjectURL` 在某些隐私模式下不给、文档大到拼不出串），
   * 于是它们留在了原地：点一下，菜单关掉，什么也没发生。补齐，并且失败时菜单不关。
   */
  const doc = async () => {
    try {
      const now = new Date();
      const romanize = await loadRomanize();
      download(new Blob([buildDesignDocMarkdown(project, now)], { type: "text/markdown;charset=utf-8" }), designDocFileName(project, now, romanize));
      setOpen(false);
    } catch (err) {
      fail("导出设计文档", err);
    }
  };
  const json = async () => {
    try {
      const romanize = await loadRomanize();
      download(new Blob([buildPrototypeSpecJson(project)], { type: "application/json;charset=utf-8" }), prototypeSpecFileName(project, new Date(), romanize));
      setOpen(false);
    } catch (err) {
      fail("导出原型规格", err);
    }
  };
  const copy = async () => {
    setBusy("copy");
    try {
      await navigator.clipboard.writeText(buildPrototypeSpecJson(project));
      flash("copy");
    } catch (err) {
      // 非安全上下文 / 权限没给时浏览器会直接拒——这时「下载原型规格」是能走通的那条路。
      fail("复制到剪贴板（可以改用上面的「原型规格」下载成文件）", err);
    } finally {
      setBusy(null);
    }
  };
  /**
   * 迭代 12（F56）：自包含、可点击的 HTML。
   * 结构用 `renderToStaticMarkup` 渲染**同一批组件**，样式从页面自己的 stylesheet 抽——
   * 两边都不另写一份（签核取舍 ①=A）。
   */
  const html = async () => {
    setBusy("html");
    try {
      const screens = await renderScreensToMarkup(project);
      const css = collectPageCss(screens.map((s) => s.markup).join(""), Array.from(document.styleSheets) as CSSStyleSheet[]);
      const now = new Date();
      const text = buildPrototypeExportHtml({ project, screens, css, now });
      const romanize = await loadRomanize();
      download(new Blob([text], { type: "text/html;charset=utf-8" }), prototypeExportHtmlFileName(project.name, now, romanize));
      flash("html");
      setOpen(false);
    } catch (err) {
      fail("导出可点击原型", err);
    } finally {
      setBusy(null);
    }
  };

  /**
   * 迭代 12（F57）：PDF 交付文档 = 上面那份 HTML 的**打印视图**（签核取舍 ②=A）。
   * 不引 jsPDF：中文要么打包 ~8MB 字体、要么把文字光栅化成图（不可选中不可搜索），
   * 而这份 PDF 的用途正是发给人读和引用。代价是用户在打印对话框里多点一次「保存为 PDF」。
   * 产物里 `@media print` 把所有页都展开、每页分页，界面一节图文同页。
   */
  const pdf = async () => {
    setBusy("pdf");
    try {
      const screens = await renderScreensToMarkup(project);
      const css = collectPageCss(screens.map((s) => s.markup).join(""), Array.from(document.styleSheets) as CSSStyleSheet[]);
      const text = buildPrototypeExportHtml({ project, screens, css, now: new Date(), forPrint: true });
      const w = window.open("", "_blank");
      /*
       * ⚠ 这里原来是 `if (w !== null) { … }` 之后**无条件** `flash("pdf")`：弹窗被浏览器拦下时
       * 一个字都没打印出来，屏上却闪一下"完成"。这正是本仓那条"假绿"——没发生的事不许报成发生了。
       */
      if (w === null) {
        setFailed("浏览器把打印窗口拦下了。在地址栏右边允许本站弹出窗口，再点一次；或者先导出「可点击原型」，打开那个文件再打印。");
        return;
      }
      w.document.write(text);
      w.document.close();
      w.focus();
      w.print();
      flash("pdf");
      setOpen(false);
    } catch (err) {
      fail("生成打印视图", err);
    } finally {
      setBusy(null);
    }
  };

  /**
   * 对标 R10（#3955）：交给工程的**代码**——一个只依赖 react 的 .tsx（见 `lib/prototype-react-export`）。
   * 中性档的主色取页面当下的 `--primary`，不在导出器里另抄一份全局 token。
   */
  const code = async () => {
    try {
      const root = getComputedStyle(document.documentElement);
      const primary = root.getPropertyValue("--primary").trim();
      const foreground = root.getPropertyValue("--primary-foreground").trim();
      const now = new Date();
      const text = buildPrototypeReactTsx(project, { now, ...(primary !== "" && foreground !== "" ? { neutral: { primary, foreground } } : {}) });
      const romanize = await loadRomanize();
      download(new Blob([text], { type: "text/plain;charset=utf-8" }), prototypeReactFileName(project.name, now, romanize));
      setOpen(false);
    } catch (err) {
      fail("导出 React 组件", err);
    }
  };

  const png = async () => {
    const el = frameElementFor(frame);
    if (el === null) {
      // 原来是 `return`——点了没反应。当前页还没画出来时说清楚，而不是装作没点过。
      setFailed("这一页还没画出来，截不了图。先让 AI 画出这一页，或者切到已经画好的那一页。");
      return;
    }
    setBusy("png");
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(el, { backgroundColor: null, scale: 2, useCORS: true, logging: false });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob === null) {
        setFailed("这一页没能转成图片。可以改用「可点击原型」或「打印成 PDF」。");
        return;
      }
      /* 页名多半是中文（「首页」「我的」）——不过一次同一份规则，拿到的就是一个叫 `download` 的文件。 */
      const romanize = await loadRomanize();
      download(blob, `${exportFileStem(project.name, "design", romanize)}-${exportFileStem(project.frames[frame] ?? "", `p${String(frame + 1)}`, romanize)}.png`);
      flash("png");
      setOpen(false);
    } catch (err) {
      fail("截这一页的图", err);
    } finally {
      setBusy(null);
    }
  };

  const item = "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-12 transition-colors duration-fast hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground";
  return (
    <div ref={rootRef} className="relative">
      <Button variant="ghost" size="sm" onClick={() => { setFailed(null); setOpen((o) => !o); }} aria-haspopup="menu" aria-expanded={open} data-testid="design-detail-export">
        <Download aria-hidden className="h-3.5 w-3.5" /> 导出
      </Button>
      {open && (
        <div role="menu" aria-label="导出" className="absolute right-0 top-full z-20 mt-1 w-56 rounded-card border border-border bg-card p-1 shadow-lg" data-testid="design-detail-export-menu">
          {failed !== null && (
            <p role="alert" className="mb-1 rounded-control bg-destructive/10 px-2 py-1.5 text-11 text-destructive" data-testid="design-detail-export-error">{failed}</p>
          )}
          <button type="button" role="menuitem" onClick={() => void doc()} className={item} data-testid="design-detail-export-doc">
            <FileDown aria-hidden className="h-3.5 w-3.5" /> <Label name="设计文档" hint="给人看：问题、验收标准、逐页说明" />
          </button>
          <button type="button" role="menuitem" onClick={() => void json()} className={item} data-testid="design-detail-export-json">
            <FileJson aria-hidden className="h-3.5 w-3.5" /> <Label name="原型规格" hint="给工程：机器可读的组件树与跳转" />
          </button>
          {/* 灰掉的东西要自己解释：三项一起灰是同一个原因，说一次，别让他一项一项去猜。 */}
          {project.prototype.length === 0 && (
            <p className="mb-1 px-2 py-1 text-10 text-muted-foreground" data-testid="design-detail-export-nothing">
              还没有画出来的页，所以截图、可点击原型、打印、React 组件这四项现在导不了。先在对话里说一句你要做什么。
            </p>
          )}
          <button type="button" role="menuitem" onClick={() => void png()} disabled={busy !== null || project.prototype.length === 0} className={item} data-testid="design-detail-export-png">
            {busy === "png" ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon aria-hidden className="h-3.5 w-3.5" />}
            <Label name={`当前页截图${project.frames[frame] !== undefined ? `（${project.frames[frame]}）` : ""}`} hint="贴进文档或聊天窗" />
          </button>
          <button type="button" role="menuitem" onClick={() => void html()} disabled={busy !== null || project.prototype.length === 0} className={item} data-testid="design-detail-export-html">
            {busy === "html" ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <MousePointerClick aria-hidden className="h-3.5 w-3.5" />}
            <Label name="可点击原型（单个文件）" hint="不联网也能打开；要发给别人建议用「分享」" />
          </button>
          <button type="button" role="menuitem" onClick={() => void pdf()} disabled={busy !== null || project.prototype.length === 0} className={item} data-testid="design-detail-export-pdf">
            {busy === "pdf" ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <Printer aria-hidden className="h-3.5 w-3.5" />}
            <Label name="打印成 PDF" hint="浏览器打印视图，一页一屏" />
          </button>
          <button type="button" role="menuitem" onClick={() => void code()} disabled={busy !== null || project.prototype.length === 0} className={item} data-testid="design-detail-export-code">
            <FileCode2 aria-hidden className="h-3.5 w-3.5" /> <Label name="React 组件（.tsx）" hint="给工程：一个文件、只依赖 react，Tailwind 样式" />
          </button>
          <button type="button" role="menuitem" onClick={() => void copy()} disabled={busy !== null} className={cn(item, done === "copy" && "text-success")} data-testid="design-detail-export-copy">
            {done === "copy" ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
            {done === "copy" ? "已复制" : <Label name="复制原型规格" hint="直接粘给工程或别的工具" />}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 迭代 25：每一项加一句「这是给谁的」。
 *
 * 此前六项全按**文件格式**命名（.md / .json / PNG / .html / PDF）——而第一次来的人心里的问题
 * 是「我想给别人看」「我要交给工程」，不是「我要哪种扩展名」。格式仍在（要的人要得到），
 * 只是不再是唯一的信息。
 */
function Label({ name, hint }: { name: string; hint: string }) {
  return (
    <span className="flex min-w-0 flex-col text-left">
      <span className="truncate">{name}</span>
      <span className="truncate text-10 text-muted-foreground">{hint}</span>
    </span>
  );
}
