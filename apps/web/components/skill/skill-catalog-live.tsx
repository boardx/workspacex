"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { EntityCatalog, CardActions, tagOf, tagSlug, type CatalogTag } from "@/components/admin/entity-catalog";
import { KV } from "@/components/admin/panel";
import {
  getSkillDetail,
  listSkills,
  reviewSkillVersion,
  runSecurityScan,
  submitSkillForReview,
  type RunSecurityScanOut,
  type SkillDetail,
  type SkillListItem,
} from "@/lib/live-skill";

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
 *    （契约 A1/V10 逐字）。
 *
 * ② **失败态回显后端真实错误信封**：`reasonCode（HTTP <status>）`，不糊成「加载失败」。
 *    糊成一句话之后，权限、校验、重名三种失败在界面上就再也分不开了。
 *
 * ③ **F192（design-delta `skill-model-a-b-convergence` 选项②）之后**：「完全新建
 *    （契约表单）」入口已下线，`POST /skills` 对任何请求都返回 `410 Gone`——本屏不再
 *    有走这条路径的乐观插入。`pending`/`PendingRow` 这套「乐观行单独存一处、按
 *    `afterRequest` 世代号清除」的机制原是为它准备的（#861），现在只被门禁审核
 *    （`GatePanel` 的 `onStatusChanged`）复用，为**已存在**的行做乐观状态更新——
 *    机制本身未变，只是新增行的来源变成了「导入」（`SkillUrlImportPanel` 的
 *    `onImported` 接的是真实 `load()`，走的是重读服务端而不是乐观插入）。
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

/**
 * 点开一张「查看契约」卡片后面板里要读的详情——`getSkillDetail` 的返回按 skillId 记，
 * 与 `selectedKey` 分开：面板打开是一件事，详情读没读到是另一件事（G2/G6 那类 404
 * 要能在面板里如实显示，而不是让面板打不开）。
 */
type DetailState =
  | { readonly skillId: string; readonly status: "loading" }
  | { readonly skillId: string; readonly status: "error"; readonly message: string }
  | { readonly skillId: string; readonly status: "ready"; readonly detail: SkillDetail };

const VISIBILITY_LABEL = { "org-wide": "组织可见", "team-only": "仅本团队" } as const;

function Catalog({ orgId, orgName }: { orgId: string; orgName: string }) {
  /**
   * 「编辑源码」目的地——人类反馈（2026-08-17）：点击「编辑」应该打开一个新的界面，
   * 不是在当前列表页里内联展开。直接指向独立页面（`/admin/skill/[id]`，`CapabilityEditPage`）。
   *
   * 人类实测反馈（2026-08-30）：「返回」此前写死回 `/skill?screen=catalog`——从**这个**
   * 屏点「编辑源码」进去，点「返回」却跳到了另一个屏。把这个屏自己当前的 URL 编码进
   * `?from=`，`CapabilityEditPage` 优先用它——见 `capability-edit-page.tsx` 的头注。
   */
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const currentUrl = query === "" ? pathname : `${pathname}?${query}`;

  function editSourceHref(skillId: string): string {
    return `/admin/skill/${skillId}?from=${encodeURIComponent(currentUrl)}`;
  }

  const generation = React.useRef(0);
  const currentOrgId = React.useRef(orgId);
  currentOrgId.current = orgId;
  const [state, setState] = React.useState<LoadState>({ orgId, status: "loading" });
  const [pending, setPending] = React.useState<readonly PendingRow[]>([]);
  const [creating, setCreating] = React.useState(false);
  // F192（design-delta `skill-model-a-b-convergence` 选项②）：默认 tab 从「完全新建
  // （契约表单）」改成「从 GitHub 导入」——`form` 这条路径已经不存在了。
  const [createMode, setCreateMode] = React.useState<CreateMode>("import");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [detailState, setDetailState] = React.useState<DetailState | null>(null);

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
    // 换组织 = 上一组织的提示与面板全部作废：它们说的是另一个组织发生过的事。
    setCreating(false);
    setCreateMode("import");
    setNotice(null);
    setSelectedKey(null);
    setDetailState(null);
    // 乐观行同理作废：它说的是另一个组织里刚发生的事。
    setPending([]);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  // 渲染期就按组织收口：effect 在 paint 之后才跑，只靠它会让新组织短暂继承旧组织的行。
  const visibleState: LoadState = React.useMemo(
    () => (state.orgId === orgId ? state : { orgId, status: "loading" }),
    [state, orgId],
  );
  const serverRows = React.useMemo(
    () => (visibleState.status === "ready" ? visibleState.rows : []),
    [visibleState],
  );
  /**
   * 服务端结果 ＋ 尚未被确认的乐观行。同一个 `skillId` 以**服务端那份**为准 ——
   * 真实创建的那一行被下一次读取带回来时，这里换成服务端的版本，而不是并排两行。
   */
  const rows = React.useMemo<readonly SkillListItem[]>(() => {
    const confirmedIds = new Set(serverRows.map((r) => r.skillId));
    return [
      ...pending.filter((p) => !confirmedIds.has(p.row.skillId)).map((p) => p.row),
      ...serverRows,
    ];
  }, [pending, serverRows]);

  /**
   * 标签 = 三个既有封闭枚举（来源 / 状态 / 可见范围，后端真实返回、卡片上本来就画成
   * Badge）＋ G5 的自由 `tags`。纯前端本地过滤，零后端改动——同从前的 chip 过滤条，
   * 只是不再按维度分三行，而是同画布模板库一样汇总成一条、每个后跟数量。
   */
  const tagsOf = React.useCallback((row: SkillListItem): readonly CatalogTag[] => [
    tagOf(row.source),
    tagOf(row.status),
    tagOf(row.visibility, VISIBILITY_LABEL[row.visibility]),
    ...(row.tags ?? []).map((t) => ({ key: `tag-${tagSlug(t)}`, label: t })),
  ], []);
  const searchTextOf = React.useCallback(
    (row: SkillListItem): string => [row.name, row.skillId, row.duty, ...(row.tags ?? [])].join(" "),
    [],
  );

  const selectedRow = selectedKey === null ? null : (rows.find((r) => r.skillId === selectedKey) ?? null);
  // G2/G6：`skills` 表来源的行在 `skill_contracts` 里没有记录，`getSkillDetail` 必 404——
  // 这类行的面板只显示列表字段 + 「编辑源码」，不发一个注定失败的详情请求。
  const selectedNeedsDetail = selectedRow !== null && !isSourceFileBacked(selectedRow);

  React.useEffect(() => {
    if (selectedKey === null || !selectedNeedsDetail) {
      setDetailState(null);
      return;
    }
    let cancelled = false;
    setDetailState({ skillId: selectedKey, status: "loading" });
    getSkillDetail(selectedKey)
      .then((detail) => {
        if (!cancelled) setDetailState({ skillId: selectedKey, status: "ready", detail });
      })
      .catch((error) => {
        if (!cancelled) setDetailState({ skillId: selectedKey, status: "error", message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedKey, selectedNeedsDetail]);

  function onStatusChanged(skillId: string, status: SkillListItem["status"]) {
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
  }

  return (
    <EntityCatalog<SkillListItem>
      prefix="skill-catalog"
      rootTestId="skill-catalog-live"
      title="Skill 库"
      description={
        <>
          skill 是一份声明式契约（提示词模板 ＋ 输入输出 schema ＋ 数据范围声明）。新建出来的是
          <strong className="text-background-foreground">草稿</strong>：要变成「已启用」，得先过安全扫描（自动），
          再由<strong className="text-background-foreground">另一位</strong>方法论审核人批准 —— 点开卡片，
          在面板的门禁区走这两步。这里<strong className="text-background-foreground">没有</strong>「启用」按钮：
          没有第二个评审人，就没有「已启用」。
        </>
      }
      eyebrow={
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-inverse text-inverse-foreground">
            <Building2 aria-hidden className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-14 font-semibold">{orgName}</span>
            <span className="font-mono text-10 text-muted-foreground">组织 ID {orgId}</span>
          </div>
          <Badge tone="outline">真实数据</Badge>
        </div>
      }
      headerActions={
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
      }
      notices={
        notice ? (
          <p data-testid="skill-catalog-notice" className="text-12 text-muted-foreground">
            {notice}
          </p>
        ) : null
      }
      status={
        /**
         * ⚠ 首屏还在飞的时候刚建出来的那一行也得看得见（#861）：有乐观行就按 ready 画，
         *   否则「提示说建好了、列表里没有」这个状态会一直挂到 GET 回来为止。
         */
        visibleState.status === "ready" || rows.length > 0
          ? { kind: "ready" }
          : visibleState.status === "error"
            ? { kind: "error", message: visibleState.message }
            : { kind: "loading" }
      }
      rows={rows}
      keyOf={(row) => row.skillId}
      searchTextOf={searchTextOf}
      tagsOf={tagsOf}
      renderCard={(row) => (
        <CardContent className="flex h-full flex-col gap-2 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-13 font-medium">{row.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="outline">{row.source}</Badge>
            <Badge tone={row.status === "已启用" ? "primary" : "neutral"}>{row.status}</Badge>
            <Badge tone="outline">{VISIBILITY_LABEL[row.visibility]}</Badge>
          </div>
          <p className="line-clamp-2 flex-1 text-11 text-muted-foreground">{row.duty}</p>
          {/*
            G5：`tags` 为空数组时什么都不渲染——「没打标签」不是需要向使用者解释的
            异常状态，不占位、不显示「无标签」这类提示语（同 contract.md §3④）。
          */}
          {(row.tags ?? []).length > 0 ? (
            <div className="flex flex-wrap items-center gap-1" data-testid="skill-catalog-tags">
              {/* key 带下标：tags 是自由文本输入，不去重（G5 契约没有要求唯一）。 */}
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
          <CardActions>
            {/*
              G2/G6：`isSourceFileBacked` 为真的行在 `skill_contracts` 里没有对应
              记录，「查看契约」必 404（见上方文件头长注）——换成真实可达的
              「编辑源码」，不是两个都摆、其中一个是死路。
            */}
            {isSourceFileBacked(row) ? (
              <Button asChild size="xs" variant="ghost" data-testid="skill-catalog-edit-source">
                <a href={editSourceHref(row.skillId)}>编辑源码</a>
              </Button>
            ) : (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setSelectedKey(row.skillId)}
                data-testid="skill-catalog-detail"
              >
                查看契约
              </Button>
            )}
          </CardActions>
        </CardContent>
      )}
      onRefresh={() => void load()}
      emptyState="当前组织还没有任何 skill。这里就是真实空态 —— 不会替你生成示例 skill。"
      searchPlaceholder="按名字、ID、职责或标签搜索 skill…"
      selectedKey={selectedKey}
      onSelect={setSelectedKey}
      detailTestId="skill-detail-panel"
      detailWidth="lg"
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.source} · ${row.status} · ${row.skillId}`}
      renderDetail={(row) => (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col divide-y divide-border-subtle">
            <KV k="职责" v={row.duty} />
            <KV k="可见范围" v={VISIBILITY_LABEL[row.visibility]} />
            <KV k="当前版本" v={row.currentVersionId ?? "还没有生效版本"} />
            <KV k="满意度" v={row.satisfaction === null ? "样本不足" : `${Math.round(row.satisfaction * 100)}%`} />
            {(row.tags ?? []).length > 0 ? <KV k="标签" v={(row.tags ?? []).join("、")} /> : null}
          </div>
          {isSourceFileBacked(row) ? (
            <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-panel p-3">
              <p className="text-11 text-muted-foreground">
                这条 skill 的内容在源文件里（`skills` 表来源）——名称、可见范围与文件树 / 代码
                在独立编辑页里改。
              </p>
              <Button asChild size="xs" variant="outline" className="self-start" data-testid="skill-detail-edit-source">
                <a href={editSourceHref(row.skillId)}>编辑源码</a>
              </Button>
            </div>
          ) : null}
          {detailState?.skillId === row.skillId && detailState.status === "loading" ? (
            <p data-testid="skill-detail-loading" className="text-11 text-muted-foreground">正在读取契约…</p>
          ) : null}
          {detailState?.skillId === row.skillId && detailState.status === "error" ? (
            <p data-testid="skill-detail-error" className="text-12 text-destructive">
              详情读取失败：{detailState.message}
            </p>
          ) : null}
          {detailState?.skillId === row.skillId && detailState.status === "ready" ? (
            <DetailBody detail={detailState.detail} onStatusChanged={onStatusChanged} />
          ) : null}
          <p className="text-10 text-muted-foreground">
            没有「删除」：对存在任何引用的 skill 硬删永久拒绝，停用（`POST /skills/:id/disable`）本波次
            没有引用清单生产者、必然被拒——摆一个注定失败的按钮比没有按钮更糟。
          </p>
        </div>
      )}
    >
      {creating ? (
        <Modal
          title="新建 Skill"
          subtitle="两条路径：从 GitHub 导入／从市场挑一个改"
          onClose={() => setCreating(false)}
          testid="skill-create-modal"
          width="lg"
        >
          <div className="flex flex-col gap-3" data-testid="skill-create-launcher">
            <CreateModeTabs mode={createMode} onChange={setCreateMode} />
            {createMode === "import" ? (
              <SkillUrlImportPanel key={orgId} onImported={load} />
            ) : null}
            {createMode === "market" ? <MarketPickUnavailable /> : null}
          </div>
        </Modal>
      ) : null}
    </EntityCatalog>
  );
}

/* ── 新建 Skill 两条路径（F192 之后）────────────────────────────────────
 *
 * 2026-08-13 —— 人类给了两张后台原型截图核对，「新建 Skill」曾长出三条路径
 * （完全新建 / 导入 / 从市场挑一个改）。F192（design-delta
 * `skill-model-a-b-convergence` 选项②，issue #598）之后，**「完全新建」这条
 * 路径已下线**：它写的是模型 B（`skill_contracts`，声明式契约），而模型 B 建出来的
 * skill 运行时读不到、chat 里挂不上（`execute-run.ts` 只读模型 A）——是一条
 * "功能性死路"。`POST /skills`（原 `createSkillDraft` 的路由）现在对任何请求都返回
 * `410 Gone`（`skill.controller.ts`），前端不再摆一个必然被拒的表单。
 *
 * 剩下两条路径，逐条核实过后端能给什么，**只接已经真实存在的后端**：
 *
 *   · **导入** —— `POST /admin/skills/url-imports`（#595，模型 A）真实存在，
 *     `apps/web` 里已经有对应组件 `SkillUrlImportPanel`
 *     （`components/admin/skill-url-import-panel.tsx`，#881 F2）。这是 F192
 *     之后**默认**的 tab——声明式录入并入模型 A 的编辑器工作流（可以先用
 *     starter-pack / URL 导入起步，再用文件编辑器补内容）。
 *   · **从市场挑一个改** —— 没有对应后端。`packages/contracts/src/*.ts` 里
 *     不存在任何 market/marketplace 相关操作；「Claude Code 社区 1,842 个 ·
 *     已同步 34」这类数字只存在于 `components/asset-governance/ag-screens.tsx`
 *     的 `AgNewSkill`（签核用 UI 先行原型，`lib/mock/asset-governance.ts` 的
 *     `AG_MARKET_CARDS` 纯 mock）。这里**不**把那份 mock 数字搬过来冒充真实——
 *     `MarketPickUnavailable` 如实说「未接后端」，并指向登记这个缺口的 issue。
 *
 * ⚠ 「空白骨架 + 文件浏览器 + 代码编辑器从头写」这条路径在 `asset-governance`
 *   契约里也找不到对应操作：`getAssetDirectory` / `readAssetFile` /
 *   `writeAssetFile` / `createAssetFile` 全部要求一个**已经存在**的 `assetId`
 *   （见 `packages/contracts/src/asset-governance.ts` `getAssetDirectory` 的
 *   `in: { assetKind, assetId }`）——`AgSkillEditor`（`asset-governance` 束，
 *   #933）编辑的是**已建好**的 skill，不能拿它开一个还不存在的新 skill。
 *   缺的是一个「创建只带 SKILL.md 骨架的空白 skill 记录」的后端操作，不是这次
 *   改动能顺手补的契约面（新契约需要单独走 ADR-023 签核），已记录为独立 issue。
 */

type CreateMode = "import" | "market";

const CREATE_MODE_TABS: readonly { id: CreateMode; label: string }[] = [
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

function DetailBody({
  detail,
  onStatusChanged,
}: {
  detail: SkillDetail;
  onStatusChanged: (skillId: string, status: SkillListItem["status"]) => void;
}) {
  const { contract, gateResults } = detail;
  return (
    <div className="flex flex-col gap-3" data-testid="skill-detail-contract">
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
    </div>
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
        安全扫描（自动）与方法论审核（人工）是<strong className="text-background-foreground">并列</strong>的两道门，
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
      <pre className="whitespace-pre-wrap font-mono text-11 text-background-foreground">{body}</pre>
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
