"use client";

/**
 * 后台四个能力目录（Agent / Skill / 模型 / MCP）共用的**卡片目录壳**。
 *
 * 2026-09-02 人类原话：「简化左边的 Agent目录，skill目录，模型，MCP的功能首页，参考
 * 画布模板的首页，简化为一个卡片的列表，通过一个侧边面板来展示当前的实体的内容，
 * 可以增加删除修改，并通过 tag 来过滤和搜索。」
 *
 * 参照物是 `components/canvas/template-admin.tsx`（画布模板库）：
 *   头部（标题 + 计数 + 新建 / 刷新）→ 搜索框 + 标签筛选条 → 卡片网格 → 点卡片打开面板。
 * 那一屏的这几件事在四个目录里各写一遍，就是四份会各自漂移的副本——所以收敛到这里。
 *
 * ## 本组件只负责「壳」，不认识任何一种实体
 *
 * · 数据加载、写操作、权限降噪全部留在调用方；这里只收 `rows` 与三个投影函数
 *   （`keyOf` / `searchTextOf` / `tagsOf`）与两个渲染函数（`renderCard` / `renderDetail`）。
 * · **搜索 + 标签筛选都是纯前端本地过滤**，零网络请求——服务端返回什么就筛什么，
 *   不给任何一个目录发明第二个「按标签查」的读接口。
 * · **标签由现有行实时汇总**（同画布模板库 R2），不是写死的枚举；每个标签后跟数量，
 *   数量基于全部行，不受搜索词与已选标签影响（否则点一个标签之后其它标签的数字会跟着变）。
 *   多选，跨标签是「且」；一个都没选 = 不筛。
 * · 选中的实体用 **key** 记（`selectedKey`），不是把点击时那一份对象存起来——刷新之后
 *   面板要显示服务端最新的那一行，而不是一份已经过期的快照；那一行不在了（比如停用后
 *   被移出目录）面板就自然关掉。
 *
 * ## 与 `entity-view-toggle.tsx`（卡片 / 列表双态）的关系
 *
 * 2026-08-15 那轮要求「卡片也可以切换为列表」，本轮人类点名参照的画布模板库已于
 * 2026-08-26 撤掉表格视图、只剩卡片网格；这次四个目录跟着参照物走，**不再挂切换按钮**。
 * `EntityViewToggle` 文件保留（同类先例：退役组件留痕），本组件不引用它。
 *
 * ## testid 约定（e2e 与既有单测都锚这些名字，改动前先看谁在读）
 *   根容器 `{rootTestId ?? prefix-catalog}` · 搜索框 `{prefix}-search` ·
 *   标签条 `{prefix}-tag-filters` / 单个标签 `{prefix}-tag-filter-{key}` / 清空 `{prefix}-tag-filter-all` ·
 *   网格 `{prefix}-list` · 卡片 `{cardTestId(row)}`（默认 `{prefix}-row-{key}`）·
 *   加载 `{prefix}-loading` · 失败 `{prefix}-error` + `{prefix}-retry` · 真实空态 `{prefix}-empty` ·
 *   筛空 `{prefix}-no-match` · 面板 `{prefix}-detail`（关闭按钮 `{prefix}-detail-close`）。
 */
import * as React from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AdminDrawer } from "./panel";
import { cn } from "@/lib/utils";

/** 一个可筛选的标签。`key` 进 testid，用英文 slug；`label` 是人看的。 */
export interface CatalogTag {
  readonly key: string;
  readonly label: string;
}

export type CatalogStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready" };

export interface EntityCatalogProps<T> {
  /** testid 前缀，如 `admin-agent`。 */
  prefix: string;
  /** 根容器 testid，缺省 `${prefix}-catalog`。 */
  rootTestId?: string;
  title: string;
  /** 标题下一句说明。 */
  description?: React.ReactNode;
  /** 标题上方的一行（组织标识等），由调用方决定要不要。 */
  eyebrow?: React.ReactNode;
  /** 头部右侧的动作（新建 / 导入…），刷新按钮由本组件自己挂。 */
  headerActions?: React.ReactNode;
  /** 头部之下、筛选条之上：操作结果 / 错误提示等。 */
  notices?: React.ReactNode;
  status: CatalogStatus;
  rows: readonly T[];
  keyOf: (row: T) => string;
  /** 被搜索的文本（名字、id、描述…拼成一串即可），大小写不敏感。 */
  searchTextOf: (row: T) => string;
  tagsOf: (row: T) => readonly CatalogTag[];
  renderCard: (row: T) => React.ReactNode;
  /** 卡片 testid，缺省 `${prefix}-row-${keyOf(row)}`。 */
  cardTestId?: (row: T) => string;
  onRefresh: () => void;
  /** 服务端真实空态（`rows.length === 0`）时显示的内容。 */
  emptyState: React.ReactNode;
  searchPlaceholder?: string;
  /** 当前打开面板的实体 key；`null` = 面板关着。 */
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  detailTitle: (row: T) => string;
  detailSubtitle?: (row: T) => string;
  renderDetail: (row: T) => React.ReactNode;
  detailFooter?: (row: T) => React.ReactNode;
  detailWidth?: "md" | "lg";
  /** 面板 testid，缺省 `${prefix}-detail`（关闭按钮恒为 `${testid}-close`）。 */
  detailTestId?: string;
  /** 弹窗、确认框等——挂在根容器末尾。 */
  children?: React.ReactNode;
  className?: string;
}

export function EntityCatalog<T>({
  prefix,
  rootTestId,
  title,
  description,
  eyebrow,
  headerActions,
  notices,
  status,
  rows,
  keyOf,
  searchTextOf,
  tagsOf,
  renderCard,
  cardTestId,
  onRefresh,
  emptyState,
  searchPlaceholder = "按名字或标识搜索…",
  selectedKey,
  onSelect,
  detailTitle,
  detailSubtitle,
  renderDetail,
  detailFooter,
  detailWidth = "md",
  detailTestId,
  children,
  className,
}: EntityCatalogProps<T>) {
  const [query, setQuery] = React.useState("");
  const [activeTags, setActiveTags] = React.useState<ReadonlySet<string>>(() => new Set());

  // 标签汇总基于全部行——见文件头「数量不受搜索词与已选标签影响」。
  const tagIndex = React.useMemo(() => {
    const index = new Map<string, { label: string; count: number }>();
    for (const row of rows) {
      for (const tag of tagsOf(row)) {
        const cur = index.get(tag.key);
        if (cur) cur.count += 1;
        else index.set(tag.key, { label: tag.label, count: 1 });
      }
    }
    return index;
  }, [rows, tagsOf]);

  // 已选标签在当前行里已经不存在（换组织 / 刷新后）时自动摘掉，
  // 否则一个看不见的筛选条件会把列表悄悄筛空。
  const effectiveTags = React.useMemo(() => {
    const kept = new Set<string>();
    for (const key of activeTags) if (tagIndex.has(key)) kept.add(key);
    return kept;
  }, [activeTags, tagIndex]);

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    return rows.filter((row) => {
      if (trimmedQuery !== "" && !searchTextOf(row).toLowerCase().includes(trimmedQuery)) return false;
      if (effectiveTags.size === 0) return true;
      const own = new Set(tagsOf(row).map((t) => t.key));
      for (const key of effectiveTags) if (!own.has(key)) return false;
      return true;
    });
  }, [rows, trimmedQuery, effectiveTags, searchTextOf, tagsOf]);

  const selectedRow = React.useMemo(
    () => (selectedKey === null ? null : (rows.find((row) => keyOf(row) === selectedKey) ?? null)),
    [rows, selectedKey, keyOf],
  );

  const filterActive = trimmedQuery !== "" || effectiveTags.size > 0;
  const loading = status.kind === "loading";

  function toggleTag(key: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid={rootTestId ?? `${prefix}-catalog`}>
      {eyebrow}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-20 font-semibold tracking-tight">{title}</h1>
            {status.kind === "ready" && (
              <span className="text-12 text-muted-foreground" data-testid={`${prefix}-count`}>
                {filterActive ? `共 ${rows.length} 个 · 筛选后 ${filtered.length} 个` : `共 ${rows.length} 个`}
              </span>
            )}
          </div>
          {description && <p className="text-13 text-muted-foreground">{description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {headerActions}
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={loading}
            data-testid={`${prefix}-refresh`}
          >
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            {loading ? "加载中…" : "刷新"}
          </Button>
        </div>
      </header>

      {notices}

      <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-panel p-3">
        <label className="relative flex items-center">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            className="pl-8"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={`搜索${title}`}
            data-testid={`${prefix}-search`}
          />
        </label>
        {tagIndex.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid={`${prefix}-tag-filters`}>
            <span className="text-9 font-semibold uppercase tracking-wider text-muted-foreground">标签</span>
            <Button
              size="xs"
              variant={effectiveTags.size === 0 ? "primary" : "outline"}
              aria-pressed={effectiveTags.size === 0}
              onClick={() => setActiveTags(new Set())}
              data-testid={`${prefix}-tag-filter-all`}
            >
              全部
            </Button>
            {[...tagIndex.entries()].map(([key, { label, count }]) => {
              const on = effectiveTags.has(key);
              return (
                <Button
                  key={key}
                  size="xs"
                  variant={on ? "primary" : "outline"}
                  aria-pressed={on}
                  onClick={() => toggleTag(key)}
                  data-testid={`${prefix}-tag-filter-${key}`}
                >
                  {label} {count}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {status.kind === "loading" && (
        <div
          data-testid={`${prefix}-loading`}
          className="rounded-card border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          正在读取当前组织的{title}…
        </div>
      )}

      {status.kind === "error" && (
        <div
          className="flex flex-col items-start gap-3 rounded-card border border-destructive/30 bg-destructive/5 p-4"
          role="alert"
        >
          <p data-testid={`${prefix}-error`} className="text-12 text-destructive">
            {title}读取失败：{status.message}
          </p>
          <Button size="sm" variant="outline" onClick={onRefresh} data-testid={`${prefix}-retry`}>
            重试
          </Button>
        </div>
      )}

      {status.kind === "ready" && rows.length === 0 && (
        <div
          data-testid={`${prefix}-empty`}
          className="rounded-card border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          {emptyState}
        </div>
      )}

      {status.kind === "ready" && rows.length > 0 && filtered.length === 0 && (
        // 筛空 ≠ 组织里没有——用不同的空态文案，别让人以为要去新建一个。
        <div
          data-testid={`${prefix}-no-match`}
          className="flex flex-col gap-1 rounded-card border border-dashed border-border p-6"
        >
          <p className="text-13 font-medium">没有匹配当前搜索 / 标签的{title}</p>
          <p className="text-11 text-muted-foreground">共 {rows.length} 个，清空搜索框或标签就能看到全部。</p>
        </div>
      )}

      {status.kind === "ready" && filtered.length > 0 && (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 items-start"
          data-testid={`${prefix}-list`}
        >
          {filtered.map((row) => {
            const key = keyOf(row);
            const selected = key === selectedKey;
            return (
              <Card
                key={key}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={() => onSelect(key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(key);
                  }
                }}
                className={cn(
                  "cursor-pointer transition-shadow duration-base hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "ring-2 ring-ring",
                )}
                data-testid={cardTestId ? cardTestId(row) : `${prefix}-row-${key}`}
                data-selected={selected ? "true" : undefined}
              >
                {renderCard(row)}
              </Card>
            );
          })}
        </div>
      )}

      {selectedRow !== null && (
        <AdminDrawer
          testid={detailTestId ?? `${prefix}-detail`}
          title={detailTitle(selectedRow)}
          subtitle={detailSubtitle?.(selectedRow)}
          width={detailWidth}
          onClose={() => onSelect(null)}
          footer={detailFooter?.(selectedRow)}
        >
          {renderDetail(selectedRow)}
        </AdminDrawer>
      )}

      {children}
    </div>
  );
}

/**
 * 契约里的中文枚举值 → 进 testid 的英文 slug。中文直接拼进 `data-testid` 断言起来不稳
 * （转义 / 输入法都麻烦，同 `skill-catalog-live.tsx` 从前的 `TagFilterChip.slug`）。
 * 没收录的值退化成码位串，仍然唯一、仍然是 ASCII——只是不好读，收录进来就好。
 */
const TAG_SLUGS: Readonly<Record<string, string>> = {
  // 可见范围 / 授权范围
  "org-wide": "org-wide", "team-only": "team-only",
  "全组织可用": "org-wide", "仅某组": "team-only",
  "全体成员": "all-members", "仅某团队": "team", "仅项目负责人": "lead", "需人工确认每次": "confirm-each", "未开放": "closed",
  // 状态类
  "草稿": "draft", "待审核": "pending-review", "被退回": "rejected", "已启用": "enabled", "已停用": "disabled",
  "运行中": "running", "待测试": "untested", "依赖失败": "dependency-failed",
  "待安全评审": "pending-security-review", "已放行": "cleared", "维持隔离": "isolated", "有条件放行": "conditional", "已到期待复核": "expired",
  "已连接": "connected", "限流中": "throttled", "已隔离": "quarantined", "不可达": "unreachable", "凭据失效": "auth-invalid",
  // 来源 / 种类
  "自建": "self-built", "晋升生成": "promoted", "CC": "cc",
  "closed-api": "closed-api", "self-hosted": "self-hosted",
  "内网": "intranet", "外网": "internet",
};

export function tagSlug(value: string): string {
  // `String()`：契约之外的脏数据（测试夹具少字段、后端漂移）不该让整个目录白屏。
  const text = String(value ?? "");
  const known = TAG_SLUGS[text];
  if (known) return known;
  if (/^[a-z0-9-]+$/i.test(text)) return text.toLowerCase();
  return `t-${[...text].map((c) => c.codePointAt(0)!.toString(16)).join("-")}`;
}

/** 大多数标签就是「枚举值本身当 label」：一行造出来。 */
export function tagOf(value: string, label: string = value): CatalogTag {
  return { key: tagSlug(value), label };
}

/** 卡片里的动作区：阻止冒泡，点按钮不顺带打开面板。 */
export function CardActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
