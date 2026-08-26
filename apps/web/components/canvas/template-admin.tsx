"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  LayoutGrid, List, Archive, RotateCcw, Rocket, Pencil, AlertTriangle, RefreshCw, Plus, Play, X,
  Search, FlaskConical,
} from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import type { ProjectRole } from "@/lib/identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import {
  archiveCanvasTemplate,
  createCanvasTemplate,
  listCanvasTemplates,
  mintCanvasTemplateVersion,
  publishCanvasTemplate,
  restoreCanvasTemplate,
  updateCanvasTemplateMetadata,
  TEMPLATE_FILTERS,
  TEMPLATE_STATUS_LABEL,
  TEMPLATE_VISIBILITY_LABEL,
  TEMPLATE_VISIBILITY_OPTIONS,
  type CanvasTemplate,
  type ListTemplatesFilter,
  type TemplateSection,
  type TemplateStatus,
  type TemplateVisibility,
} from "@/lib/live-canvas";
import { TemplateApplyDialog } from "./template-apply-dialog";
import { TemplateTrialDialog } from "./template-trial-dialog";
import { TemplateEditorPanel } from "./template-editor-panel";
import { TemplateA1Thumbnail } from "./template-a1-thumbnail";
import { TemplateTagInput } from "./template-tag-input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/**
 * UC-7.1 画布模板库（`/canvas?screen=template-admin`）。
 *
 * ⚠ 2026-08-15（人类直接裁决真合并，D-43，见 `phases/requirements/DECISIONS-FINAL.md`）：
 *   这条路由现在**也是**后台左栏「画布模板」的落点——`ADMIN_NAV` 的 `canvasadmin` 项 href
 *   直接指向这里，`/admin/canvasadmin`（原先只做清单 + 跳转链接的 `canvas-template-screen.tsx`）
 *   已退役为重定向。Q-11「后台这一项与这一屏是否合并」到此解除：不再是两处各画一半，
 *   这一屏就是唯一入口。
 *
 * #464 起这一屏只投影 `GET /canvas/templates` 的真实响应：browser → controller →
 * `application/canvas/list-templates` → `PgCanvasTemplateRepository` → PostgreSQL。
 *
 * ## 这一屏**去掉**了什么，以及为什么不是「功能倒退」
 *
 * · **七态预览壳（StateShell）**：加载中 / 空 / 失败三态现在由真实请求决定。
 *   一个能用 `?state=` 切出来的「失败态」和真实失败并存，会让人分不清屏上这句
 *   报错是后端说的还是 URL 说的。
 * · **mermaid 白名单开关**：契约有 `setMermaidWhitelist`，但 #463 的 controller
 *   没有挂这条路由。一块点了不落库的开关比没有它更糟——它看起来生效了。缺口已报。
 * · **mermaid 白名单开关** 同上，缺口已报。
 * · **试跑按钮**：`trialTemplate` 要一个 `projectId`，这一屏没有真实来源
 *   （项目选择器属 F102，后端也没有该路由）。接一半会得到一个「点了报 400」的按钮。
 *
 * ## 🟡 #496 补回来的两个入口
 *
 * · **「新建模板」**：#464 时这里逐字写着「契约里没有任何创建操作，留一个只弹 toast 的
 *   按钮就是在假装闭环成立」。#496 把 `createTemplate` 作为 design-delta 加进契约
 *   （**待人类补签**，见 `lib/live-canvas.ts` 与契约的文件头），于是这个按钮打的是真实端点。
 *   ⚠ 建出来的是**草稿**，界面上必须显示成草稿——把「建完」画成「能用了」，
 *     就是在前端把已签核的三段发布流程抹掉一段。
 * · **「发布」**：`publishTemplate.in` 要的 `visibility` 现在有真实来源了——
 *   **就是那一行自己的 `visibility`**（`listTemplates.out` 里逐字有这一栏）。
 *   #464 说它「没有真实来源」，那时属实：屏上一行草稿都不可能存在，因为没人建得出来。
 *   ⚠ 仍然**不做**「新建即发布」的复合按钮：服务端是两步，界面就是两步。
 *
 * ## 🟢 #493 补上的第三个入口：「使用」
 *
 * · **「使用」**：把一行 `published` 模板绑到某个工作坊当前进行中的议程环节
 *   （`POST /canvas/agenda-segments/:id/template-bindings`，PR #505 落的边界）。
 *   在它之前，这一屏上所有操作动的都是模板注册表**自己**，没有任何一条把模板用出去——
 *   核心闭环第 8c 步「在项目里真正使用一个模板」因此零覆盖。
 *   ⚠ 成功之后 `await load()` 重新读一次列表，让「被 N 场」那一格由服务端的
 *     `COUNT(*)` 重新算出来；**不**在本地把它加一（同下面 `create` 的理由）。
 *   对话框在 `template-apply-dialog.tsx`，环节的来源与缺口都写在它的文件头。
 *
 * ## 🟢 #988 补上的第四个入口：「基于此开新版」
 *
 * 「编辑」在本束的语义**不是**原地改一行——已发布/已归档的版本是不可变快照。点「基于此
 * 开新版」打开 `CreateDialog`（2026-08-23 起收窄成 mint 专用，见其自身文件头），
 * `key` 锁定不可改、其余字段预填自选中版本，提交调 `mintCanvasTemplateVersion`，
 * 产出 `version: N+1` 的新 `draft` 行。仅在该行 `status !== "draft"` 时出现
 * （`draft` 本身还没定稿，「新版本」对它没有意义，见 `design-signoff.md`「人类决定」①）。
 *
 * ⚠ `previewRole === "observer"` 时不挂写入口，那是**降噪不是权限**：
 *   真正的拒绝在服务端（`ROLE_INSUFFICIENT` → 403），失败信封原样回显。
 *
 * ## 🟢 2026-08-23 补上的第五、六个入口：「新建只问名字」+「编辑界面」
 *
 * 人类原话「新建画布，的时候，不要在这里放分区设计，也不要放key，只需要一个名字就
 * 可以，需要发布的生命周期的管理，所有的内容进入编辑的界面来管理」。`MinimalCreateDialog`
 * 只问显示名，`key` 由 `createMinimal` 从显示名 slugify（撞了自动换后缀重试），
 * `sections: []`、`visibility: "org-wide"` 都是默认——建完立刻打开 `TemplateEditorPanel`，
 * 分区/可见范围/生命周期动作都在那一个面板里管理。`updateTemplateDraft`（design-delta，
 * 待人类补签，见契约文件头）是这个面板唯一的内容写入口，只对仍是 `draft` 的行生效——
 * 已发布/已归档版本的不可变快照那条不变量**原样保留**，没有被这条新入口推翻。
 *
 * ## 2026-08-22 可用性改进轮（人类要求「提出 10 个改进可用性的地方，并实施」）
 *
 * 本屏当时被点名的问题是「模板一多就不好管」。这一轮实施的六项、全部前端内可独立完成、
 * 不改契约形状：
 *  ① **按名字/key 搜索**——`query` 状态，纯前端在当前筛选结果内再过滤一层。
 *  ② **同 key 多版本分组**——默认仍展示全部行（`tpladmin-card-*` 语义不变，
 *     `canvas-template-create-smoke.spec.ts` 的「reload 后 v1/v2 都在」断言压着这条），
 *     新增「只看每个 key 的当前版本」开关，默认关闭。
 *  ④ 「内置 · 不可删」→「内置模板」+ 一句通栏说明：**没有任何模板支持真删除**，
 *     这里的「归档」都是可逆置位（服务端唯一的硬删除码 `BUILTIN_TEMPLATE_UNDELETABLE`
 *     其实挡的是「归档」，不是字面意义的删除——原文案暗示别的模板能被删掉，不成立）。
 *  ⑥ **试跑真接上** —— `trialCanvasTemplate` 早已是真实路由（`trial-template.ts`），
 *     只是全仓零 UI 调用；`TemplateTrialDialog` 复用 `TemplateApplyDialog` 已验证过的
 *     「工作坊来源 = `listProjects`」模式补上这个入口。
 *  ⑧ **新建时的显示名重名提示**——契约只保证 key 唯一，显示名不唯一在服务端是合法状态；
 *     这里只是**软提示**（不阻断提交），且明确只扫得到当前已加载的行，不假装是全组织扫描。
 *  ⑨ **筛选 / 视图 / 搜索词写进 URL**——同这一屏已有的 `?screen=` 路由习惯一致，
 *     刷新、分享链接、浏览器前进后退都保留当前在看什么。
 *  ⑩ **分区 / 类型·可见性列不再在窄屏彻底消失**——原先 `lg:`/`md:` 断点下这两列整列隐藏、
 *     信息只是没了；现在窄屏下把它们收进「模板」列名字下方的一行小字，信息还在，只是换了位置。
 *
 * 另外两项（③「被 N 场」下钻到具体绑定列表、⑦ team-only 显示归属团队名）需要新增一个
 * 读接口 / 一个契约字段，不是纯前端能闭环的改动——按本仓契约先行的纪律，
 * 这两项**故意没有在这一轮做**，缺口已随实施 PR 报出，不在这里发明一个假读接口垫上。
 * 原始的「org-admin-only 权限判据前端投影用错了轴」的发现（`previewRole` 是项目角色、
 * 服务端判据是组织角色）也**没有在这一轮改**：`readOnly = previewRole === "observer"`
 * 是已签核、已测试（`canvas-template-live.test.tsx`「观察者视角不挂写入口」）的**降噪**
 * 设计，不是权限实现——真正的拒绝原样回显在 `actionError`。把它改成读 `orgRole` 会话字段
 * 是在没有人类重新签核的情况下推翻一条已落地决策，留给单独一次带签核的改动。
 */

const STATUS_TONE: Record<TemplateStatus, "primary" | "neutral" | "warning" | "outline"> = {
  published: "primary",
  draft: "warning",
  trial: "outline",
  archived: "neutral",
};

const FILTER_LABEL: Record<ListTemplatesFilter, string> = {
  all: "全部",
  published: "已发布",
  draft: "草稿",
  archived: "已归档",
};

type LoadState =
  | { readonly sourceKey: string; readonly status: "loading" }
  | { readonly sourceKey: string; readonly status: "error"; readonly message: string }
  | { readonly sourceKey: string; readonly status: "ready"; readonly rows: readonly CanvasTemplate[] };

/** 归档确认框的内容**全部**来自 `confirmed:false` 的真实预检，没有前端缺省值。 */
interface ArchivePreflight {
  readonly row: CanvasTemplate;
  readonly stillBoundSegmentCount: number;
}

/** `filter`/`view` 从 URL 读到的初值——不是合法档位就退回默认，不让一个坏链接空白页。 */
function parseInitialFilter(raw: string | undefined): ListTemplatesFilter {
  return (TEMPLATE_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as ListTemplatesFilter)
    : "all";
}
export function TemplateAdmin({
  previewRole, initialFilter, initialQuery,
}: {
  previewRole: ProjectRole | null;
  /** #9：`/canvas?screen=template-admin&filter=...&view=...&q=...` 的初值，见 `canvas/page.tsx`。 */
  initialFilter?: string;
  initialQuery?: string;
}) {
  const { session } = useSession();
  if (!session) throw new Error("TemplateAdmin requires an authenticated session");
  const orgId = session.currentOrgId;
  const router = useRouter();

  const [filter, setFilterState] = React.useState<ListTemplatesFilter>(() => parseInitialFilter(initialFilter));
  const [query, setQueryState] = React.useState(initialQuery ?? "");
  /** #2：默认展示每个 key 的**全部**版本（既有行为，e2e 依赖它）；开着才折叠成每 key 一行。 */
  const [latestOnly, setLatestOnly] = React.useState(false);

  /**
   * #9：三个筛选态每变一次就把当前地址栏的 query string 换成新值——`router.replace`
   * 不留历史记录（`scroll:false`）。⚠ 只在浏览器里执行（`window` 存在时）：
   * 服务端渲染这一步不需要，且 `window.location.search` 本来就是浏览器专属状态。
   */
  const syncUrl = React.useCallback((next: { filter?: ListTemplatesFilter; q?: string }) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const nextFilter = next.filter ?? filter;
    const nextQuery = next.q ?? query;
    if (nextFilter === "all") params.delete("filter"); else params.set("filter", nextFilter);
    if (nextQuery.trim() === "") params.delete("q"); else params.set("q", nextQuery);
    // 2026-08-26：`view` 不再进 URL——模板库只有卡片网格这一种形态
    //（`Design.pdf` §3「主体为三列卡片网格」，表格视图已整个撤掉）。
    //   旧链接里残留的 `?view=list` 会被这里清掉，不会渲染出一个已经不存在的视图。
    params.delete("view");
    const qs = params.toString();
    router.replace(qs.length > 0 ? `?${qs}` : "?", { scroll: false });
  }, [filter, query, router]);

  const setFilter = React.useCallback((f: ListTemplatesFilter) => {
    setFilterState(f);
    syncUrl({ filter: f });
  }, [syncUrl]);
  const setQuery = React.useCallback((q: string) => {
    setQueryState(q);
    syncUrl({ q });
  }, [syncUrl]);

  const sourceKey = `${orgId}:${filter}`;
  const generation = React.useRef(0);
  const currentSourceKey = React.useRef(sourceKey);
  currentSourceKey.current = sourceKey;

  const [state, setState] = React.useState<LoadState>({ sourceKey, status: "loading" });
  const [archiving, setArchiving] = React.useState<ArchivePreflight | null>(null);
  const [creating, setCreating] = React.useState(false);
  /** #988：正在被「基于此开新版」的那一行。null = 对话框没开。 */
  const [minting, setMinting] = React.useState<CanvasTemplate | null>(null);
  /** #493：正在被「使用」的那一行。null = 对话框没开。 */
  const [applying, setApplying] = React.useState<CanvasTemplate | null>(null);
  /** #6：正在被「试跑」的那一行。null = 对话框没开。 */
  const [trialing, setTrialing] = React.useState<CanvasTemplate | null>(null);
  /**
   * 2026-08-23：正在被「编辑/查看」的那一行——`TemplateEditorPanel`，本屏「所有内容
   * 进入编辑的界面来管理」这句话唯一的落点。null = 面板没开。
   */
  const [editing, setEditing] = React.useState<CanvasTemplate | null>(null);
  /** R2：正在被「改名 / 标签」的那一行。null = 对话框没开。 */
  const [renaming, setRenaming] = React.useState<CanvasTemplate | null>(null);
  /**
   * R2：卡片上正在就地二次确认归档的那一行（`"<key>-<version>"`）。
   * 只用于 draft/trial——published 走 `openArchive` 的真实预检流程，见卡片上的注释。
   */
  const [confirmingArchive, setConfirmingArchive] = React.useState<string | null>(null);
  /**
   * R2：标签筛选（`Design.pdf` §3.2）。`""` = 「全部」。**单选**：点一次筛选，
   * 再点同一个取消——不是多选交集，那不是设计稿要的东西。
   */
  const [tagFilter, setTagFilter] = React.useState("");
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (currentSourceKey.current !== sourceKey) return;
    const request = ++generation.current;
    setState({ sourceKey, status: "loading" });
    try {
      const out = await listCanvasTemplates({ orgId, filter });
      if (request !== generation.current || currentSourceKey.current !== sourceKey) return;
      setState({ sourceKey, status: "ready", rows: out.templates });
    } catch (error) {
      if (request !== generation.current || currentSourceKey.current !== sourceKey) return;
      // 失败**不得**退化成空列表：那会把「读不到」画成「一个模板都没有」。
      setState({ sourceKey, status: "error", message: describeError(error) });
    }
  }, [filter, orgId, sourceKey]);

  React.useEffect(() => {
    setArchiving(null);
    setCreating(false);
    setMinting(null);
    setApplying(null);
    setEditing(null);
    setRenaming(null);
    setConfirmingArchive(null);
    setTagFilter("");
    setActionError(null);
    setNotice(null);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  // 换组织/换筛选时，渲染期就失效上一批行：effect 在 paint 之后跑，
  // 只靠它会让新条件下短暂显示旧条件的结果。
  const visibleState: LoadState = React.useMemo(
    () => (state.sourceKey === sourceKey ? state : { sourceKey, status: "loading" }),
    [state, sourceKey],
  );
  // ⚠ `useMemo` 而不是裸三元：下面 `tagCounts` 的 `useMemo` 依赖它，而
  //   `status !== "ready"` 分支每次渲染都会产出一个**新的空数组**，让那个 memo
  //   永远失效（eslint react-hooks/exhaustive-deps 正是报的这个）。
  const allRows = React.useMemo(
    () => (visibleState.status === "ready" ? visibleState.rows : []),
    [visibleState],
  );
  const readOnly = previewRole === "observer";

  // #1：搜索按名字/key，纯前端在当前状态筛选结果内再过滤一层——不额外发请求，
  // 服务端的 `filter` 仍是唯一的状态筛选真相源，这里只加一层文本匹配。
  const trimmedQuery = query.trim().toLowerCase();
  const textMatched = trimmedQuery === ""
    ? allRows
    : allRows.filter((t) => t.displayName.toLowerCase().includes(trimmedQuery) || t.key.toLowerCase().includes(trimmedQuery));

  /**
   * R2（`Design.pdf` §3.2）：筛选条的标签**由现有模板的 tags 汇总得到**，不是写死的
   * 枚举，每个标签后跟使用数量。计数基于当前状态筛选下的全部行（`allRows`），不受
   * 搜索词与标签筛选本身影响——否则点了一个标签之后其它标签的计数会跟着变，
   * 使用者看到的是"这个标签在当前结果里有几个"而不是"这个标签有几个模板在用"。
   */
  const tagCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of allRows) {
      for (const tag of tagsOf(t)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return counts;
  }, [allRows]);

  const queried = tagFilter === ""
    ? textMatched
    : textMatched.filter((t) => tagsOf(t).includes(tagFilter));

  // #2：`latestOnly` 开着时，每个 key 只留一行——优先已发布，其次试跑，其次草稿，
  // 最后已归档；同优先级取版本号最大的那个。**不**丢弃其它版本的数据，只是不渲染，
  // 关掉开关立刻能看到全部——不是一次不可逆的「删掉旧版本」。
  const STATUS_PRIORITY: Record<TemplateStatus, number> = { published: 0, trial: 1, draft: 2, archived: 3 };
  const rows = !latestOnly ? queried : (() => {
    const byKey = new Map<string, CanvasTemplate>();
    for (const t of queried) {
      const cur = byKey.get(t.key);
      if (!cur) { byKey.set(t.key, t); continue; }
      const curRank = STATUS_PRIORITY[cur.status];
      const nextRank = STATUS_PRIORITY[t.status];
      if (nextRank < curRank || (nextRank === curRank && t.version > cur.version)) byKey.set(t.key, t);
    }
    return queried.filter((t) => byKey.get(t.key) === t);
  })();
  const hiddenVersionCount = queried.length - rows.length;

  async function openArchive(row: CanvasTemplate) {
    setActionError(null);
    setNotice(null);
    try {
      const out = await archiveCanvasTemplate({ key: row.key, version: row.version, confirmed: false });
      setArchiving({ row, stillBoundSegmentCount: out.stillBoundSegmentCount });
    } catch (error) {
      // 预检失败就**不开**确认框：一个数字来路不明的确认框比没有确认框更危险。
      setArchiving(null);
      setActionError(describeError(error));
    }
  }

  async function confirmArchive(preflight: ArchivePreflight) {
    setActionError(null);
    try {
      await archiveCanvasTemplate({ key: preflight.row.key, version: preflight.row.version, confirmed: true });
      setArchiving(null);
      setNotice(`已归档 ${preflight.row.displayName} v${preflight.row.version}`);
      await load();
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  /**
   * 2026-08-23——人类原话「新建画布，的时候，不要在这里放分区设计，也不要放key，
   * 只需要一个名字就可以，需要发布的生命周期的管理，所有的内容进入编辑的界面来管理」。
   *
   * `key` 不再由使用者填，从显示名 slugify 而来，撞了（`TEMPLATE_KEY_CONFLICT`，理论上
   * 概率极低——slug 后面带一段随机后缀）就换一段随机后缀重试，重试仍失败才把错误摆出来
   * 让使用者自己决定（几乎不会走到这一步）。`sections: []`、`visibility: "org-wide"`
   * 都是空/默认——真正的内容在建出来之后打开 `TemplateEditorPanel` 去定。
   *
   * ⚠ 成功之后 `await load()` 重读列表，不把新行拼进本地 state——同 #496 原有的理由。
   *   建完**立刻打开编辑面板**（不是像旧版那样只是关掉对话框）：新建出来的草稿零分区，
   *   界面上啥都没有才是「建完了」的真实样子，直接把使用者带到能填内容的地方去。
   */
  const MAX_KEY_RETRIES = 5;
  async function createMinimal(displayName: string, tags: readonly string[]): Promise<void> {
    setActionError(null);
    setNotice(null);
    const trimmed = displayName.trim();
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt += 1) {
      const key = slugifyTemplateKey(trimmed);
      try {
        const out = await createCanvasTemplate({
          key,
          displayName: trimmed,
          underlyingType: "canvas",
          sections: [],
          visibility: "org-wide",
          tags: [...tags],
        });
        setCreating(false);
        setNotice(`已新建草稿 ${out.displayName} v${out.version} —— 还需发布才能被环节使用`);
        await load();
        // 立刻打开编辑面板——`usageCount` 恒为 0（刚造出来的行不可能已被绑定），
        // `title`/`footer` 恒为空串（`createTemplate` 不收装帧，新模板还没起标题）。
        setEditing({ ...out, usageCount: 0, title: "", footer: "" });
        return;
      } catch (error) {
        lastError = error;
        if (!(error instanceof ApiError) || error.reasonCode !== "TEMPLATE_KEY_CONFLICT") throw error;
        // key 撞了——换一段随机后缀重试，使用者从头到尾看不到这次冲突。
      }
    }
    throw lastError;
  }

  /**
   * R2（2026-08-25）：「改名 / 标签」——`Design.pdf` §3.1 卡片上的次级动作，
   * 「保存只改元数据，不动字段与画布」。走 `updateTemplateMetadata`（任意状态可改，
   * `sections` 压根不在那条路由的入参里），不是 `updateTemplateDraft`。
   *
   * ⚠ 同其余写操作：成功后 `await load()` 重读列表，不把改动拼进本地 state。
   */
  async function renameTemplate(row: CanvasTemplate, displayName: string, tags: readonly string[]): Promise<void> {
    setActionError(null);
    setNotice(null);
    const out = await updateCanvasTemplateMetadata({
      key: row.key,
      version: row.version,
      displayName: displayName.trim(),
      tags: [...tags],
    });
    setRenaming(null);
    setNotice(`已更新「${out.displayName}」的名称与标签`);
    await load();
  }

  /**
   * R2：卡片上「归档」的就地确认路径——**只给 draft/trial**。
   *
   * 不走 `openArchive` 的 `confirmed:false` 预检，是因为那次预检问的是「还有几个
   * 议程环节绑着它」，而绑定只接受 published（`domain/canvas/segment-binding.ts`）——
   * draft/trial 的答案恒为 0，多打一次往返只是为了拿一个已知的常数。
   * ⚠ 服务端仍然会做它自己的判断，这里只是不为一个必然为 0 的数字问一次。
   */
  async function archiveDirect(row: CanvasTemplate): Promise<void> {
    setActionError(null);
    setNotice(null);
    try {
      await archiveCanvasTemplate({ key: row.key, version: row.version, confirmed: true });
      setNotice(`已归档 ${row.displayName} v${row.version} —— 归档是可逆置位，在「已归档」里随时可恢复`);
      await load();
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  /**
   * #988。「基于此开新版」——本束「编辑」的真实语义。`key` 锁定为来源版本的 key，
   * 服务端算出 `version = max(该 key 当前版本) + 1`，其余字段来自这次对话框提交的值
   * （预填自来源版本，可编辑）。
   *
   * ⚠ 同 `create`：成功后 `await load()` 重读列表，不把新行拼进本地 state。
   */
  async function mintVersion(sourceKey: string, draft: NewTemplateDraft) {
    setActionError(null);
    setNotice(null);
    const out = await mintCanvasTemplateVersion({
      key: sourceKey,
      displayName: draft.displayName.trim(),
      underlyingType: draft.underlyingType.trim(),
      sections: draft.sections,
      visibility: draft.visibility,
    });
    setMinting(null);
    setNotice(`已基于 v${minting?.version ?? "?"} 新建草稿 ${out.displayName} v${out.version} —— 还需发布才能被环节使用`);
    await load();
  }

  /**
   * 🟡 #496。`visibility` 取**那一行自己的**，不是界面上另挑一个：
   * 让用户在发布时二选一，等于给同一个事实开了第二个入口，而那一栏本来就在行上。
   */
  async function publish(row: CanvasTemplate) {
    setActionError(null);
    setNotice(null);
    try {
      const out = await publishCanvasTemplate({
        key: row.key,
        version: row.version,
        visibility: row.visibility,
      });
      const archived = out.archivedVersions.length;
      setNotice(
        `已发布 ${row.displayName} v${row.version}` +
        (archived > 0 ? ` · 同 key 的 ${archived} 个旧版已自动归档` : ""),
      );
      await load();
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  /**
   * #493 —— 「使用一个模板」成功之后。
   *
   * ⚠ `await load()` 而不是把 `usageCount` 在本地加一：那一行看起来与真的一模一样，
   *   而「绑定到底进没进库」正是核心闭环第 8c 步唯一要证明的事（同 `create` 那段）。
   *   界面上那个「被 N 场」是服务端现查的 `COUNT(*) FROM canvas_template_bindings`
   *   （迁移 20260805030000：本表没有可写的计数列），所以它涨了 = 库里真多了一行。
   */
  async function applied(message: string) {
    setApplying(null);
    setActionError(null);
    setNotice(message);
    await load();
  }

  /** #6：「试跑」成功之后——同 `applied`，`await load()` 重读列表，不本地把 status 改成 "trial"。 */
  async function trialed(message: string) {
    setTrialing(null);
    setActionError(null);
    setNotice(message);
    await load();
  }

  async function restore(row: CanvasTemplate) {
    setActionError(null);
    setNotice(null);
    try {
      const out = await restoreCanvasTemplate({ key: row.key, version: row.version });
      setNotice(`已恢复 ${row.displayName} v${row.version} → ${TEMPLATE_STATUS_LABEL[out.status]}`);
      await load();
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  return (
    <div className="flex h-full flex-col" data-testid="tpladmin-root">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-14 font-semibold tracking-tight">画布模板库</h1>
          <p className="text-11 text-muted-foreground">
            组织 {orgId}
            {visibleState.status === "ready" && (
              trimmedQuery === "" && !latestOnly
                ? ` · 当前筛选下 ${rows.length} 个`
                : ` · 当前筛选下 ${queried.length} 个，展示 ${rows.length} 个`
            )}
          </p>
          {/*
            #4：原来只有内置模板那一行写「不可删」，暗示别的模板真能被删掉——不成立。
            契约里没有任何 `deleteTemplate` 操作（全仓 grep 零命中），能做到的最接近的事
            是「归档」，且归档是可逆置位（O-10，见 `ArchiveDialog`），不是删除。
            这句话放在页头、对全部模板都成立，不重复放进每一行。
          */}
          <p className="text-9 text-muted-foreground">
            没有任何画布模板支持永久删除——「归档」是可逆置位，随时可「恢复」。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <Button size="sm" variant="primary" onClick={() => { setCreating(true); setActionError(null); }} data-testid="tpladmin-create">
              <Plus aria-hidden className="h-3.5 w-3.5" /> 新建模板
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load()}
            disabled={visibleState.status === "loading"}
            data-testid="tpladmin-refresh"
          >
            <RefreshCw aria-hidden className="h-3.5 w-3.5" /> 刷新
          </Button>
        </div>
      </header>

      {notice && (
        <p className="border-b border-border bg-muted px-4 py-1.5 text-11 text-muted-foreground" data-testid="tpladmin-notice">
          {notice}
        </p>
      )}
      {actionError && (
        <p
          className="border-b border-destructive/40 bg-destructive/5 px-4 py-1.5 text-11 text-destructive"
          data-testid="tpladmin-action-error"
          role="alert"
        >
          操作被服务端拒绝：{actionError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-panel px-4 py-2">
        <div className="flex items-center gap-1" role="tablist" aria-label="按状态筛选">
          {TEMPLATE_FILTERS.map((f) => (
            <Button
              key={f}
              size="xs"
              variant={filter === f ? "primary" : "ghost"}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              data-testid={`tpladmin-filter-${f}`}
            >
              {FILTER_LABEL[f]}
            </Button>
          ))}
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          {/* #1：按名字/key 搜索——纯前端过滤，见 rows 派生处的注释。 */}
          <label className="relative flex min-w-0 max-w-64 flex-1 items-center">
            <Search aria-hidden className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-12"
              placeholder="按名字或 key 搜索…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="按名字或 key 搜索模板"
              data-testid="tpladmin-search"
            />
          </label>
          {/* #2：默认关闭——关闭时展示的行集合与本次改动之前完全一致。 */}
          <Button
            size="xs"
            variant={latestOnly ? "primary" : "outline"}
            aria-pressed={latestOnly}
            onClick={() => setLatestOnly((v) => !v)}
            data-testid="tpladmin-latest-only-toggle"
            title="每个 key 只显示一个最有代表性的版本（优先已发布），其余版本仍在库里、随时切回来看"
          >
            只看每个模板的当前版本
          </Button>
        </div>
      </div>
      {latestOnly && hiddenVersionCount > 0 && (
        <p className="border-b border-border-subtle bg-panel px-4 py-1 text-10 text-muted-foreground" data-testid="tpladmin-latest-only-note">
          已折叠 {hiddenVersionCount} 个非当前版本 —— 它们仍在库里，关掉上面的开关就能看到。
        </p>
      )}

      {/*
        R2（`Design.pdf` §3.2）：标签筛选条。标签由现有模板的 tags 实时汇总（不是写死
        枚举），每个后跟使用数量；单选，点同一个再取消。零标签时整条不渲染——一个恒空
        的筛选条只是噪音。
      */}
      {tagCounts.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle bg-panel px-4 py-2"
          data-testid="tpladmin-tag-filters"
        >
          <span className="text-9 font-semibold uppercase tracking-wider text-muted-foreground">标签</span>
          <Button
            size="xs"
            variant={tagFilter === "" ? "primary" : "outline"}
            aria-pressed={tagFilter === ""}
            onClick={() => setTagFilter("")}
            data-testid="tpladmin-tag-filter-all"
          >
            全部
          </Button>
          {[...tagCounts.entries()].map(([tag, count]) => (
            <Button
              key={tag}
              size="xs"
              variant={tagFilter === tag ? "primary" : "outline"}
              aria-pressed={tagFilter === tag}
              onClick={() => setTagFilter(tagFilter === tag ? "" : tag)}
              data-testid={`tpladmin-tag-filter-${tag}`}
            >
              {tag} {count}
            </Button>
          ))}
        </div>
      )}
      {tagFilter !== "" && rows.length === 0 && allRows.length > 0 && (
        <p className="border-b border-border-subtle bg-panel px-4 py-1 text-10 text-muted-foreground" data-testid="tpladmin-tag-filter-empty">
          这个标签下还没有模板 —— 换个标签，或新建一个。
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {visibleState.status === "loading" && (
          <p className="text-12 text-muted-foreground" data-testid="tpladmin-loading">正在读取模板注册表…</p>
        )}

        {visibleState.status === "error" && (
          <div
            className="flex flex-col items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
            data-testid="tpladmin-error"
            role="alert"
          >
            <p className="text-13 font-medium text-destructive">读取模板注册表失败</p>
            <p className="font-mono text-11 text-destructive">{visibleState.message}</p>
            <Button size="xs" variant="outline" onClick={() => void load()} data-testid="tpladmin-retry">重试</Button>
          </div>
        )}

        {visibleState.status === "ready" && rows.length === 0 && allRows.length > 0 && (
          // #1：搜不到 ≠ 组织里没有模板——用不同的空态文案，别让用户以为要去新建一个。
          <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-6" data-testid="tpladmin-search-empty">
            <p className="text-13 font-medium">没有名字或 key 匹配「{query.trim()}」的模板</p>
            <p className="text-11 text-muted-foreground">
              当前筛选下共有 {allRows.length} 个模板，清空搜索框可以看到全部。
            </p>
          </div>
        )}

        {visibleState.status === "ready" && allRows.length === 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-6" data-testid="tpladmin-empty">
            <p className="text-13 font-medium">当前筛选下没有画布模板</p>
            <p className="text-11 text-muted-foreground">
              这是本组织在服务端的真实结果 —— 这里不会出现任何示例模板。
              用右上角的「新建模板」建一个草稿，再发布它。
            </p>
          </div>
        )}

        {visibleState.status === "ready" && rows.length > 0 && (
            /*
              R2（`Design.pdf` §3.1「卡片」）：自上而下 A1 缩略图 → 模板名 + 状态徽章
              → 一句描述 → 标签胶囊 → 「N 个字段 · M 个区块 · A1 横版」+ 操作区。
              点卡片主体 = 打开编辑器；两个次级动作（改名/标签、归档）都必须
              `stopPropagation`，不得顺带触发打开编辑器。
            */
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="tpladmin-cards">
              {rows.map((t) => (
                <Card
                  key={`${t.key}-${t.version}`}
                  className="cursor-pointer overflow-hidden transition-shadow duration-base hover:shadow-md"
                  onClick={() => { setEditing(t); setActionError(null); setNotice(null); }}
                  data-testid={`tpladmin-card-${t.key}-${t.version}`}
                >
                  <CardContent className="flex flex-col gap-2 p-0">
                    <TemplateA1Thumbnail template={t} />
                    <div className="flex flex-col gap-1.5 px-3 pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-13 font-semibold">{t.displayName}</span>
                        <Badge tone={STATUS_TONE[t.status]}>{TEMPLATE_STATUS_LABEL[t.status]}</Badge>
                      </div>
                      <span className="text-11 leading-relaxed text-muted-foreground">{describeSections(t)}</span>
                      {tagsOf(t).length > 0 && (
                        <div className="flex flex-wrap gap-1" data-testid={`tpladmin-card-tags-${t.key}-${t.version}`}>
                          {tagsOf(t).map((tag) => (
                            <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-9 text-muted-foreground">{tag}</span>
                          ))}
                        </div>
                      )}
                      <span className="text-10 text-muted-foreground">
                        {/*
                          「N 个字段 · M 个区块」——字段数是分区总数，区块数是「已放到画布上」
                          的那些（`layout` 非空）。两个数不同才有信息量：它直接告诉使用者
                          「还有几个字段没排版，生成后会被丢弃」（`Design.pdf` §6 校验规则②）。
                        */}
                        {t.sections.length} 个字段 · {t.sections.filter((s) => s.layout != null).length} 个区块 · A1 横版
                        {t.builtin && " · 内置"}
                        {" · 被 "}
                        {/*
                          ⚠ 这一格随表格视图一起消失过一次（PR #2123），`core-loop.spec.ts`
                            第 8c 步当场红——它锚的就是这个 testid。撤掉一个视图时，**挂在
                            它上面的事实**要跟着搬到留下的那个视图上，不能跟着容器一起删：
                            「这个模板被几场会用着」是使用者决定要不要归档它的唯一依据，
                            与它显示在表格里还是卡片里无关。
                          ⚠ `usageCount` 契约逐字要求「真实统计，不得估算」（服务端现查
                            COUNT(*)，见 canvas_template_registry 迁移文件头）——这里
                            原样显示，不做任何"大于 99 显示 99+"之类的加工。
                        */}
                        <span data-testid={`canvas-template-usage-${t.key}-${t.version}`}>{t.usageCount}</span>
                        {" 场使用"}
                      </span>
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {!readOnly && (
                          <Button size="xs" variant="outline" onClick={() => { setRenaming(t); setActionError(null); setNotice(null); }} data-testid={`tpladmin-rename-${t.key}-${t.version}`}>
                            改名 / 标签
                          </Button>
                        )}
                        {/*
                          §3.1 卡片的第二个次级动作。设计稿写的是「删除 — 就地二次确认
                          （"删除？ 确认 / 取消"），不弹全屏对话框」。
                          ⚠ 语义是「归档」不是「删除」：契约里没有任何 `deleteTemplate`
                            操作（全仓 grep 零命中），能做到的最接近的事是归档——可逆
                            置位（O-10），归档后仍在「已归档」筛选里查得到、能恢复。
                            所以按钮就叫「归档」而不是「删除」：一个写着"删除"、
                            实际只是隐藏的按钮，是在骗使用者。位置与就地确认的交互
                            照设计稿实现，文案如实。
                          ⚠ 已发布版本走的仍是既有的 `openArchive` 预检流程（要先问
                            服务端「还有几个环节绑着它」），不能就地确认——那个数字
                            必须来自真实预检。这里的就地确认只给 draft/trial：
                            它们不可能已被绑定（绑定只接受 published）。
                        */}
                        {!readOnly && (t.status === "draft" || t.status === "trial") && (
                          confirmingArchive === `${t.key}-${t.version}` ? (
                            <span className="flex items-center gap-1.5" data-testid={`tpladmin-archive-confirm-${t.key}-${t.version}`}>
                              <span className="text-10 text-destructive">归档？</span>
                              <Button size="xs" variant="primary" className="bg-destructive" onClick={() => { setConfirmingArchive(null); void archiveDirect(t); }} data-testid={`tpladmin-archive-yes-${t.key}-${t.version}`}>
                                确认
                              </Button>
                              <Button size="xs" variant="outline" onClick={() => setConfirmingArchive(null)} data-testid={`tpladmin-archive-no-${t.key}-${t.version}`}>
                                取消
                              </Button>
                            </span>
                          ) : (
                            <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setConfirmingArchive(`${t.key}-${t.version}`)} data-testid={`tpladmin-card-archive-${t.key}-${t.version}`}>
                              归档
                            </Button>
                          )
                        )}
                        <RowActions row={t} readOnly={readOnly} onArchive={() => void openArchive(t)} onRestore={() => void restore(t)} onPublish={() => void publish(t)} onApply={() => { setApplying(t); setActionError(null); setNotice(null); }} onMintVersion={() => { setMinting(t); setActionError(null); setNotice(null); }} onTrial={() => { setTrialing(t); setActionError(null); setNotice(null); }} onEdit={() => { setEditing(t); setActionError(null); setNotice(null); }} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
        )}
      </div>

      {creating && (
        <MinimalCreateDialog onClose={() => setCreating(false)} onSubmit={createMinimal} knownTags={tagCounts} />
      )}

      {renaming && (
        // R2：改名 / 标签——与新建**同一个弹窗组件**（`Design.pdf` §3.1 原话），
        // 预填现有名称与标签，提交走 `updateTemplateMetadata`（只改元数据）。
        <MinimalCreateDialog
          renaming={renaming}
          knownTags={tagCounts}
          onClose={() => setRenaming(null)}
          onSubmit={(displayName, tags) => renameTemplate(renaming, displayName, tags)}
        />
      )}

      {minting && (
        <CreateDialog
          mintFrom={minting}
          onClose={() => setMinting(null)}
          onSubmit={(draft) => mintVersion(minting.key, draft)}
          existingNames={allRows.filter((t) => t.key !== minting.key).map((t) => t.displayName)}
        />
      )}

      {applying && (
        <TemplateApplyDialog
          template={applying}
          orgId={orgId}
          onClose={() => setApplying(null)}
          onApplied={applied}
        />
      )}

      {trialing && (
        <TemplateTrialDialog
          template={trialing}
          orgId={orgId}
          onClose={() => setTrialing(null)}
          onTrialed={trialed}
        />
      )}

      {editing && (
        <TemplateEditorPanel
          row={editing}
          readOnly={readOnly}
          onClose={() => setEditing(null)}
          onSaved={(message, updated) => {
            setNotice(message);
            setEditing(updated);
            return load();
          }}
          /*
           * ⚠ 发布/归档/恢复/试跑/开新版都会改变这一行的状态，而 `editing` 是面板打开
           *   那一刻的快照——继续开着只会显示过期状态。这四个动作各自打开自己的对话框
           *   / 直接落库，完成后都走既有的 `await load()` 刷新列表，所以这里统一先关掉
           *   面板，让使用者从刷新后的列表里看真相，而不是让面板里显示一个已经不对的
           *   `draft` 徽章。
           */
          onPublish={() => { setEditing(null); void publish(editing); }}
          onArchive={() => { setEditing(null); void openArchive(editing); }}
          onRestore={() => { setEditing(null); void restore(editing); }}
          onTrial={() => { setEditing(null); setTrialing(editing); setActionError(null); setNotice(null); }}
          onMintVersion={() => { setEditing(null); setMinting(editing); setActionError(null); setNotice(null); }}
        />
      )}

      {archiving && (
        <ArchiveDialog
          preflight={archiving}
          onClose={() => setArchiving(null)}
          onConfirm={() => void confirmArchive(archiving)}
        />
      )}
    </div>
  );
}

/**
 * 状态机的行操作。#6（2026-08-22）起「试跑」也真接了——`trialCanvasTemplate` 早就是
 * 真实路由，缺的只是一个能给它一个 `projectId` 的 UI，见 `template-trial-dialog.tsx`。
 */
function RowActions({
  row, readOnly, onArchive, onRestore, onPublish, onApply, onMintVersion, onTrial, onEdit,
}: {
  row: CanvasTemplate;
  readOnly: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onPublish: () => void;
  onApply: () => void;
  onMintVersion: () => void;
  onTrial: () => void;
  onEdit: () => void;
}) {
  if (readOnly) return <span className="text-10 text-muted-foreground">只读</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {/*
        2026-08-23：「所有的内容进入编辑的界面来管理」——draft 的「编辑」打开可写的
        `TemplateEditorPanel`；非 draft 内容不可变，同一个入口开成只读预览
        （`TemplateEditorPanel` 自己按 `row.status` 决定要不要禁用表单）。
      */}
      <Button size="xs" variant="outline" onClick={onEdit} data-testid={`tpladmin-edit-${row.key}-${row.version}`}>
        <Pencil aria-hidden className="h-3 w-3" /> {row.status === "draft" ? "编辑" : "查看"}
      </Button>
      {/*
        #493：只有 published 挂「使用」入口。绑定的判定只接受 published
        （`domain/canvas/segment-binding.ts`），给草稿也挂一个，点了必然拿到
        `TEMPLATE_ARCHIVED` —— 一个恒定失败的按钮比没有这个按钮更糟。
        ⚠ 这不是在前端复述那条判据：服务端仍然会拒（`TEMPLATE_ARCHIVED` 原样回显），
          这里只是不给一个必然被拒的动作留入口，同 `CreateDialog` 的 `canSubmit`。
      */}
      {row.status === "published" && (
        <Button size="xs" variant="primary" data-testid={`canvas-template-use-${row.key}-${row.version}`} onClick={onApply}>
          <Play aria-hidden className="h-3 w-3" /> 使用
        </Button>
      )}
      {(row.status === "draft" || row.status === "trial") && (
        // 🟡 #496：`visibility` 取这一行自己的那一栏，不在这里让用户再挑一次。
        <Button size="xs" variant="primary" data-testid={`tpladmin-publish-${row.key}-${row.version}`} onClick={onPublish}>
          <Rocket aria-hidden className="h-3 w-3" /> 发布（{TEMPLATE_VISIBILITY_LABEL[row.visibility]}）
        </Button>
      )}
      {row.status === "published" && (
        <Button size="xs" variant="ghost" className="text-destructive" data-testid={`tpladmin-archive-${row.key}-${row.version}`} onClick={onArchive}>
          <Archive aria-hidden className="h-3 w-3" /> 归档
        </Button>
      )}
      {row.status === "archived" && (
        <Button size="xs" variant="outline" data-testid={`tpladmin-restore-${row.key}-${row.version}`} onClick={onRestore}>
          <RotateCcw aria-hidden className="h-3 w-3" /> 恢复
        </Button>
      )}
      {row.status === "draft" && (
        <Button size="xs" variant="outline" data-testid={`tpladmin-trial-${row.key}-${row.version}`} onClick={onTrial}>
          <FlaskConical aria-hidden className="h-3 w-3" /> 试跑
        </Button>
      )}
      {/*
        #988：仅非 draft 才挂「基于此开新版」——draft 本身还没定稿，「新版本」对它没有
        意义（同 `design-signoff.md`「人类决定」①）。这是「编辑」在本束的真实入口：
        没有原地改，只有开新版。
      */}
      {row.status !== "draft" && (
        <Button size="xs" variant="outline" data-testid={`tpladmin-mint-version-${row.key}-${row.version}`} onClick={onMintVersion}>
          <Pencil aria-hidden className="h-3 w-3" /> 基于此开新版
        </Button>
      )}
    </div>
  );
}

/** 新建表单的本地草稿。契约 `createTemplate.in` 的五栏，一一对应。 */
interface NewTemplateDraft {
  readonly key: string;
  readonly displayName: string;
  readonly underlyingType: string;
  readonly visibility: TemplateVisibility;
  /** 契约 `createTemplate.in.sections` 是可变数组，端到端保持同一个类型，不在这里收紧。 */
  readonly sections: TemplateSection[];
}

/**
 * 2026-08-23——「新建」不再是这个组件的职责（人类原话「新建画布……只需要一个名字就
 * 可以……所有的内容进入编辑的界面来管理」，见 `MinimalCreateDialog` 与
 * `TemplateEditorPanel`）。本组件收窄成**只做「基于此开新版」**——`key` 恒锁定为来源
 * 版本的 key，`displayName`/`sections`/`visibility` 预填自来源版本、可编辑，提交调
 * `mintCanvasTemplateVersion` 产出下一个版本的草稿。
 *
 * ## 分区在这里预填，不是「只能在这里定」
 *
 * 旧版本这条注释说「分区结构只能在这里定」——不再成立：产出的新草稿之后还能在
 * `TemplateEditorPanel` 里继续改（`updateTemplateDraft`，2026-08-23 补上）。这里预填
 * 来源版本的分区只是给一个合理起点，不是「过了这一步就锁死」。
 *
 * ## 失败原样回显
 *
 * `TEAM_REQUIRED_FOR_TEAM_ONLY` 等码走 `describeCreateError`，与 `MinimalCreateDialog`
 * 共用同一段回显逻辑（同一份判据不写两遍）。
 */
function CreateDialog({
  mintFrom, onClose, onSubmit, existingNames = [],
}: {
  mintFrom: CanvasTemplate;
  onClose: () => void;
  onSubmit: (draft: NewTemplateDraft) => Promise<void>;
  /**
   * #8：已加载行里其它模板的显示名——契约只保证 `key` 唯一（`TEMPLATE_KEY_CONFLICT`），
   * 显示名重复在服务端是合法状态，所以这里只是**软提示**，不阻断 `canSubmit`。
   * ⚠ 只扫得到调用方**当前已加载**的行（受当前状态筛选影响），不是全组织的真扫描——
   *   提示文案如实说「当前列表里」，不冒充一个后端没做过的全局唯一性检查。
   */
  existingNames?: readonly string[];
}) {
  const [displayName, setDisplayName] = React.useState(mintFrom.displayName);
  const [visibility, setVisibility] = React.useState<TemplateVisibility>(mintFrom.visibility);
  const [sectionNames, setSectionNames] = React.useState<readonly string[]>(
    mintFrom.sections.length > 0 ? mintFrom.sections.map((s) => s.name) : [""],
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * 只在用户碰过显示名字段之后才提示它「必填」——刚打开对话框时一个空输入框就红，
   * 不是校验，是噪音。`onBlur` 才标记 touched，不是 `onChange`：那样每敲一个字符
   * 都会闪一下红边再消失。
   */
  const [nameTouched, setNameTouched] = React.useState(false);
  const nameMissing = nameTouched && displayName.trim().length === 0;
  // #8：软提示，不阻断提交——大小写/首尾空格不敏感地匹配，减少「同一个名字建了两遍」
  // 之后才在列表里发现分不清是哪个的情况。
  const nameDuplicate = nameTouched && displayName.trim().length > 0
    && existingNames.some((n) => n.trim().toLowerCase() === displayName.trim().toLowerCase());

  // 提交所需的最小集，与契约的 `.min(1)` 对齐 —— 但**不**在这里重述一份校验规则：
  // 真正的裁决在服务端，这里只是不让一个必然 400 的请求白跑一趟。
  const canSubmit = displayName.trim().length > 0 && !submitting;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        key: mintFrom.key,
        displayName,
        underlyingType: mintFrom.underlyingType,
        visibility,
        // 空名字的分区不提交：它不是一个分区，是一行没填的输入框。
        sections: sectionNames
          .map((name, i) => ({ name: name.trim(), order: i }))
          .filter((s) => s.name.length > 0)
          .map((s, i) => ({
            sectionId: `s${i + 1}`,
            name: s.name,
            order: i,
            required: false,
            // 契约的 `capacity` 可空，且「留白规则对 null 容量断言不出来」是已登记的
            // 待定项（D-a）。这里如实传 null，而不是替它挑一个上限。
            capacity: null,
          })),
      });
    } catch (e) {
      setError(describeCreateError(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-title"
      data-testid="tpladmin-mint-dialog"
    >
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <h2 id="create-title" className="text-14 font-semibold">
            基于「{mintFrom.displayName} v{mintFrom.version}」开新版
          </h2>
          <Button size="icon" variant="ghost" aria-label="关闭" onClick={onClose} data-testid="tpladmin-create-close">
            <X aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>

        <p className="rounded-md border border-warning/40 bg-warning/5 px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="tpladmin-create-draft-note">
          产出的是同一个 key 下的<strong className="text-background-foreground">下一个版本（草稿）</strong>，
          来源版本 v{mintFrom.version} <strong className="text-background-foreground">不受影响</strong>，
          要被议程环节使用还得再点一次「发布」。分区之后还能回到编辑界面继续改。
        </p>

        <label className="flex flex-col gap-1 text-11">
          <span className="text-muted-foreground">模板 key（开新版锁定为来源版本的 key，不可改）</span>
          <input
            className="rounded-md border border-border bg-disabled px-2 py-1.5 font-mono text-12 text-disabled-foreground"
            value={mintFrom.key}
            disabled
            data-testid="tpladmin-create-key"
          />
        </label>

        <label className="flex flex-col gap-1 text-11">
          <span className="text-muted-foreground">显示名</span>
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-12 aria-[invalid=true]:border-destructive"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => setNameTouched(true)}
            aria-invalid={nameMissing}
            data-testid="tpladmin-create-name"
          />
          {nameMissing && (
            <span className="text-10 text-destructive" data-testid="tpladmin-create-name-hint">必填</span>
          )}
          {!nameMissing && nameDuplicate && (
            // #8：软提示——`canSubmit` 不因此变 false，服务端本来就允许显示名重复。
            <span className="text-10 text-warning" data-testid="tpladmin-create-name-duplicate-hint">
              当前列表里已经有一个同名模板，确定要用一样的名字吗？（key 仍会保证唯一）
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-11">
          <span className="text-muted-foreground">可见范围</span>
          <select
            className="rounded-md border border-border bg-background px-2 py-1.5 text-12"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as TemplateVisibility)}
            data-testid="tpladmin-create-visibility"
          >
            {TEMPLATE_VISIBILITY_OPTIONS.map((v) => (
              <option key={v} value={v}>{TEMPLATE_VISIBILITY_LABEL[v]}</option>
            ))}
          </select>
          {visibility === "team-only" && (
            // C_CANVAS_8 ①：契约没有 `ownerTeamId`，服务端取创建者自己的团队。
            // 后果如实说，不在这里挑一个团队替用户决定。
            <span className="text-10 text-warning" data-testid="tpladmin-create-teamonly-note">
              归属团队取你自己的团队（契约里没有这一栏）。你若不属于任何团队，这个模板将对所有人不可见。
            </span>
          )}
        </label>

        <div className="flex flex-col gap-1" data-testid="tpladmin-create-sections">
          <span className="text-11 text-muted-foreground">分区（导出为 ## 段落；留空即零分区，之后仍可在编辑界面改）</span>
          {sectionNames.map((name, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-12"
                placeholder={`分区 ${i + 1}`}
                value={name}
                onChange={(e) => setSectionNames(sectionNames.map((n, j) => (j === i ? e.target.value : n)))}
                data-testid={`tpladmin-create-section-${i}`}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`删除分区 ${i + 1}`}
                onClick={() => setSectionNames(sectionNames.filter((_, j) => j !== i))}
                data-testid={`tpladmin-create-section-${i}-remove`}
              >
                <X aria-hidden className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button
            size="xs"
            variant="outline"
            className="self-start"
            onClick={() => setSectionNames([...sectionNames, ""])}
            data-testid="tpladmin-create-add-section"
          >
            <Plus aria-hidden className="h-3 w-3" /> 加一个分区
          </Button>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-11 text-destructive" role="alert" data-testid="tpladmin-create-error">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="tpladmin-create-cancel">取消</Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
            data-testid="tpladmin-mint-submit"
          >
            {submitting ? "正在新建版本…" : "新建版本"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 2026-08-23——「新建画布，的时候，不要在这里放分区设计，也不要放key，只需要一个
 * 名字就可以」（人类原话）。这个对话框**只问显示名**：`key` 由 `createMinimal`
 * 从显示名派生，`sections: []`、`visibility: "org-wide"` 都是空/默认——
 * 内容与可见范围之后在 `TemplateEditorPanel` 里定。
 */
function MinimalCreateDialog({ onClose, onSubmit, knownTags, renaming }: {
  onClose: () => void;
  /** 新建时只有名字+标签；改名时同样这两栏——`Design.pdf` §3.1「打开与新建同一个弹窗」。 */
  onSubmit: (displayName: string, tags: readonly string[]) => Promise<void>;
  /** `标签 → N 个模板在用`，由调用方从真实模板列表聚合（不是写死枚举）。 */
  knownTags: ReadonlyMap<string, number>;
  /**
   * 传了就是「改名 / 标签」模式（R2）：预填现有名称与标签，提交只改元数据、
   * 不动字段与画布（走 `updateTemplateMetadata`，见该契约操作文件头）。
   */
  renaming?: CanvasTemplate;
}) {
  const isRename = renaming !== undefined;
  const [displayName, setDisplayName] = React.useState(renaming?.displayName ?? "");
  const [tags, setTags] = React.useState<readonly string[]>(renaming ? tagsOf(renaming) : []);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);
  const nameMissing = touched && displayName.trim().length === 0;
  const canSubmit = displayName.trim().length > 0 && !submitting;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(displayName, tags);
    } catch (e) {
      setError(describeCreateError(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-title"
      data-testid="tpladmin-create-dialog"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <h2 id="create-title" className="text-14 font-semibold">
            {isRename ? "修改模板信息" : "新建画布模板"}
          </h2>
          <Button size="icon" variant="ghost" aria-label="关闭" onClick={onClose} data-testid="tpladmin-create-close">
            <X aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>

        <p className="rounded-md border border-warning/40 bg-warning/5 px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="tpladmin-create-draft-note">
          {isRename ? (
            <>只改<strong className="text-background-foreground">名称与标签</strong>，
            字段与画布内容<strong className="text-background-foreground">不受影响</strong>。</>
          ) : (
            <>建出来的是 <strong className="text-background-foreground">空白草稿</strong>，
            分区、可见范围都留到下一步的<strong className="text-background-foreground">编辑界面</strong>里定。</>
          )}
        </p>

        <label className="flex flex-col gap-1 text-11">
          <span className="text-muted-foreground">模板名称</span>
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-12 aria-[invalid=true]:border-destructive"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={nameMissing}
            autoFocus
            data-testid="tpladmin-create-name"
          />
          {nameMissing && (
            <span className="text-10 text-destructive" data-testid="tpladmin-create-name-hint">必填</span>
          )}
        </label>

        <div className="flex flex-col gap-1 text-11">
          <span className="text-muted-foreground">标签</span>
          <TemplateTagInput value={tags} onChange={setTags} knownTags={knownTags} testIdPrefix="tpladmin-create-tag" />
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-11 text-destructive" role="alert" data-testid="tpladmin-create-error">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="tpladmin-create-cancel">取消</Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
            data-testid="tpladmin-create-submit"
          >
            {submitting ? (isRename ? "正在保存…" : "正在新建…") : (isRename ? "保存" : "新建草稿")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 归档二次确认。影响面那个数来自本次预检，**不是**一个前端缺省值（O-10 ③）。 */
function ArchiveDialog({
  preflight, onClose, onConfirm,
}: { preflight: ArchivePreflight; onClose: () => void; onConfirm: () => void }) {
  const { row, stillBoundSegmentCount } = preflight;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-title"
      data-testid="tpladmin-archive-dialog"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-lg">
        <div className="flex items-start gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="flex flex-col gap-1">
            <h2 id="archive-title" className="text-14 font-semibold">归档「{row.displayName} v{row.version}」？</h2>
            <p className="text-12 text-muted-foreground">
              归档后它<strong className="text-background-foreground">从绑定选择器消失、不能再新增绑定</strong>；
              但<strong className="text-background-foreground">已建实例不被改动</strong>，
              已绑定该模板的议程环节现场触发时仍能成功实例化（O-10）。
            </p>
          </div>
        </div>
        <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5" data-testid="tpladmin-archive-impact">
          <p className="text-12 font-medium">影响范围（服务端预检结果）</p>
          <p className="text-11 text-muted-foreground">
            有 <strong className="text-background-foreground tabular-nums">{stillBoundSegmentCount}</strong> 个议程环节仍绑定此模板 · 被 {row.usageCount} 场使用
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="tpladmin-archive-cancel">取消</Button>
          <Button size="sm" variant="destructive" onClick={onConfirm} data-testid="tpladmin-archive-confirm">确认归档</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 2026-08-23——「新建」不再问使用者要 key，从显示名派生一个，带一段随机后缀避免撞车
 * （`createMinimal` 撞了会换一段重试，这个函数不用管重试，只管「生成一个大概率没人用过
 * 的 key」）。ASCII 之外的字符（中文模板名是常态）全部落到 fallback：一段纯随机字符串
 * ——比起把中文转拼音或干脆留中文在 key 里（key 契约上是自由字符串，允许，但用户看到的
 * `key vN` 那一列会因此长得五花八门、不像一个稳定标识符），一段短随机串更朴素诚实。
 */
function slugifyTemplateKey(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return base.length > 0 ? `${base}-${suffix}` : `tpl-${suffix}`;
}

/**
 * 一行的标签，**永远是数组**。
 *
 * 契约 `listTemplates.out.templates[].tags` 是必填数组，但这里仍然兜一层，理由是
 * **部署错位**：R2 的前端可能先于带 `tags` 的后端上线（本仓 web 与 api 是两次独立
 * 部署），那时候服务端回来的行没有这一栏，而 `for...of undefined` 会让整个模板库
 * 白屏——一个还没上线的新特性不该有能力打挂一个已经在用的页面。
 * 兜的是 `undefined`，不是"标签为空"：两者渲染结果相同（不显示标签），但前者是
 * 「这个后端还不认识标签」，后者是「这个模板没打标签」。
 */
function tagsOf(t: CanvasTemplate): readonly string[] {
  return t.tags ?? [];
}

function describeSections(t: CanvasTemplate): string {
  if (t.sections.length === 0) return "无分区";
  return `${t.sections.length} 分区 · ${t.sections.map((s) => s.name).join(" / ")}`;
}

/**
 * 新建失败的两种意思差别很大，所以只把**契约里 `createTemplate.err` 有的那个码**
 * 翻成一句人话，其余仍旧原样回显。
 *
 * ⚠ 这里**只认** `TEMPLATE_KEY_CONFLICT`：给别的码也各编一句友好文案，等于在前端造了一份
 *   错误语义的副本，而它与契约之间没有任何东西会红。回显 `reasonCode` 至少永远是真的。
 */
function describeCreateError(error: unknown): string {
  if (error instanceof ApiError && error.reasonCode === "TEMPLATE_KEY_CONFLICT") {
    return "这个 key 在本组织已被占用，换一个（服务端 TEMPLATE_KEY_CONFLICT · HTTP 409）";
  }
  return describeError(error);
}

/** 后端真实信封原样回显：`reasonCode` + HTTP 状态，不糊成一句「加载失败」。 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.reasonCode ?? "无 reasonCode"}（HTTP ${error.status}）`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}
