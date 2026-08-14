"use client";

import * as React from "react";
import { FileCode2, Plus, RefreshCw } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { currentOrganizationLabel } from "@/lib/org-display";
import { SkillUrlImportPanel } from "@/components/admin/skill-url-import-panel";
/**
 * G3（2026-08-14，人类原话：「新建skill应该弹出来一个新的popup界面」）—— 复用
 * `components/files/overlay.tsx` 的 `Modal`：这不是 `components/ui/` 底下的组件，
 * 但它是本仓**实际上**被当成通用 Dialog 原语在用的那一个（`chat-composer-attachments
 * .tsx` / `agent-runtime/chat-screen.tsx` / `tpl/parts.tsx` 等互不相关的模块都在复用
 * 它），`components/ui/` 目前没有任何 Dialog/Modal 组件——不新造第二套弹窗机制。
 */
import { Modal } from "@/components/files/overlay";
import {
  createSkillDraft,
  getSkillDetail,
  listSkills,
  reviewSkillVersion,
  runSecurityScan,
  submitSkillForReview,
  type CreateSkillDraftIn,
  type RunSecurityScanOut,
  type SkillDetail,
  type SkillListItem,
} from "@/lib/live-skill";

/**
 * 2026-08-13 —— tag 过滤 chip。
 *
 * 人类原话：「另外需要有一个 tags，用来过滤」。契约 `SkillListItem`（`packages/
 * contracts/src/skills.ts`）**没有 tag 字段**，为此另开一个契约面（后端新字段 /
 * 新接口）不在这次改动范围内（人类只要求「只改 UI/mock，不新开后端契约」）。
 *
 * 这里用已经在渲染的三个既有封闭枚举当过滤维度——它们本就是后端真实返回、
 * 界面上已经画成 `Badge` 的字段，语义上就是「标签」：
 *   · `source`（来源）：自建 / 晋升生成 / CC
 *   · `status`（状态）：草稿 / 待审核 / 被退回 / 已启用 / 已停用
 *   · `visibility`（可见范围）：组织可见 / 仅本团队
 * 纯前端本地过滤（`Array.prototype.filter`），零网络请求、零后端改动、零新签核面。
 * 同一维度内选中多个 chip 是「或」（比如同时选「草稿」「已启用」＝两者都要），
 * 跨维度是「且」；某维度一个 chip 都没选＝该维度不参与过滤（等价于全选）。
 */
interface TagFilterChip<V extends string> {
  readonly value: V;
  readonly label: string;
  /** 英文 slug，拼进 `data-testid`——中文枚举值直接拼 testid 不稳（转义/断言都麻烦）。 */
  readonly slug: string;
}

const SOURCE_CHIPS: readonly TagFilterChip<SkillListItem["source"]>[] = [
  { value: "自建", label: "自建", slug: "self-built" },
  { value: "晋升生成", label: "晋升生成", slug: "promoted" },
  { value: "CC", label: "CC", slug: "cc" },
];
const STATUS_CHIPS: readonly TagFilterChip<SkillListItem["status"]>[] = [
  { value: "草稿", label: "草稿", slug: "draft" },
  { value: "待审核", label: "待审核", slug: "pending-review" },
  { value: "被退回", label: "被退回", slug: "rejected" },
  { value: "已启用", label: "已启用", slug: "enabled" },
  { value: "已停用", label: "已停用", slug: "disabled" },
];
const VISIBILITY_CHIPS: readonly TagFilterChip<SkillListItem["visibility"]>[] = [
  { value: "org-wide", label: "组织可见", slug: "org-wide" },
  { value: "team-only", label: "仅本团队", slug: "team-only" },
];

interface TagFilterState {
  readonly source: ReadonlySet<SkillListItem["source"]>;
  readonly status: ReadonlySet<SkillListItem["status"]>;
  readonly visibility: ReadonlySet<SkillListItem["visibility"]>;
}

const EMPTY_TAG_FILTER: TagFilterState = {
  source: new Set(),
  status: new Set(),
  visibility: new Set(),
};

function matchesTagFilter(row: SkillListItem, filter: TagFilterState): boolean {
  if (filter.source.size > 0 && !filter.source.has(row.source)) return false;
  if (filter.status.size > 0 && !filter.status.has(row.status)) return false;
  if (filter.visibility.size > 0 && !filter.visibility.has(row.visibility)) return false;
  return true;
}

/**
 * G2/G6（2026-08-14，人类实测：点开一张「从外部 URL 导入的 skill」卡片报
 * `详情读取失败：SKILL_NOT_FOUND（HTTP 404）`）—— 真根因：
 *
 * `GET /skills`（`listSkills`）已经在 #662 合并了两套互不相通的数据模型
 * （声明式契约 `skill_contracts`，与运行时唯一真读的 `skills`/`skill_versions`/
 * `skill_version_files`——见 `pg-skill-url-import-repository.ts` 文件头「模型 A/B」）,
 * 但 `GET /skills/:skillId`（`getSkillDetail`）**没有跟着合并**——它只读
 * `skill_contracts`（`get-skill-detail.ts` → `scopeOf` → `loadDetail`，`pg-skill
 * -contract-repository.ts:314-320` 逐字 `FROM skill_contracts`）。URL 导入 /
 * starter-pack 导入的 skill 只在 `skills` 表里有行，`loadDetail` 对它们恒返回
 * `null` ⇒ `SKILL_NOT_FOUND`——这不是权限问题，也不是这一条记录坏了，是
 * **这一类记录的详情端口从来没有实现过**（#598「A/B 不收敛」的已知债，本轮不
 * 收敛那道墙）。
 *
 * 与其继续摆一个必然 404 的「查看契约」，这里给这批行换一个**真实可达**的入口：
 * 「编辑源码」，导到 `catalog` 屏（`CapabilityCatalogScreen` kind="skill"）的
 * `AgSkillEditor`——它读写的正是 `skills`/`skill_versions`/`skill_version_files`
 * 本身（`PgAssetFileRepository`，#785/#933），不经过 `skill_contracts`，因此对这批
 * 行是**真的**能打开、能看源文件、能编辑。
 *
 * ⚠ 判据是 `duty` 这个既有字段的取值，**不是新契约字段**——本轮唯一允许的契约变更
 *   是 G5 的 `tags`（见 PR 描述）。`pg-skill-contract-repository.ts` 的 `listAll()`
 *   对每一行「`skills` 表来源」的记录都写死同一句 `duty`（`WAVE2_BACKED_DUTY_MARKER`
 *   这个前缀），跟它是通过 URL 导入还是 starter-pack 导入无关——两者都在 `skills` 表
 *   里有行，都能用 `AgSkillEditor` 打开，用同一个信号完全够用。
 *   ⚠ 改这句文案时**两处必须一起改**（后端 `pg-skill-contract-repository.ts` 那一行 +
 *   这个常量），否则这条判定悄悄失效——两边都不引用对方，是故意的（前端不能 import
 *   `apps/api/src`），所以只能靠这条注释与两边的字面量一致来维持。
 */
const WAVE2_BACKED_DUTY_MARKER = "查看/编辑源码请点卡片上的「编辑源码」";

function isSourceFileBacked(row: SkillListItem): boolean {
  return row.duty.includes(WAVE2_BACKED_DUTY_MARKER);
}

/**
 * #520 —— `/skill` 的 Skill 库屏，**接真实后端**（#459 / PR #518 的 `SkillController`）。
 *
 * 它只画后端**真的能给出**的东西：`SkillListItem` 的七个字段，加上 `getSkillDetail`
 * 返回的契约三件套与门禁结论。没有调用量、没有 token 额度、没有满意度百分比、
 * 没有待审核队列 —— 那些的后端本波次全部不存在，画出来就是第二份会漂移的假事实。
 * 七屏原型（含这些内容）仍在 `screen=library-prototype`，标着「原型 · mock」。
 *
 * ## 三处刻意的设计，都会被门控盯着
 *
 * ① **空态是真实空态**。`listSkills` 返回 `[]` 时这里显示「还没有」，**不生成示例 skill**
 *    （契约 A1/V10 逐字）。`skill-create-smoke.spec.ts` 第一条断言就是它。
 *
 * ② **失败态回显后端真实错误信封**：`reasonCode（HTTP <status>）`，不糊成「加载失败」。
 *    糊成一句话之后，权限、校验、重名三种失败在界面上就再也分不开了。
 *
 * ③ **创建成功后乐观地把这一行插进本地列表，不立刻重读服务端**。
 *    这不是偷懒，是为了让 e2e 的反证打在**刷新**这个接缝上：把创建请求换成一个
 *    形状合法但没落库的 201 之后，界面照样显示那一行，**只有刷新才露馅**。
 *    若这里改成「创建后立刻重读」，反证会红在刷新之前 —— 那样它考验的是
 *    「请求有没有到服务端」，根本没考验到持久化。理由同样写在那个 spec 的文件头。
 *    ⚠ 乐观插进去的内容不是编的：名称/职责/可见性是使用者刚填的，
 *      `skillId`/`status`/`source` 来自服务端 201 的响应体。
 *    ⚠ #861：乐观行**单独存一处**（`pending`），不直接塞进 `state.rows`。原来那句
 *      `prev.status === "ready" ? 插入 : prev` 在「首屏列表还在飞」的窗口里会把这一行
 *      **静默丢掉**，随后到达的 GET 再把 state 覆盖成纯服务端结果 —— 使用者看到的是
 *      「提示说建好了，列表里没有」。它在 CI 上表现成 `skill-create-smoke.spec.ts:212`
 *      的间歇失败（stub 出来的 201 零延迟，最容易撞进这个窗口）。清除规则见 `pending`。
 *
 * ## 本屏**没有**的入口
 *
 * 停用（`POST /skills/:skillId/disable`）本波次必然被拒（无引用清单生产者，且状态机
 * 没有 `草稿 → 已停用` 这条边），所以这里不摆那个按钮 —— 摆一个注定失败的按钮，
 * 比没有按钮更糟。发布 / 试跑 / 审核同理：它们的用例没有 HTTP 边界。
 */

type LoadState =
  | { readonly orgId: string; readonly status: "loading" }
  | { readonly orgId: string; readonly status: "error"; readonly message: string }
  | { readonly orgId: string; readonly status: "ready"; readonly rows: readonly SkillListItem[] };

/** 契约 `DeclarativeContract` 的六个字段，一一对应表单项。⚠ 不多不少。 */
interface DraftForm {
  name: string;
  duty: string;
  promptTemplate: string;
  inputSchema: string;
  outputSchema: string;
  dataScope: string;
  readsRawTranscript: boolean;
  fallbackDeclaration: string;
  visibility: "org-wide" | "team-only";
  modelRef: string;
  /** G5——逗号分隔文本框，最简单可用的 tag 输入，仓库里没有现成的 chip-input 组件可复用。 */
  tags: string;
}

const EMPTY_FORM: DraftForm = {
  name: "",
  duty: "",
  promptTemplate: "",
  inputSchema: "",
  outputSchema: "",
  dataScope: "",
  readsRawTranscript: false,
  fallbackDeclaration: "",
  visibility: "org-wide",
  tags: "",
  /**
   * ⚠ 服务端目前不校验 `modelRef` 的取值（`MODEL_UNAVAILABLE` 那条路径还没有生产者），
   *   但契约要求它非空。给一个可改的缺省值，而不是在提交时偷偷补一个 —— 后者会让
   *   使用者以为自己选过模型。
   */
  modelRef: "model-default",
};

export function SkillCatalogLive() {
  const { session, identity } = useSession();
  const orgId = session?.currentOrgId ?? null;

  if (orgId === null) {
    // 未登录不是错误态：这条路径的身份来自 `POST /auth/login` 存下的会话，
    // 没有会话时后端会 401，界面先说清楚要先登录，而不是发一个注定 401 的请求。
    return (
      <div
        data-testid="skill-catalog-signed-out"
        className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
      >
        Skill 库需要先登录：真实权限由服务端裁决，这里不做本地投影。
      </div>
    );
  }

  // #596：身份未就绪时给加载态文案，不把 orgId 当组织名传下去（下游还单独渲染了组织 ID）。
  return <Catalog orgId={orgId} orgName={currentOrganizationLabel(identity?.org.name)} />;
}

/**
 * 一行「已经创建成功、但还没被任何一次服务端读取确认过」的乐观插入。
 *
 * `afterRequest` ＝ 插入时**已经发出**的最后一次读取的编号。清除规则只有一条：
 * **编号更大的读取**（＝创建之后才发起的那些）才能抹掉它。
 *   · 创建**之前**就在飞的那次（编号相等）不能 —— 它的响应早于这次创建，
 *     里面不可能有这一行，用它覆盖等于用过期事实否定刚发生的事。这就是 #861 的 bug。
 *   · 刷新按钮 / `page.reload()` 触发的读取编号更大 ⇒ 照常抹掉。#520 的反证
 *     「没落库的那行刷新后就没了」靠的正是这一条，两条一起才是完整的行为。
 */
interface PendingRow {
  readonly afterRequest: number;
  readonly row: SkillListItem;
}

function Catalog({ orgId, orgName }: { orgId: string; orgName: string }) {
  /**
   * 「编辑源码」目的地：同一个 `/skill` 路由的 `catalog` 屏，带上 `edit=<skillId>`
   * 让 `CapabilityCatalogScreen` 自动展开那一行的编辑表单（见该组件里读这个 query
   * 参数的那段）。保留当前已有的其它 query 参数（`as`/`org`/`state`）——同
   * `skill-app.tsx` 里 `href()` 的纪律，不能因为跳一次「编辑源码」就丢了预览视角。
   *
   * ⚠ 故意不用 `next/navigation` 的 `useSearchParams()`——那会把这个已经挂在服务端
   *   `searchParams` prop 之上的页面拖进「必须包 `<Suspense>`」的客户端渲染路径，
   *   这里只是拼一个链接，不需要那一层。直接读 `window.location.search`
   *   （客户端组件，浏览器渲染时才需要这个值——SSR 期间给个安全的空字符串兜底）。
   */
  function editSourceHref(skillId: string): string {
    const currentSearch = typeof window === "undefined" ? "" : window.location.search;
    const p = new URLSearchParams(currentSearch);
    p.set("screen", "catalog");
    p.set("edit", skillId);
    return `?${p.toString()}`;
  }

  const generation = React.useRef(0);
  const currentOrgId = React.useRef(orgId);
  currentOrgId.current = orgId;
  const [state, setState] = React.useState<LoadState>({ orgId, status: "loading" });
  const [pending, setPending] = React.useState<readonly PendingRow[]>([]);
  const [creating, setCreating] = React.useState(false);
  const [createMode, setCreateMode] = React.useState<CreateMode>("form");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<SkillDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [tagFilter, setTagFilter] = React.useState<TagFilterState>(EMPTY_TAG_FILTER);

  /** 返回是否真的刷新成功——`SkillUrlImportPanel` 的 `onImported` 契约要求这个布尔值。 */
  const load = React.useCallback(async (): Promise<boolean> => {
    if (currentOrgId.current !== orgId) return false;
    const request = ++generation.current;
    setState({ orgId, status: "loading" });
    try {
      const rows = await listSkills(orgId);
      // 换组织后到达的旧响应不得覆盖新组织的真实请求（同 `capability-catalog-screen.tsx`）。
      if (request !== generation.current || currentOrgId.current !== orgId) return false;
      setState({ orgId, status: "ready", rows });
      // 这次读取**发起于**编号 `request`：它只对更早的乐观行有发言权（见 `PendingRow`）。
      setPending((prev) => prev.filter((p) => p.afterRequest >= request));
      return true;
    } catch (error) {
      if (request !== generation.current || currentOrgId.current !== orgId) return false;
      setState({ orgId, status: "error", message: describeError(error) });
      return false;
    }
  }, [orgId]);

  React.useEffect(() => {
    // 换组织 = 上一组织的提示与详情全部作废：它们说的是另一个组织发生过的事。
    setCreating(false);
    setCreateMode("form");
    setNotice(null);
    setDetail(null);
    setDetailError(null);
    // 换组织后过滤条件也清空：上一组织选中的 tag 在新组织里未必还有对应的行。
    setTagFilter(EMPTY_TAG_FILTER);
    // 乐观行同理作废：它说的是另一个组织里刚发生的事。
    setPending([]);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  // 渲染期就按组织收口：effect 在 paint 之后才跑，只靠它会让新组织短暂继承旧组织的行。
  const visibleState: LoadState =
    state.orgId === orgId ? state : { orgId, status: "loading" };
  const serverRows = visibleState.status === "ready" ? visibleState.rows : [];
  /**
   * 服务端结果 ＋ 尚未被确认的乐观行。同一个 `skillId` 以**服务端那份**为准 ——
   * 真实创建的那一行被下一次读取带回来时，这里换成服务端的版本，而不是并排两行。
   */
  const confirmedIds = new Set(serverRows.map((r) => r.skillId));
  const rows: readonly SkillListItem[] = [
    ...pending.filter((p) => !confirmedIds.has(p.row.skillId)).map((p) => p.row),
    ...serverRows,
  ];
  // tag 过滤在真实数据之上、纯前端本地做——不改变「本屏没有 skill」这条真实空态的判定，
  // 只影响「有 skill 但都被过滤掉了」这条另外的、可清空的状态。
  const filteredRows = rows.filter((row) => matchesTagFilter(row, tagFilter));
  const tagFilterActive =
    tagFilter.source.size > 0 || tagFilter.status.size > 0 || tagFilter.visibility.size > 0;

  function toggleTag<K extends keyof TagFilterState>(dimension: K, value: TagFilterState[K] extends ReadonlySet<infer T> ? T : never) {
    setTagFilter((prev) => {
      const next = new Set(prev[dimension] as ReadonlySet<typeof value>);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [dimension]: next };
    });
  }

  async function openDetail(skillId: string) {
    setDetailError(null);
    try {
      setDetail(await getSkillDetail(skillId));
    } catch (error) {
      setDetail(null);
      setDetailError(describeError(error));
    }
  }

  return (
    <div className="relative flex flex-col gap-5" data-testid="skill-catalog-live">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-16 font-semibold tracking-tight">Skill 库</h1>
            <Badge tone="outline">真实数据</Badge>
          </div>
          <span className="font-mono text-10 text-muted-foreground">
            {orgName} · 组织 ID {orgId}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load()}
            disabled={visibleState.status === "loading"}
            data-testid="skill-catalog-refresh"
          >
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            {visibleState.status === "loading" ? "加载中…" : "刷新"}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setNotice(null);
              setCreating((v) => !v);
            }}
            data-testid="skill-create-open"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" /> 新建 skill
          </Button>
        </div>
      </header>

      <p className="text-12 text-muted-foreground">
        skill 是一份声明式契约（提示词模板 ＋ 输入输出 schema ＋ 数据范围声明）。新建出来的是
        <strong className="text-foreground">草稿</strong>：要变成「已启用」，得先过安全扫描（自动），
        再由<strong className="text-foreground">另一位</strong>方法论审核人批准 —— 打开「查看契约」
        里的门禁面板走这两步。这里<strong className="text-foreground">没有</strong>「启用」按钮：
        没有第二个评审人，就没有「已启用」。
      </p>

      {creating ? (
        <Modal
          title="新建 Skill"
          subtitle="三条路径：完全新建（契约表单）／从 GitHub 导入／从市场挑一个改"
          onClose={() => setCreating(false)}
          testid="skill-create-modal"
          width="lg"
        >
        <div className="flex flex-col gap-3" data-testid="skill-create-launcher">
          <CreateModeTabs mode={createMode} onChange={setCreateMode} />
          {createMode === "form" ? (
            <CreatePanel
              orgId={orgId}
              onCancel={() => setCreating(false)}
              onCreated={(row, message) => {
                // ⚠ 乐观插入，**不重读**。理由见文件头第 ③ 条。
                // ⚠ 不看当前是不是 `ready`：首屏还在加载时也照样插得进去（#861）。
                setPending((prev) => [{ afterRequest: generation.current, row }, ...prev]);
                setNotice(message);
                setCreating(false);
              }}
            />
          ) : null}
          {createMode === "import" ? (
            <SkillUrlImportPanel key={orgId} onImported={load} />
          ) : null}
          {createMode === "market" ? <MarketPickUnavailable /> : null}
        </div>
        </Modal>
      ) : null}

      {notice ? (
        <p data-testid="skill-catalog-notice" className="text-12 text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {visibleState.status === "loading" ? (
        <div
          data-testid="skill-catalog-loading"
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          正在读取当前组织的 Skill 库…
        </div>
      ) : null}

      {visibleState.status === "error" ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p data-testid="skill-catalog-error" className="text-12 text-destructive">
            Skill 库读取失败：{visibleState.message}
          </p>
          <Button size="sm" variant="outline" onClick={() => void load()} data-testid="skill-catalog-retry">
            重试
          </Button>
        </div>
      ) : null}

      {visibleState.status === "ready" && rows.length === 0 ? (
        <div
          data-testid="skill-catalog-empty"
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          当前组织还没有任何 skill。这里就是真实空态 —— 不会替你生成示例 skill。
        </div>
      ) : null}

      {/**
       * tag 过滤条只在「确实有行可过滤」时露出——rows 空的时候摆一排不生效的 chip
       * 只会让真实空态看起来像是被过滤掉了。条件同样用 `rows.length > 0`
       * （不是 `status === "ready"`），理由与下面列表的 #861 注释相同。
       */}
      {rows.length > 0 ? (
        <TagFilterBar
          filter={tagFilter}
          active={tagFilterActive}
          onToggle={toggleTag}
          onClear={() => setTagFilter(EMPTY_TAG_FILTER)}
        />
      ) : null}

      {/**
       * ⚠ 条件是 `rows.length > 0`，**不是** `status === "ready" && …`（#861）：
       *   首屏还在飞的时候刚建出来的那一行也得看得见，否则「提示说建好了、列表里没有」
       *   这个状态会一直挂到 GET 回来为止。加载态那一格照常显示 —— 两件事都是真的：
       *   这一行确实建出来了，整份列表确实还在读。
       *
       * tag 过滤是在这份「真实存在的行」之上另做的一层本地筛选：`rows` 本身不变，
       * 变的是 `filteredRows`——过滤把它们全滤空了，是「无匹配」，不是「没有 skill」，
       * 两者在界面上分开显示（见下面 `skill-catalog-no-match`）。
       */}
      {rows.length > 0 && filteredRows.length === 0 ? (
        <div
          data-testid="skill-catalog-no-match"
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          没有 skill 匹配当前选中的标签。
        </div>
      ) : null}

      {filteredRows.length > 0 ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="skill-catalog-list"
        >
          {filteredRows.map((row) => (
            <Card key={row.skillId}>
              <CardContent className="flex h-full flex-col gap-2 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-13 font-medium">{row.name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="outline">{row.source}</Badge>
                  <Badge tone={row.status === "已启用" ? "primary" : "neutral"}>{row.status}</Badge>
                  <Badge tone="outline">
                    {row.visibility === "org-wide" ? "组织可见" : "仅本团队"}
                  </Badge>
                </div>
                <p className="line-clamp-2 flex-1 text-11 text-muted-foreground">{row.duty}</p>
                {/*
                  G5：`tags` 为空数组时什么都不渲染——「没打标签」不是需要向使用者解释的
                  异常状态，不占位、不显示「无标签」这类提示语（同 contract.md §3④）。
                */}
                {(row.tags ?? []).length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1" data-testid="skill-catalog-tags">
                    {/* key 带下标：tags 是自由文本输入（`skill-create-tags`），
                        不去重（G5 契约没有要求唯一），同一个 tag 可能重复出现。 */}
                    {(row.tags ?? []).map((tag, i) => (
                      <Badge key={`${tag}-${i}`} tone="neutral" className="font-normal">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <p className="text-10 text-muted-foreground">
                  满意度{" "}
                  {/* ⚠ null ⟺ 样本不足。契约逐字：不得为了填满界面而给一个 0%。 */}
                  {row.satisfaction === null ? "样本不足" : `${Math.round(row.satisfaction * 100)}%`}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {/*
                    G2/G6：`isSourceFileBacked` 为真的行在 `skill_contracts` 里没有对应
                    记录，「查看契约」必 404（见上方文件头长注）——换成真实可达的
                    「编辑源码」，不是两个都摆、其中一个是死路。
                  */}
                  {isSourceFileBacked(row) ? (
                    <Button asChild size="xs" variant="ghost" className="self-start" data-testid="skill-catalog-edit-source">
                      <a href={editSourceHref(row.skillId)}>编辑源码</a>
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="self-start"
                      onClick={() => void openDetail(row.skillId)}
                      data-testid="skill-catalog-detail"
                    >
                      查看契约
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {detailError ? (
        <p data-testid="skill-detail-error" className="text-12 text-destructive">
          详情读取失败：{detailError}
        </p>
      ) : null}

      {detail ? (
        <DetailPanel
          detail={detail}
          onClose={() => setDetail(null)}
          onStatusChanged={(skillId, status) => {
            /**
             * ⚠ **乐观更新，不重读服务端** —— 与创建那条（文件头第 ③ 条）同一个理由，
             *   而这里更要紧：#552 的反证要打在**刷新**这个接缝上。把状态落库那一步
             *   摘掉之后，界面收到的 200 与真实成功一模一样，这一行会照常显示成
             *   「已启用」；只有 `page.reload()` 之后才露馅。
             *   若这里改成「审核后立刻重读列表」，反证会红在刷新**之前**——
             *   那样它考验的是「请求有没有到服务端」，根本没考验到落库。
             */
            setState((prev) =>
              prev.orgId === orgId && prev.status === "ready"
                ? {
                    ...prev,
                    rows: prev.rows.map((r) => (r.skillId === skillId ? { ...r, status } : r)),
                  }
                : prev,
            );
            // 刚建出来、还没被任何一次读取确认的那一行也在这里 —— 漏掉它，
            // 「建完直接走门禁」这条路径上状态徽标会停在「草稿」不动。
            setPending((prev) =>
              prev.map((p) =>
                p.row.skillId === skillId ? { ...p, row: { ...p.row, status } } : p,
              ),
            );
          }}
        />
      ) : null}
    </div>
  );
}

/* ── tag 过滤条：三组既有封闭枚举当过滤维度，纯前端本地过滤 ──────────── */

function TagFilterBar({
  filter,
  active,
  onToggle,
  onClear,
}: {
  filter: TagFilterState;
  active: boolean;
  onToggle: <K extends keyof TagFilterState>(dimension: K, value: TagFilterState[K] extends ReadonlySet<infer T> ? T : never) => void;
  onClear: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-panel p-3"
      data-testid="skill-tag-filter"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-10 uppercase tracking-wide text-muted-foreground">按标签过滤</span>
        <Button
          size="xs"
          variant="ghost"
          disabled={!active}
          onClick={onClear}
          data-testid="skill-tag-filter-clear"
        >
          清除过滤
        </Button>
      </div>
      <TagFilterGroup
        label="来源"
        chips={SOURCE_CHIPS}
        selected={filter.source}
        onToggle={(v) => onToggle("source", v)}
      />
      <TagFilterGroup
        label="状态"
        chips={STATUS_CHIPS}
        selected={filter.status}
        onToggle={(v) => onToggle("status", v)}
      />
      <TagFilterGroup
        label="可见范围"
        chips={VISIBILITY_CHIPS}
        selected={filter.visibility}
        onToggle={(v) => onToggle("visibility", v)}
      />
    </div>
  );
}

function TagFilterGroup<V extends string>({
  label,
  chips,
  selected,
  onToggle,
}: {
  label: string;
  chips: readonly TagFilterChip<V>[];
  selected: ReadonlySet<V>;
  onToggle: (value: V) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="px-1 text-9 uppercase tracking-wide text-muted-foreground">{label}</span>
      {chips.map((chip) => {
        const isSelected = selected.has(chip.value);
        return (
          <Button
            key={chip.value}
            size="xs"
            variant={isSelected ? "primary" : "outline"}
            aria-pressed={isSelected}
            onClick={() => onToggle(chip.value)}
            data-testid={`skill-tag-chip-${chip.slug}`}
          >
            {chip.label}
          </Button>
        );
      })}
    </div>
  );
}

/* ── 新建 Skill 三条路径 ───────────────────────────────────────────────
 *
 * 2026-08-13 —— 人类给了两张后台原型截图核对，「新建 Skill」应长出三条路径
 * （完全新建 / 导入 / 从市场挑一个改）。逐条核实过后端能给什么，**只接已经真实
 * 存在的后端**，没有的如实标注，不假装、不摆一个会自己抛错的按钮：
 *
 *   · **完全新建** —— 契约 `createSkillDraft`（`POST /skills`）真实存在，
 *     但它要求一次性交齐「提示词模板 ＋ 输入输出 schema ＋ 数据范围声明」这份
 *     完整声明式契约，**不是**「先建一个只有 SKILL.md 的空目录，再用文件浏览器
 *     + 代码编辑器逐个文件补」这条路径。下面的 `CreatePanel`（本文件原有组件，
 *     未改动）就是这条真实路径，标签如实叫「完全新建（契约表单）」。
 *   · **导入** —— `POST /admin/skills/url-imports`（#595）真实存在，`apps/web`
 *     里已经有对应组件 `SkillUrlImportPanel`（`components/admin/skill-
 *     url-import-panel.tsx`，#881 F2），此前只接在 `catalog` 屏
 *     （`CapabilityCatalogScreen`），本轮把它接到这里——同一个组件，同一条
 *     真实调用链，只是多了一个入口。
 *   · **从市场挑一个改** —— 没有对应后端。`packages/contracts/src/*.ts` 里
 *     不存在任何 market/marketplace 相关操作；「Claude Code 社区 1,842 个 ·
 *     已同步 34」这类数字只存在于 `components/asset-governance/ag-screens.tsx`
 *     的 `AgNewSkill`（签核用 UI 先行原型，`lib/mock/asset-governance.ts` 的
 *     `AG_MARKET_CARDS` 纯 mock）。这里**不**把那份 mock 数字搬过来冒充真实——
 *     `MarketPickUnavailable` 如实说「未接后端」，并指向登记这个缺口的 issue。
 *
 * ⚠ 「空白骨架 + 文件浏览器 + 代码编辑器从头写」这条路径（人类原话第③点）在
 *   `asset-governance` 契约里也找不到对应操作：`getAssetDirectory` /
 *   `readAssetFile` / `writeAssetFile` / `createAssetFile` 全部要求一个
 *   **已经存在**的 `assetId`（见 `packages/contracts/src/asset-governance.ts`
 *   `getAssetDirectory` 的 `in: { assetKind, assetId }`）——`AgSkillEditor`
 *   （`asset-governance` 束，#933）编辑的是**已建好**的 skill，不能拿它开一个
 *   还不存在的新 skill。缺的是一个「创建只带 SKILL.md 骨架的空白 skill 记录」
 *   的后端操作（可能是 `skills` 束新增 `createSkillSkeleton`，或
 *   `asset-governance` 束新增「先建空 asset 记录再进文件编辑器」）。这不是这次
 *   改动能顺手补的契约面（新契约需要单独走 ADR-023 签核），已记录为独立 issue。
 */

type CreateMode = "form" | "import" | "market";

const CREATE_MODE_TABS: readonly { id: CreateMode; label: string }[] = [
  { id: "form", label: "完全新建（契约表单）" },
  { id: "import", label: "从 GitHub 导入" },
  { id: "market", label: "从市场挑一个改" },
];

function CreateModeTabs({
  mode,
  onChange,
}: {
  mode: CreateMode;
  onChange: (mode: CreateMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="skill-create-mode-tabs">
      {CREATE_MODE_TABS.map((tab) => (
        <Button
          key={tab.id}
          size="xs"
          variant={mode === tab.id ? "primary" : "outline"}
          aria-pressed={mode === tab.id}
          onClick={() => onChange(tab.id)}
          data-testid={`skill-create-mode-${tab.id}`}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * 「从市场挑一个改」——如实标注未接后端，不摆 mock 数字冒充真实。
 * 证据与去处见上方文件头长注。
 */
function MarketPickUnavailable() {
  return (
    <Card data-testid="skill-create-market-unavailable">
      <CardContent className="flex flex-col gap-1.5 pt-4">
        <p className="text-12 font-medium">这条路径还没有后端</p>
        <p className="text-11 leading-relaxed text-muted-foreground">
          「从市场挑一个改」需要一个 market/marketplace 数据源——`packages/contracts`
          里目前不存在任何这样的操作。Skill 库与市场原型（`?screen=library-prototype`）
          与后台签核原型（`AgNewSkill`）里的「Claude Code 社区 1,842 个」这类数字都是
          UI 先行阶段的 mock，不代表真实可拉取的市场目录。这里不搬那份 mock 数字冒充真实——
          需要先补市场浏览的后端契约（另开 ADR-023 签核），已记录为独立 issue。
        </p>
      </CardContent>
    </Card>
  );
}

/* ── 新建面板：契约三件套，字段与 `createSkillDraft.in` 一一对应 ─────────── */

function CreatePanel({
  orgId,
  onCancel,
  onCreated,
}: {
  orgId: string;
  onCancel: () => void;
  onCreated: (row: SkillListItem, message: string) => void;
}) {
  const [form, setForm] = React.useState<DraftForm>(EMPTY_FORM);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  function set<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    // G5：逗号分隔 → 数组；同 `dataScope` 那行的纪律——空串是空 tags，不是 `[""]`。
    const tags = form.tags.split(",").map((t) => t.trim()).filter((t) => t !== "");
    const input: CreateSkillDraftIn = {
      orgId,
      name: form.name,
      duty: form.duty,
      contract: {
        promptTemplate: form.promptTemplate,
        inputSchema: form.inputSchema,
        outputSchema: form.outputSchema,
        // 逗号分隔 → 数组；空串就是**空范围**，不是 `[""]`。
        dataScope: form.dataScope.split(",").map((s) => s.trim()).filter((s) => s !== ""),
        readsRawTranscript: form.readsRawTranscript,
        fallbackDeclaration: form.fallbackDeclaration,
      },
      visibility: form.visibility,
      modelRef: form.modelRef,
      tags,
      // ⚠ 这里**没有** `source`：它由服务端按入口打标；写它 ⇒ `SOURCE_TAG_IMMUTABLE`。
    };
    try {
      const created = await createSkillDraft(input);
      onCreated(
        {
          skillId: created.skillId,
          name: form.name,
          duty: form.duty,
          // 服务端分配的三个字段，来自 201 的响应体，不是这里编的。
          source: created.source,
          status: created.status,
          visibility: form.visibility,
          currentVersionId: created.versionId,
          // 契约：null ⟺ 样本不足。新建的 skill 一次调用都没有过。
          satisfaction: null,
          // G5：乐观插入这一行时回填使用者刚填的 tags——不是编的，是这次提交本身的入参。
          tags,
        },
        `已创建草稿「${form.name}」（skillId ${created.skillId}）`,
      );
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-primary/30" data-testid="skill-create-panel">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-13 font-semibold">
            <FileCode2 aria-hidden className="h-4 w-4" /> 新建 skill · 声明式契约
          </h2>
          <span className="text-9 text-muted-foreground">
            来源标记由服务端按入口自动打标（自建），提交人不可改写
          </span>
        </div>

        <Field id="skill-create-name" label="名称">
          <Input
            id="skill-create-name"
            data-testid="skill-create-name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field id="skill-create-duty" label="职责（这个 skill 负责什么）">
          <Input
            id="skill-create-duty"
            data-testid="skill-create-duty"
            value={form.duty}
            onChange={(e) => set("duty", e.target.value)}
          />
        </Field>
        <Field id="skill-create-prompt" label="提示词模板（可带变量）">
          <Textarea
            id="skill-create-prompt"
            data-testid="skill-create-prompt"
            rows={3}
            value={form.promptTemplate}
            onChange={(e) => set("promptTemplate", e.target.value)}
          />
        </Field>
        <Field id="skill-create-input-schema" label="输入 schema（JSON Schema 文本）">
          <Textarea
            id="skill-create-input-schema"
            data-testid="skill-create-input-schema"
            rows={2}
            value={form.inputSchema}
            onChange={(e) => set("inputSchema", e.target.value)}
          />
        </Field>
        <Field id="skill-create-output-schema" label="输出 schema（JSON Schema 文本）">
          <Textarea
            id="skill-create-output-schema"
            data-testid="skill-create-output-schema"
            rows={2}
            value={form.outputSchema}
            onChange={(e) => set("outputSchema", e.target.value)}
          />
        </Field>
        <Field
          id="skill-create-data-scope"
          label="数据范围声明（逗号分隔；上界＝提交人自身权限，服务端判定）"
        >
          <Input
            id="skill-create-data-scope"
            data-testid="skill-create-data-scope"
            value={form.dataScope}
            onChange={(e) => set("dataScope", e.target.value)}
          />
        </Field>
        <Checkbox
          data-testid="skill-create-reads-raw-transcript"
          label="声明读取原始转写"
          description="需单独授权；未授权时服务端直接判校验失败，不进待审核队列"
          checked={form.readsRawTranscript}
          onChange={(e) => set("readsRawTranscript", e.target.checked)}
        />
        <Field id="skill-create-fallback" label="兜底声明（拿不到东西时怎么办）">
          <Input
            id="skill-create-fallback"
            data-testid="skill-create-fallback"
            value={form.fallbackDeclaration}
            onChange={(e) => set("fallbackDeclaration", e.target.value)}
          />
        </Field>
        <Field id="skill-create-model" label="模型引用">
          <Input
            id="skill-create-model"
            data-testid="skill-create-model"
            value={form.modelRef}
            onChange={(e) => set("modelRef", e.target.value)}
          />
        </Field>
        {/* G5（2026-08-14，人类原话：「新建的时候要支持添加tags」）——最简单可用的输入：
            逗号分隔文本框，与上面 `dataScope` 同一种输入方式，不引入新的 chip-input 组件。 */}
        <Field id="skill-create-tags" label="标签（可选，逗号分隔）">
          <Input
            id="skill-create-tags"
            data-testid="skill-create-tags"
            placeholder="例如：客服, 数据分析"
            value={form.tags}
            onChange={(e) => set("tags", e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-11 text-muted-foreground">可见性</span>
          {(["org-wide", "team-only"] as const).map((v) => (
            <Button
              key={v}
              size="xs"
              variant={form.visibility === v ? "primary" : "outline"}
              onClick={() => set("visibility", v)}
              data-testid={`skill-create-visibility-${v}`}
            >
              {v === "org-wide" ? "组织可见" : "仅本团队"}
            </Button>
          ))}
        </div>

        {error ? (
          <p role="alert" data-testid="skill-create-error" className="text-11 text-destructive">
            提交被拒绝：{error}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={submitting}
            onClick={() => void submit()}
            data-testid="skill-create-submit"
          >
            {submitting ? "提交中…" : "提交"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} data-testid="skill-create-cancel">
            取消
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/* ── 只读详情：`GET /skills/:skillId` 的返回，一字不添 ──────────────────── */

function DetailPanel({
  detail,
  onClose,
  onStatusChanged,
}: {
  detail: SkillDetail;
  onClose: () => void;
  onStatusChanged: (skillId: string, status: SkillListItem["status"]) => void;
}) {
  const { skill, contract, gateResults } = detail;
  return (
    <Card data-testid="skill-detail-panel">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-13 font-semibold">{skill.name} · 只读契约</h2>
          <Button size="xs" variant="ghost" onClick={onClose} data-testid="skill-detail-close">
            关闭
          </Button>
        </div>
        <Block label="提示词模板" body={contract.promptTemplate} />
        <Block label="输入 schema" body={contract.inputSchema} />
        <Block label="输出 schema" body={contract.outputSchema} />
        <Block
          label="数据范围声明"
          body={contract.dataScope.length === 0 ? "（未声明任何数据范围）" : contract.dataScope.join("、")}
        />
        <Block label="兜底声明" body={contract.fallbackDeclaration} />

        <div className="flex flex-wrap items-center gap-2 text-11">
          <span className="text-muted-foreground">双重门禁</span>
          <Badge tone={gateResults.securityScan === null ? "outline" : "primary"}>
            {/* null = 还没扫过，是真实空态，不是「通过」。 */}
            安全扫描 {gateResults.securityScan ?? "未执行"}
          </Badge>
          <Badge tone={gateResults.methodologyReviewPassed ? "primary" : "outline"}>
            方法论审核 {gateResults.methodologyReviewPassed ? "已通过" : "未通过"}
          </Badge>
        </div>

        {detail.latestTrialRun === null ? (
          <p data-testid="skill-detail-trialrun-empty" className="text-11 text-muted-foreground">
            最近一次试跑：还没有跑过。这是真实空态，不是失败 —— 试跑用例仍然没有 HTTP 边界。
          </p>
        ) : (
          <Block label="最近一次试跑输出" body={detail.latestTrialRun.output} />
        )}

        <GatePanel detail={detail} onStatusChanged={onStatusChanged} />
      </CardContent>
    </Card>
  );
}

/* ── #552：双重门禁的操作面 ──────────────────────────────────────────── */

/**
 * 扫描 / 提交 / 审核三个动作。
 *
 * ## ⚠ 四个按钮**永远都在**，不按身份藏
 *
 * 「我是不是方法论审核人」是**服务端**的裁决（`skill_reviewer_functions` ＋
 * `domain/skill/review-authorization.ts`）。在这里按身份把「批准」藏起来，
 * 等于把 I-5 那条规则复述第二遍 —— 而它与服务端那份必然有一天不一致，
 * 到那天界面会把一个仍然会被拒的操作显示成不可用，或者更糟，反过来。
 * ⇒ 按钮一直在，越权点下去看到的是**后端真实的错误信封**
 * （`REVIEWER_FUNCTION_MISMATCH（HTTP 403）`），那是使用者真正需要知道的事。
 *
 * ## ⚠ 这里没有「启用」按钮
 *
 * `已启用` 只由「批准」这一次调用在服务端产生。摆一个「启用」按钮就是
 * `SKILLS_FORBIDDEN_ROUTES` 说的那条绕过路径在界面上的样子。
 */
function GatePanel({
  detail,
  onStatusChanged,
}: {
  detail: SkillDetail;
  onStatusChanged: (skillId: string, status: SkillListItem["status"]) => void;
}) {
  /**
   * ⚠ 取的是 `detail.currentVersionId`（**本响应正文所属的那一版**），
   *   不是 `detail.skill.currentVersionId`（＝生效版本，草稿期恒 null）。
   *   两者是两个不同的事实，服务端注释里写了为什么它们各占一处
   *   （`skill.controller.ts` 的 `getSkillDetail` 分支）。
   */
  const versionId = detail.currentVersionId;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [scan, setScan] = React.useState<RunSecurityScanOut | null>(null);
  const [reason, setReason] = React.useState("契约正文与数据范围声明已复核，符合方法论要求");
  const [acked, setAcked] = React.useState<readonly string[]>([]);

  async function act(what: string, run: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await run();
      if (message !== null) setNotice(message);
    } catch (caught) {
      setError(`${what}被拒绝：${describeError(caught)}`);
    } finally {
      setBusy(false);
    }
  }

  if (versionId === null) {
    // 契约允许它为 null；真出现时说明这个 skill 连一版声明都没有，那不是门禁能处理的事。
    return (
      <p data-testid="skill-gate-no-version" className="text-11 text-muted-foreground">
        这个 skill 还没有任何版本，门禁无从开始。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3" data-testid="skill-gate-panel">
      <span className="text-10 uppercase tracking-wide text-muted-foreground">
        双重门禁 · 版本 {versionId}
      </span>
      <p className="text-11 text-muted-foreground">
        安全扫描（自动）与方法论审核（人工）是<strong className="text-foreground">并列</strong>的两道门，
        不是「先提交再补扫描」。「已启用」只由另一位方法论审核人的批准产生 —— 这里没有、也不会有
        「启用」按钮。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          data-testid="skill-gate-scan"
          onClick={() =>
            void act("安全扫描", async () => {
              const result = await runSecurityScan(versionId);
              setScan(result);
              return `安全扫描结论：${result.verdict}（风险项 ${result.findings.length} 条）`;
            })
          }
        >
          安全扫描
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          data-testid="skill-gate-submit"
          onClick={() =>
            void act("提交评审", async () => {
              // `expectedVersion` ＝ 调用方以为这一版此刻处于什么状态（乐观并发）。
              // 草稿屏上它只可能是「草稿」；不匹配时服务端返回 SKILL_VERSION_CHANGED。
              const out = await submitSkillForReview(versionId, "草稿");
              onStatusChanged(detail.skill.skillId, out.status);
              return `已提交人工门禁：${out.status}`;
            })
          }
        >
          提交评审
        </Button>
        <Button
          size="xs"
          variant="primary"
          disabled={busy}
          data-testid="skill-gate-approve"
          onClick={() =>
            void act("批准", async () => {
              const out = await reviewSkillVersion({
                versionId,
                decision: "approve",
                reason,
                riskAcks: acked,
              });
              onStatusChanged(detail.skill.skillId, out.skillStatus);
              return `方法论审核通过：${out.skillStatus}（评审记录 ${out.reviewRecordId}）`;
            })
          }
        >
          批准
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          data-testid="skill-gate-reject"
          onClick={() =>
            void act("退回", async () => {
              const out = await reviewSkillVersion({
                versionId,
                decision: "reject",
                reason,
                riskAcks: acked,
              });
              onStatusChanged(detail.skill.skillId, out.skillStatus);
              return `已退回：${out.skillStatus}`;
            })
          }
        >
          退回
        </Button>
      </div>

      <Field id="skill-gate-reason" label="审核理由（留痕，必填）">
        <Input
          id="skill-gate-reason"
          data-testid="skill-gate-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>

      {/* `risk-pending-confirm` 的风险项**逐条**确认；未确认满时服务端判 GATE_NOT_PASSED。 */}
      {scan !== null && scan.findings.length > 0 ? (
        <div className="flex flex-col gap-1.5" data-testid="skill-gate-findings">
          {scan.findings.map((f) => (
            <Checkbox
              key={f.riskItemId}
              data-testid="skill-gate-ack"
              label={`${f.kind}：${f.detail}`}
              checked={acked.includes(f.riskItemId)}
              onChange={(e) =>
                setAcked((prev) =>
                  e.target.checked
                    ? [...prev, f.riskItemId]
                    : prev.filter((id) => id !== f.riskItemId),
                )
              }
            />
          ))}
        </div>
      ) : null}

      {notice ? (
        <p data-testid="skill-gate-notice" className="text-11 text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="skill-gate-error" className="text-11 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Block({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-3">
      <span className="text-10 uppercase tracking-wide text-muted-foreground">{label}</span>
      <pre className="whitespace-pre-wrap font-mono text-11 text-foreground">{body}</pre>
    </div>
  );
}

/**
 * 后端**真实**失败信封，不糊成一句「失败了」。
 *
 * ⚠ `reasonCode` 与 HTTP 状态**都要**。只有 reasonCode 时，一个被
 * `all-exceptions.filter.ts` 白名单剥掉码的 409（比如 `SKILL_NAME_CONFLICT`，
 * 见 `skill.controller.ts:344-352`）会显示成空；只有状态码时，422 底下的六种
 * 校验失败又分不开。两者一起才定位得了。
 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.reasonCode ?? "无 reasonCode"}（HTTP ${error.status}）`;
  }
  if (error instanceof Error) return error.message;
  return "未知错误";
}
