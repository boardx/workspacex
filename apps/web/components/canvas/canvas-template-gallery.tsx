"use client";
import * as React from "react";
import { X, Search, ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ProjectRole } from "@/lib/identity";
import { PROJECT_ROLE_LABEL, PROJECT_ROLES } from "@/lib/identity";
import type { UiState } from "@/lib/ui-state";
import {
  TEMPLATE_CATEGORIES,
  galleryItems,
  starterMarkdownFor,
  type GalleryItem,
  type TemplateCategoryId,
} from "@/lib/mock/canvas-templates";
import { CanvasStage } from "./canvas-stage";
import type { CanvasTool } from "./canvas-toolbar";

/**
 * 「新建画布 → 选模板」画廊（UI 先行原型 · ADR-003）。
 *
 * 交互形态 = **模态**：新建画布是一次聚焦、短暂的动作，模态把用户留在项目画布上下文里，
 * 与同目录既有的 `template-apply-dialog.tsx`（也是模态）一致。见 design-note 的取舍说明。
 *
 * 数据链证明：选中一张模板 → `starterMarkdownFor(key)` 产出初始 markdown →
 * 交给**真实** `CanvasStage`（fabric + mermaid 引擎）渲染 →「画布真的从那个模板起手」。
 * 全程 mock，不接后端；无「用户选了哪个模板」的写路径（本轮不新建）。
 *
 * testid 前缀 `canvas-tpl-*`（邻居 `canvas-template-apply` 是既有绑定面，不改它）。
 */
export function CanvasTemplateGallery({
  state,
  previewRole,
}: {
  state: UiState;
  previewRole: ProjectRole | null;
}) {
  const items = React.useMemo(() => galleryItems(), []);
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<TemplateCategoryId | "all">("all");
  const [seeded, setSeeded] = React.useState(true);
  // 选中的模板：success 态预置 persona（拟真内容），其余态为空。
  const [picked, setPicked] = React.useState<GalleryItem | null>(
    state === "success" ? items.find((i) => i.key === "persona") ?? null : null,
  );
  const [markdown, setMarkdown] = React.useState<string>(
    state === "success" ? starterMarkdownFor("persona", true) : "",
  );

  const canCreate = previewRole !== "observer";

  const visible = React.useMemo(() => {
    const q = query.trim();
    return items.filter((it) => {
      if (category !== "all" && it.category !== category) return false;
      if (!q) return true;
      return (it.title + it.blurb + it.key).toLowerCase().includes(q.toLowerCase());
    });
  }, [items, query, category]);

  function pick(item: GalleryItem) {
    if (!canCreate) return;
    setPicked(item);
    setMarkdown(starterMarkdownFor(item.key, seeded));
  }

  // ── 成功态：模板已选，渲染真实画布（链路打通的证据） ──────────────────
  if (picked && markdown) {
    return (
      <div className="flex h-full w-full flex-col" data-testid="saved">
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPicked(null);
              setMarkdown("");
            }}
            data-testid="canvas-tpl-back"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> 换个模板
          </Button>
          <span className="text-13 font-medium" data-testid="canvas-tpl-started">
            {picked.glyph} 已从模板起手：{picked.title}
          </span>
          <Badge tone="primary" className="ml-1">新建画布</Badge>
          <span className="ml-auto text-11 text-muted-foreground">
            画布内容来自模板初始 markdown（真实 CanvasStage 渲染）
          </span>
        </div>
        <CanvasStageHost markdown={markdown} onChange={setMarkdown} readOnly={!canCreate} />
      </div>
    );
  }

  // ── 画廊态（default / loading / empty / invalid / dep-failed / denied） ──
  return (
    <div className="flex h-full w-full flex-col bg-panel" data-testid="canvas-tpl-gallery">
      {/* 模态头 */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <Plus className="h-4 w-4 text-primary" />
        <div>
          <h2 className="text-14 font-semibold">新建画布</h2>
          <p className="text-11 text-muted-foreground">选一个模板起手，或从空白开始</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-11 text-muted-foreground">
            <input
              type="checkbox"
              checked={seeded}
              onChange={(e) => setSeeded(e.target.checked)}
              data-testid="canvas-tpl-seeded-toggle"
            />
            示例内容
          </label>
          <Button variant="ghost" size="icon" aria-label="关闭" data-testid="canvas-tpl-close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 无权限态：观察者不能新建画布（视角切换仅预览，真实权限在服务端） */}
      {!canCreate ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center" data-testid="denied">
          <div className="text-2xl">🔒</div>
          <p className="text-13 font-medium">观察者视角无法新建画布</p>
          <p className="max-w-sm text-11 text-muted-foreground">
            新建画布是引导师 / 组长 / 组员的动作。切到这些视角即可预览创建流程。
            （视角切换仅为预览，真实权限由服务端裁决。）
          </p>
        </div>
      ) : (
        <>
          {/* 搜索 + 分类过滤 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜模板…"
                className="h-7 w-44 pl-7 text-12"
                data-testid="canvas-tpl-search"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <FilterChip active={category === "all"} onClick={() => setCategory("all")} testid="canvas-tpl-filter-all">
                全部
              </FilterChip>
              {TEMPLATE_CATEGORIES.map((c) => (
                <FilterChip
                  key={c.id}
                  active={category === c.id}
                  onClick={() => setCategory(c.id)}
                  testid={`canvas-tpl-filter-${c.id}`}
                >
                  {c.label}
                </FilterChip>
              ))}
            </div>
            <span className="ml-auto text-11 text-muted-foreground">共 {visible.length} 个可选起点</span>
          </div>

          {/* 网格主体：七态里的 loading / empty / dep-failed 三态在此分叉 */}
          <div className="flex-1 overflow-auto p-4">
            {state === "loading" ? (
              <GallerySkeleton />
            ) : state === "dep-failed" ? (
              <div
                className="mx-auto max-w-md rounded-md border border-destructive/40 bg-destructive/10 p-4 text-center"
                data-testid="dep-failed"
              >
                <div className="mb-1 text-xl">🧩</div>
                <p className="text-13 font-medium text-destructive">模板引擎未能加载</p>
                <p className="mt-1 text-11 text-muted-foreground">
                  画布渲染引擎（fabric-markdown）初始化失败，暂时无法预览模板。请刷新重试；
                  你已有的画布不受影响。
                </p>
                <Button variant="outline" size="sm" className="mt-3" data-testid="canvas-tpl-retry">
                  重试加载
                </Button>
              </div>
            ) : visible.length === 0 || state === "empty" ? (
              <div className="mx-auto max-w-sm py-12 text-center" data-testid="empty">
                <div className="mb-1 text-2xl">🔍</div>
                <p className="text-13 font-medium">没有匹配的模板</p>
                <p className="mt-1 text-11 text-muted-foreground">
                  换个关键词，或
                  <button
                    className="mx-1 text-primary underline-offset-2 transition-colors duration-200 hover:underline"
                    onClick={() => {
                      setQuery("");
                      setCategory("all");
                    }}
                    data-testid="canvas-tpl-clear-filter"
                  >
                    清除筛选
                  </button>
                  ；也可以直接从空白画布开始。
                </p>
              </div>
            ) : (
              <TemplateGrid items={visible} onPick={pick} />
            )}
          </div>

          {/* 校验失败态：直接从空白画布快建、但没起名 → 结构化错误（err-*） */}
          {state === "invalid" && (
            <div className="border-t border-border bg-card px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="给画布起个名…"
                  defaultValue=""
                  aria-invalid
                  className="h-7 w-56 border-destructive text-12"
                  data-testid="canvas-tpl-name"
                />
                <Button size="sm" variant="primary" data-testid="canvas-tpl-quick-create">
                  空白快建
                </Button>
              </div>
              <p role="alert" data-testid="err-name" className="mt-1 text-11 text-destructive">
                请先给画布起个名字再创建。
              </p>
            </div>
          )}
        </>
      )}

      {/* 底部：预览视角提示（真实切换在预览页顶栏的角色切换器） */}
      <div className="border-t border-border-subtle bg-card/60 px-4 py-1.5">
        <p className="text-10 text-muted-foreground">
          当前预览视角：{previewRole ? PROJECT_ROLE_LABEL[previewRole] : "未选角色"} ·
          可预览角色：{PROJECT_ROLES.map((r) => PROJECT_ROLE_LABEL[r]).join(" / ")}
        </p>
      </div>
    </div>
  );
}

/** CanvasStage 需要 tool / zoom 本地态；这里给一个最小宿主，专供原型渲染。 */
function CanvasStageHost({
  markdown,
  onChange,
  readOnly,
}: {
  markdown: string;
  onChange: (next: string) => void;
  readOnly: boolean;
}) {
  const [tool] = React.useState<CanvasTool>("select");
  const [zoom] = React.useState(1);
  return <CanvasStage readOnly={readOnly} tool={tool} zoom={zoom} markdown={markdown} onMarkdownChange={onChange} />;
}

function TemplateGrid({ items, onPick }: { items: GalleryItem[]; onPick: (i: GalleryItem) => void }) {
  const byCat = TEMPLATE_CATEGORIES.map((c) => ({
    cat: c,
    list: items.filter((i) => i.category === c.id),
  })).filter((g) => g.list.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {byCat.map(({ cat, list }) => (
        <section key={cat.id} data-testid={`canvas-tpl-section-${cat.id}`}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-12 font-semibold">{cat.label}</h3>
            <span className="text-10 text-muted-foreground">{cat.hint}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((it) => (
              <button
                key={it.key}
                onClick={() => onPick(it)}
                data-testid={`canvas-tpl-card-${it.key}`}
                className={cn(
                  "group flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left",
                  "transition-all duration-200 hover:border-primary hover:shadow-sm active:scale-[0.99]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                )}
              >
                <div className="flex h-16 items-center justify-center rounded-md bg-panel-alt text-3xl">
                  {it.glyph}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-12 font-medium">{cnHead(it.title)}</span>
                  {!it.isTemplate && <Badge tone="outline">起点</Badge>}
                </div>
                <p className="line-clamp-2 text-10 text-muted-foreground">{it.blurb}</p>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function GallerySkeleton() {
  return (
    <div data-testid="loading" className="flex flex-col gap-5">
      {[0, 1].map((s) => (
        <div key={s}>
          <div className="mb-2 h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                <div className="h-16 animate-pulse rounded-md bg-muted" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  testid,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      data-active={active}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-11 transition-colors duration-200",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/** 取标题的中文头（`用户画像 User Persona` → `用户画像`），画廊卡片只显中文更清爽。 */
function cnHead(title: string): string {
  const m = /^([^\sA-Za-z]+)/.exec(title);
  return (m?.[1] ?? title).trim() || title;
}
