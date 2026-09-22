"use client";
/**
 * 迭代 22 —— **分享页**：一条免登录链接打开之后看到的全部东西。
 *
 * ## 这一屏的读者不是设计者
 *
 * 他多半是在手机上、从聊天窗口点进来的，没有账号，也不知道"原型"这套东西怎么用。
 * 所以这里刻意**没有**：编辑、图层、版本、属性面板、对话。只有三件事——
 * 翻页、点得动的跳转、这一页是干什么的。
 *
 * ## 跳转默认开着
 *
 * 详情页里"预览"是一个要主动切过去的模式；在这里它是唯一的模式。链接发出去就是为了让人
 * **走一遍**，再让他先找到一个开关才点得动，等于把这条链接最值钱的部分藏起来。
 */
import * as React from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PrototypeCanvas, deviceOf, fitScale, rotated } from "./prototype-canvas";
import { fetchSharedDesign, type SharedDesign } from "@/lib/live-design-workbench";
import { ApiError } from "@/lib/api-client";

/** 打不开的三种原因在服务端是同一个码（不给试令牌的人进度条），所以屏上也只有一句话。 */
const NOT_FOUND_TEXT = "这条分享链接打不开：可能已经被取消分享，也可能链接不完整。找发给你的人要一条新的。";

export function SharedDesignView({
  token,
  /** 测试注入：省得在 jsdom 里搭一套 fetch。生产不传。 */
  load = fetchSharedDesign,
}: {
  token: string;
  load?: (token: string) => Promise<{ design: SharedDesign }>;
}): React.ReactElement {
  const [design, setDesign] = React.useState<SharedDesign | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [frame, setFrame] = React.useState(0);
  /** 点跳转进来的来路——有它才能"返回上一页"，否则访客在深层页里出不来。 */
  const [backStack, setBackStack] = React.useState<number[]>([]);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [stage, setStage] = React.useState({ w: 0, h: 0 });

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { design: d } = await load(token);
        if (alive) setDesign(d);
      } catch (e) {
        if (!alive) return;
        // 404 = 契约的 `SHARE_NOT_FOUND`；别的（断网、5xx）如实说是"没能打开"，不冒充成已撤销。
        setError(e instanceof ApiError && e.status === 404 ? NOT_FOUND_TEXT : "没能打开这条链接，稍后再试一次。");
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, load]);

  React.useEffect(() => {
    const el = stageRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (r !== undefined) setStage({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [design]);

  if (error !== null) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6" data-testid="shared-design-error">
        <p className="max-w-sm text-center text-13 text-muted-foreground">{error}</p>
      </main>
    );
  }
  if (design === null) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6" data-testid="shared-design-loading">
        <p className="text-13 text-muted-foreground">正在打开…</p>
      </main>
    );
  }

  const device = deviceOf(design.template);
  const size = rotated(device, false);
  const scale = fitScale(stage, { w: size.w, h: size.h + 40 });
  const at = Math.min(frame, Math.max(design.frames.length - 1, 0));
  const note = (design.frameNotes[at] ?? "").trim();

  const go = (to: number) => {
    setBackStack((s) => [...s, at]);
    setFrame(to);
  };

  return (
    <main className="flex min-h-screen flex-col bg-background text-background-foreground" data-testid="shared-design-view">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <h1 className="text-14 font-medium" data-testid="shared-design-name">{design.name}</h1>
        {/*
          * 访客必须知道**自己看的是哪一版**：这条链接是一份冻结的快照，设计者这会儿
          * 很可能已经改过三轮了。不写发布时间，"我看到的是不是最新的"就只能靠问。
          */}
        <p className="text-11 text-muted-foreground" data-testid="shared-design-meta">
          {design.ownerName === null ? "" : `${design.ownerName} · `}
          发布于 {new Date(design.publishedAt).toLocaleString("zh-CN")}
          {" · 只读"}
        </p>
      </header>

      {design.problem !== null && (
        <section className="border-b border-border px-4 py-3" data-testid="shared-design-brief">
          <h2 className="text-11 uppercase tracking-wide text-muted-foreground">问题与目标</h2>
          <p className="mt-1 whitespace-pre-wrap text-12">{design.problem}</p>
          {design.criteria !== null && design.criteria.length > 0 && (
            <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-12 text-muted-foreground">
              {design.criteria.map((c, i) => <li key={`${String(i)}-${c}`}>{c}</li>)}
            </ol>
          )}
        </section>
      )}

      {design.frames.length === 0 ? (
        <p className="p-6 text-13 text-muted-foreground" data-testid="shared-design-empty">这份原型还没有页面。</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 页签横向滚动——手机上八页也放得下，不折行把画布挤走 */}
          <nav className="flex gap-1 overflow-x-auto px-4 py-2" data-testid="shared-design-frames">
            {design.frames.map((f, i) => (
              <button
                key={`${String(i)}-${f}`}
                type="button"
                onClick={() => { setFrame(i); setBackStack([]); }}
                aria-pressed={i === at}
                data-testid={`shared-design-frame-${String(i)}`}
                className={cn(
                  "shrink-0 rounded-control px-2 py-1 text-11 transition-colors duration-fast",
                  i === at ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60",
                )}
              >
                {f || `第 ${String(i + 1)} 页`}
                {design.prototype[i] === null && <span className="ml-1 opacity-60">（未出图）</span>}
              </button>
            ))}
          </nav>

          {note !== "" && (
            <p className="px-4 pb-2 text-11 text-muted-foreground" data-testid="shared-design-note">{note}</p>
          )}

          <div ref={stageRef} className="relative flex min-h-0 flex-1 justify-center overflow-auto p-4" data-scale={scale.toFixed(3)}>
            {backStack.length > 0 && (
              <div className="absolute left-4 top-4 z-10">
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="shared-design-back"
                  onClick={() => setBackStack((s) => { const prev = s[s.length - 1]; if (prev !== undefined) setFrame(prev); return s.slice(0, -1); })}
                >
                  <ArrowLeft aria-hidden className="mr-1 h-3 w-3" />返回
                </Button>
              </div>
            )}
            <div style={{ transform: `scale(${scale})`, transformOrigin: "top center", width: size.w, height: size.h }}>
              <PrototypeCanvas
                label={design.frames[at] ?? ""}
                root={design.prototype[at] ?? null}
                /* 这一页规划了但没画出来——如实说，不假装这个项目只有几页（issue #3340 同一条）。 */
                ungenerated={design.prototype.length > 0 && (design.prototype[at] ?? null) === null}
                device={device}
                accent={design.accent}
                wireframe={design.template === "wireframe"}
                theme={design.theme}
                frameIndex={at}
                /* 见文件头：这里没有"编辑"这个模式，跳转默认就是能点的。 */
                mode="preview"
                links={design.frameLinks[at]}
                onNavigate={go}
              />
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-border px-4 py-2 text-10 text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ExternalLink aria-hidden className="h-3 w-3" />
          这是一份只读的设计原型快照
        </span>
      </footer>
    </main>
  );
}
