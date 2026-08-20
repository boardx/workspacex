"use client";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionTitle, MetaSep, ObserverNotice } from "./parts";
/**
 * F172：本文件对 `lib/mock/project` 的依赖从 9 个符号收到 4 个。
 * 去掉的五个（`OVERVIEW_STATUS` / `CURRENT_SEGMENT` / `OVERVIEW_TODOS` / `ACTIVITY_FEED` /
 * `PROJECT_ROLE_LABEL`）全部是**编造的展示数据**，契约里没有出处。
 * 留下的四个是别的东西：`PROJECT_HEADER`（页头文案）、`PROJECT_SURFACES`（工作面导航入口，
 * F317 已裁它只是一排跳转）、`ROLE_CAN_WRITE` / `observerHidden`（前端角色投影规则）。
 */
import {
  PROJECT_HEADER, PROJECT_SURFACES, ROLE_CAN_WRITE, observerHidden, type ProjectRole,
} from "@/lib/mock/project";
import {
  PROJECT_KIND_LABEL, PROJECT_STATUS_LABEL, BACKFLOW_BADGE_LABEL,
  type ProjectListItem, type ProjectOverview,
} from "@/lib/live-projects";
// ⚠ F964：`BACKFLOW_BADGE_LABEL` 搬到 `lib/live-projects.ts`（原在本文件私有声明）——
//   「成果沉淀」tab（`tab-results.tsx`）加了第二个消费点，同一份三值闭枚举不再各自抄一份。

/**
 * `findProject`（`listProjects`）与 `getProjectOverview` 两个只读端点各自的
 * 失败面（`@repo/contracts` `project.ts` 的 `err` 数组）目前只会产出这四个
 * reasonCode（`NO_PROJECT_ROLE` / `ADMIN_NOT_SUPERUSER` / `DEPENDENCY_UNAVAILABLE` /
 * `AUTH_SERVICE_UNAVAILABLE`）——此前 UI 把它原样当英文常量甩给用户
 * （「读取失败：ADMIN_NOT_SUPERUSER」），不算「说得清」。
 *
 * 分两类呈现：
 *   · `NO_PROJECT_ROLE` / `ADMIN_NOT_SUPERUSER` 是**分层的正常访问范围**
 *     （`identity.ts` 逐字「这是正常状态不是异常」/「D-18：管理员不是超级用户」），
 *     不是故障——不用 destructive 语气，也不给重试按钮（刷新不会改变你的角色）。
 *     区分组织层（超级用户）与项目层（项目角色）两种挡法，而不是笼统一句「没权限」。
 *   · `DEPENDENCY_UNAVAILABLE` / `AUTH_SERVICE_UNAVAILABLE` 是**真故障**，
 *     destructive 语气 + 可重试（同 `today-board.tsx` `tasks-section-dep-retry`
 *     的既有约定：`window.location.reload()`，不在这里另造一套重试状态机）。
 * 未在名单里的 reasonCode（契约以后新增、或 `HTTP xxx` 兜底）落到默认分支，
 * 原始码仍然保留在文案末尾——不隐藏可追责信息，只是不再让它当唯一信息。
 */
const OVERVIEW_REASON_PRESENTATION: Record<string, { tone: "muted" | "destructive"; retry: boolean; text: string }> = {
  NO_PROJECT_ROLE: {
    tone: "muted",
    retry: false,
    text: "你在这个项目里还没有角色，因此看不到内部数据——这是正常的访问范围（项目层），不是故障。请找引导师或组长把你加进项目。",
  },
  ADMIN_NOT_SUPERUSER: {
    tone: "muted",
    retry: false,
    text: "组织管理员默认看不到项目内部数据（组织层限制）；需要跨项目查看，得先被提升为超级用户。",
  },
  DEPENDENCY_UNAVAILABLE: {
    tone: "destructive",
    retry: true,
    text: "后端依赖服务暂时不可用，不是没有数据——请稍后重试。",
  },
  AUTH_SERVICE_UNAVAILABLE: {
    tone: "destructive",
    retry: true,
    text: "身份校验服务暂时不可用，无法确认你的权限——请稍后重试。",
  },
};

function describeOverviewReason(code: string): { tone: "muted" | "destructive"; retry: boolean; text: string } {
  return OVERVIEW_REASON_PRESENTATION[code] ?? {
    tone: "destructive",
    retry: true,
    text: "读取失败，原因暂不明确——请稍后重试；如果反复出现，请联系管理员。",
  };
}

/** 概览两个真实数据块共用的错误呈现：人话在前、原始 reasonCode 留在括号里，可重试的才给按钮。 */
function OverviewErrorNotice({ code, testId, retryTestId }: { code: string; testId: string; retryTestId: string }) {
  const { tone, retry, text } = describeOverviewReason(code);
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2">
      <p
        className={tone === "destructive" ? "text-11 text-destructive" : "text-11 text-muted-foreground"}
        data-testid={testId}
      >
        {text}（{code}）
      </p>
      {retry ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.location.reload()}
          data-testid={retryTestId}
        >
          <RefreshCw aria-hidden className="h-3 w-3" />重试
        </Button>
      ) : null}
    </div>
  );
}

/**
 * 概览（净新）—— 原型 isWsOver 的转译。
 * 项目在研究的问题 + 现场状态条 + 当前环节（三角色分工卡）+ 待办预览 + 最新动态 + 工作面清单。
 * ⚠ 用「就绪检查 3/3」而非「准备度 %」：后者口径 uc-2-2 已登记 [待确认]，不在本域编分母。
 * ⚠ 观察者显著更少：当前环节分工、待办、动态属**内部协作视图**，整块消失（不是变灰）。
 *
 * ⚠ 「工作面」清单（F317 折入，见 `lib/mock/project.ts` `PROJECT_SURFACES` 头注）
 *   不随观察者裁剪消失——它只是一排跳转入口，目标屏各自的权限判定在各自屏内做。
 *
 * ⚠ F353：概览新增一块「项目基本信息」，接的是真实 `GET /projects`（按 id 在
 *   member/managed 两段里找，见 `lib/live-projects.ts` `findProject`）。其余板块
 *   （问题标题、现场状态条、当前环节、待办、动态）仍是 mock——这次范围只覆盖
 *   「项目基本信息」，其余板块背后是完全不同的契约束（现场/待办/研究），本次不动。
 *
 * ⚠ F362：新增一块「真实概览」，接的是真实 `GET /projects/:projectId/overview`
 *   （控制器路由由 F123 挂好，前端此前一直误以为它没挂，见 `lib/live-projects.ts`
 *   `getProjectOverview` 头注）。只加这一块，白名单四件（当前议程环节 / 四类角色
 *   人数 / 回流列表 / 蓝本名与版本）照契约原样呈现，不新造第五件。
 *
 * ⚠ F172（本次）：上面 F353/F362 两条各自留了「其余 mock 板块本次不动」——**现在动了**。
 *   动的原因是它们与真实数据打架：F362 接真之后，屏上同时存在两份「当前环节」，
 *   一份真、一份是带假倒计时（`12:48`）的 mock 卡，用户无从分辨。
 *   本次处理（净效果是删，不是加）：
 *     · 当前环节卡：标题接真 `currentAgendaSegment`；删掉假倒计时（契约只给
 *       `{title, state}`，没有剩余时长——一个不走动的计时器比没有计时器更糟）；
 *       三角色分工无契约出处，降级为如实说明；
 *     · 现场状态条：五项收敛到有出处的两项（环节 / 角色人数），阶段·就绪检查·计时删除；
 *     · 待办 / 最新动态：全仓无对应端点（待办属 PJ-21），整块降级为如实空态；
 *     · 工作面：保留（F317 已裁它只是一排跳转入口，不是数据展示）。
 *   ⇒ 本文件对 `lib/mock/project` 的依赖由 9 个符号收到 4 个，且剩下的四个都不是假数据。
 *   ⚠ 上面第 26-28 行那段「原型转译」的描述写的是**改动前**的形态，保留作沿革；
 *     以本条为准。
 *
 * ⚠（本次，F964 / issue #1626）：F123/F172/F353/F362 都只保证了「真实数据接线」，没有人管
 *   接线失败时那两条 `liveError`/`liveOverviewError` 怎么呈现——此前是把后端
 *   `reasonCode`（如 `ADMIN_NOT_SUPERUSER`）原样拼进「读取失败：{code}」，对不了解
 *   契约内部命名的用户不算「说得清」。本次加 `OVERVIEW_REASON_PRESENTATION`：
 *   区分「分层的正常访问范围」（`NO_PROJECT_ROLE`=项目层 / `ADMIN_NOT_SUPERUSER`=
 *   组织层，muted 语气、不给重试）与「真故障」（`DEPENDENCY_UNAVAILABLE` /
 *   `AUTH_SERVICE_UNAVAILABLE`，destructive 语气 + 重试按钮）。不新增契约、不新增
 *   板块，只是把已有的两个错误插槽从「英文常量」翻成「人话 + 原始码兜底」。
 */
export function TabOverview({
  view, readOnly = false, projectId, liveProject = null, liveLoading = false, liveError = null,
  liveOverview = null, liveOverviewLoading = false, liveOverviewError = null,
}: {
  view: ProjectRole;
  readOnly?: boolean;
  projectId: string;
  /** F353：真实项目基本信息；`null` = 未登录 / 没有 `?org=` / 还没查到，不是「查询失败」 */
  liveProject?: ProjectListItem | null;
  liveLoading?: boolean;
  liveError?: string | null;
  /** F362：真实概览白名单四件；`null` = 未登录 / 还没查到，不是「查询失败」 */
  liveOverview?: ProjectOverview | null;
  liveOverviewLoading?: boolean;
  liveOverviewError?: string | null;
}) {
  const canWrite = ROLE_CAN_WRITE[view] && !readOnly;
  const isObserver = observerHidden(view);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6" data-testid="project-overview">
      {/* F353：项目基本信息（真实数据） */}
      <section
        data-testid="project-overview-live-info"
        className="flex flex-col gap-1.5 rounded-lg border border-border bg-panel px-3.5 py-2.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-10 font-medium uppercase tracking-wide text-muted-foreground">
            项目基本信息 · 真实数据
          </span>
          {liveLoading ? (
            <span className="text-10 text-muted-foreground" data-testid="project-overview-live-loading">
              加载中…
            </span>
          ) : null}
        </div>
        {liveError !== null ? (
          <OverviewErrorNotice
            code={liveError}
            testId="project-overview-live-error"
            retryTestId="project-overview-live-error-retry"
          />
        ) : liveProject !== null ? (
          <div className="flex flex-wrap items-center gap-2 text-12" data-testid="project-overview-live-name">
            <span className="font-medium">{liveProject.name}</span>
            <Badge tone="outline">{PROJECT_KIND_LABEL[liveProject.kind]}</Badge>
            <Badge tone={liveProject.status === "active" ? "primary" : "outline"}>
              {PROJECT_STATUS_LABEL[liveProject.status]}
            </Badge>
            {liveProject.readOnlyReason !== null ? (
              <Badge tone="outline" data-testid="project-overview-live-readonly">
                只读 · {liveProject.readOnlyReason === "archived" ? "已归档" : "组织已停用"}
              </Badge>
            ) : null}
          </div>
        ) : (
          <p className="text-11 text-muted-foreground" data-testid="project-overview-live-empty">
            暂无真实数据——请先在「项目」列表页登录并进入本项目（需要 URL 带上 <code>?org=</code>）。
          </p>
        )}
      </section>

      {/* F362：真实概览白名单四件（当前议程环节 · 四类角色人数 · 回流列表 · 蓝本名与版本） */}
      <section
        data-testid="project-overview-live-overview"
        className="flex flex-col gap-2 rounded-lg border border-border bg-panel px-3.5 py-2.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-10 font-medium uppercase tracking-wide text-muted-foreground">
            概览 · 真实数据
          </span>
          {liveOverviewLoading ? (
            <span className="text-10 text-muted-foreground" data-testid="project-overview-live-overview-loading">
              加载中…
            </span>
          ) : null}
        </div>
        {liveOverviewError !== null ? (
          <OverviewErrorNotice
            code={liveOverviewError}
            testId="project-overview-live-overview-error"
            retryTestId="project-overview-live-overview-error-retry"
          />
        ) : liveOverview !== null ? (
          <div className="flex flex-col gap-2 text-12" data-testid="project-overview-live-overview-body">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-10 font-medium uppercase tracking-wide text-muted-foreground">当前议程环节</span>
              {liveOverview.currentAgendaSegment !== null ? (
                <span data-testid="project-overview-live-agenda-segment">
                  {liveOverview.currentAgendaSegment.title} · {liveOverview.currentAgendaSegment.state}
                </span>
              ) : (
                <span className="text-muted-foreground" data-testid="project-overview-live-agenda-segment-empty">无</span>
              )}
            </div>
            {liveOverview.roleCounts !== null ? (
              <div className="flex flex-wrap items-center gap-3" data-testid="project-overview-live-role-counts">
                <span>引导师 {liveOverview.roleCounts.facilitator}</span>
                <span>组长 {liveOverview.roleCounts.groupLead}</span>
                <span>组员 {liveOverview.roleCounts.member}</span>
                <span>观察者 {liveOverview.roleCounts.observer}</span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-10 font-medium uppercase tracking-wide text-muted-foreground">回流</span>
              {liveOverview.backflow.length === 0 ? (
                <span className="text-muted-foreground" data-testid="project-overview-live-backflow-empty">暂无</span>
              ) : (
                <span data-testid="project-overview-live-backflow-count">
                  {liveOverview.backflow.length} 条 · {liveOverview.backflow.map((b) => BACKFLOW_BADGE_LABEL[b.badge]).join("、")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-10 font-medium uppercase tracking-wide text-muted-foreground">蓝本</span>
              {liveOverview.blueprint !== null ? (
                <span data-testid="project-overview-live-blueprint">
                  {liveOverview.blueprint.name} · v{liveOverview.blueprint.version}
                </span>
              ) : (
                <span className="text-muted-foreground" data-testid="project-overview-live-blueprint-empty">空白新建</span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-11 text-muted-foreground" data-testid="project-overview-live-overview-empty">
            暂无真实数据——请先登录。
          </p>
        )}
      </section>

      {/* 项目在研究的问题（mock，非本次范围）*/}
      <header className="flex flex-col gap-2">
        <h2 className="max-w-2xl text-18 font-semibold leading-snug" data-testid="project-overview-question">
          {PROJECT_HEADER.question}
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-11 text-muted-foreground">
          <span>{PROJECT_HEADER.org}集团</span>
          <span>引导师 {PROJECT_HEADER.facilitatorName}</span>
          <span>{PROJECT_HEADER.reportDate}</span>
        </div>
      </header>

      {/*
        现场状态条（聚合，四视角都能看）—— F172：只画有出处的两项。
        原型这条状态条有五项（阶段 / 当前环节 / 就绪检查 / 出席 / 计时），其中
        「当前环节」与「出席」在 `getProjectOverview` 里有真实来源，另外三项
        （阶段 / 就绪检查 / 计时）契约里没有，本版不再渲染编造值。
        白名单是封闭的四件（F123 裁），补第五件属修订已签核裁决，不是「补一个板块」。
      */}
      <div
        data-testid="project-overview-statusbar"
        className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-panel px-3.5 py-2.5"
      >
        <span className="text-11" data-testid="project-overview-statusbar-segment">
          {liveOverview?.currentAgendaSegment != null
            ? `${liveOverview.currentAgendaSegment.title} · ${liveOverview.currentAgendaSegment.state}`
            : "当前没有进行中的环节"}
        </span>
        <MetaSep />
        <span className="text-11 text-muted-foreground" data-testid="project-overview-statusbar-attendance">
          {liveOverview?.roleCounts != null
            ? `引导师 ${liveOverview.roleCounts.facilitator} · 组长 ${liveOverview.roleCounts.groupLead} · 组员 ${liveOverview.roleCounts.member} · 观察者 ${liveOverview.roleCounts.observer}`
            : "角色人数暂不可读"}
        </span>
      </div>

      {isObserver ? (
        <ObserverNotice
          testId="project-overview-observer-notice"
          what="当前环节的三角色分工、内部待办与协作动态属于内部协作视图，不在观察者只读范围内。你能看到的是上方的项目问题与现场进度聚合。"
        />
      ) : (
        <>
          {/*
            当前环节卡 —— F172：标题接真，倒计时与三角色分工不再编造。

            改前这张卡整卡是 mock：标题、一个不走动的假倒计时（`CURRENT_SEGMENT.countdown`），
            外加三个角色「各该做什么」的文案与 CTA。而 F362 接真的议程环节块就在同一屏上方
            ——同一个概念在一屏里一真一假两份，是本次要修掉的主要缺陷。

            契约 `getProjectOverview.out.currentAgendaSegment` 只给 `{title, state}`：
            · 倒计时：契约没有剩余时长 ⇒ 删（一个不走动的计时器比没有计时器更糟）；
            · 三角色分工：「这个环节里每个角色该做什么」在契约里没有出处 ⇒ 不渲染编造文案。
              这不是砍掉已签核的 UI，是把它降级为如实的空态——它要真，得先有契约（PJ-20 现场协作）。
          */}
          <Card data-testid="project-overview-current-segment">
            <div className="flex items-center gap-3 rounded-t-lg bg-inverse px-4 py-3 text-inverse-foreground">
              <div className="min-w-0 flex-1 truncate text-14 font-medium" data-testid="project-overview-current-segment-title">
                {liveOverview?.currentAgendaSegment != null
                  ? `${liveOverview.currentAgendaSegment.title} · ${liveOverview.currentAgendaSegment.state}`
                  : "当前没有进行中的环节"}
              </div>
            </div>
            <p
              className="border-t border-border px-4 py-3 text-11 leading-relaxed text-muted-foreground"
              data-testid="project-overview-current-segment-roles-unavailable"
            >
              这个环节里各角色分别该做什么，契约里还没有出处，本版不显示。
              环节的推进与角色分工属于现场协作那一束，接真后才会出现在这里。
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-[1.25fr_1fr]">
            {/*
              待办 —— F172：契约里根本没有待办这个东西（`getProjectOverview` 白名单四件里没有它，
              全仓也没有任何待办端点）。原型这三条是手写的示例数据，其中「1 项阻塞」这种
              计数尤其危险：它看起来像算出来的。本版整块降级为如实空态。
              待办看板要真，得先走一遍契约设计流程 —— 那是 PJ-21，本 feature 不越界替它定义。
            */}
            <section>
              <SectionTitle>待办</SectionTitle>
              <Card>
                <p className="px-3.5 py-3 text-11 leading-relaxed text-muted-foreground" data-testid="project-overview-todos-unavailable">
                  项目待办还没有契约来源，本版不显示。它需要先定义「待办从哪里来、谁能改、
                  完成算什么」，那是一次独立的契约设计，不是这一屏能顺手补出来的。
                </p>
              </Card>
            </section>

            {/*
              最新动态 —— F172：同上，契约里没有动态流。原型这条混合了人与 AI 的活动，
              它的真实来源应当是溯源/审计事件，但 `getProjectOverview` 不返回它们，
              也没有别的端点提供「这个项目最近发生了什么」。不编。
            */}
            <section>
              <SectionTitle>最新动态</SectionTitle>
              <p className="border-b border-border py-2.5 text-11 leading-relaxed text-muted-foreground" data-testid="project-overview-activity-unavailable">
                项目动态流还没有契约来源，本版不显示。已回流的产出在上方「真实概览」里，
                那是目前唯一有出处的「最近发生了什么」。
              </p>
            </section>
          </div>
        </>
      )}

      {/* 工作面（F317 折入：原 `/projects/[projectId]` 枢纽页内容，现挂在概览尾部）*/}
      <section className="flex flex-col gap-2" data-testid="project-home-surfaces">
        <SectionTitle>工作面</SectionTitle>
        <ul className="flex flex-col gap-1.5">
          {PROJECT_SURFACES.map((s) => {
            const href = s.key === "chat"
              ? `/chat?projectId=${encodeURIComponent(projectId)}`
              : s.href
                ? s.href.startsWith("/") ? s.href : `/projects/${projectId}/${s.href}`
              : null;
            const body = (
              <>
                <s.icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="w-20 shrink-0 text-13 font-medium">{s.label}</span>
                <span className="min-w-0 flex-1 truncate text-11 text-muted-foreground">
                  {s.pending ?? s.desc}
                </span>
                {s.pending && <Badge tone="outline">未建</Badge>}
              </>
            );
            return (
              <li key={s.key}>
                {href ? (
                  <a
                    href={href}
                    data-testid={`project-home-surface-${s.key}`}
                    className="flex items-center gap-3 rounded-md border border-border-subtle bg-panel px-3 py-2 transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {body}
                  </a>
                ) : (
                  // 尚未建的屏：显式禁用 + 写明原因。静默无反应是缺陷；显式禁用是设计。
                  <div
                    data-testid={`project-home-surface-${s.key}`}
                    aria-disabled="true"
                    title={s.pending}
                    className="flex cursor-not-allowed items-center gap-3 rounded-md border border-dashed border-border bg-disabled px-3 py-2 text-disabled-foreground"
                  >
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

