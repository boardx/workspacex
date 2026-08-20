"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { SectionTitle, StatChip } from "./parts";
import { ROLE_CAN_WRITE, ROLE_STAGE_CONTROL, type ProjectRole } from "@/lib/mock/project";
import { BACKFLOW_BADGE_LABEL, type ProjectOverview } from "@/lib/live-projects";
import type { QueryProvenanceOut, ProvenanceEventType } from "@/lib/live-provenance";

/**
 * 成果沉淀（原型 isWsAfter，F965 接真）—— 项目结论 / 假设状态 / 成果去向 /
 * 发布结论 / 候选决策 / 审计与反馈。
 *
 * ⚠ **这次的接线不是「全部接真」，是按 `lib/mock/project.ts` 头注（第 22-26 行）
 *   逐条核实契约有没有出处，分两类处理**——同 F172（`tab-overview.tsx`）与 F963
 *   （`tab-live.tsx`）建立的纪律：把有出处的接真，把没出处的编造数据整块降级为
 *   如实空态，不让两者同屏并列、用户分不清真假。
 *
 * 接真的两块（`coverage.md` 逐字点名的前端消费点）：
 *   · **成果去向** —— uc-00-2 V1/V8/V9：接 `getProjectOverview` 返回的白名单字段
 *     `backflow`（`listBackflow` 的项目侧投影，phase-00 已签核已实现，`tab-overview.tsx`
 *     F362 已经用过同一份数据，本次是第二个消费点，不重新声明第二次拉取）。
 *   · **审计与反馈** —— uc-00-1 V10 / uc-00-3 V11：接 `queryProvenance`（phase-00 唯一
 *     的审计检索面，`live-provenance.ts` 头注「不许另造」），按 `targetKind:"project"`
 *     + `targetId` 收窄到本项目。
 *
 * 降级为如实空态的四块（`lib/mock/project.ts` 第 22-26 行逐条标注「契约未建模」）：
 *   · **项目结论**（结论文本 + 签字人）—— 全仓没有「项目结论」这个实体，`provenance`
 *     只记事件不记结论文本，`getProjectOverview` 白名单四件里没有它。
 *   · **假设状态**（已验证/待验证/已推翻计数）—— 全仓 grep `hypothesis`/「假设状态」
 *     零命中，没有假设实体，遑论其状态机。
 *   · **发布结论**（危险动作：绑定确定版本 + 二次确认）—— 没有「发布」这个领域动作，
 *     点「发布」除了在本地 `setState` 弹一个对话框、不产生任何真实副作用，这正是
 *     AGENTS.md 点名的「假功能缺陷」，不能留（不同于「数据展示缺口」，这是危险动作
 *     没有真实后果却看起来像有）。
 *   · **候选决策**（来自转写待签署）—— 没有「候选决策」实体，`签署` 按钮同上没有
 *     真实副作用，同一理由降级。
 *   这四块契约层面缺什么、需要补哪些领域模型，登记在 `coverage.md`
 *   uc-00-2/uc-00-3 对应行与本 feature 的 `design-signoff.md` 追加说明里，
 *   不在这里发明。
 */
export function TabResults({
  view, readOnly = false,
  liveOverview = null, liveOverviewLoading = false, liveOverviewError = null,
  liveAudit = null, liveAuditLoading = false, liveAuditError = null,
}: {
  view: ProjectRole;
  readOnly?: boolean;
  /** F965：白名单四件里的 `backflow`；`null` = 未登录 / 没有 `?org=` / 还没查到 */
  liveOverview?: ProjectOverview | null;
  liveOverviewLoading?: boolean;
  liveOverviewError?: string | null;
  /** F965：按本项目收窄的真实审计事件；`null` = 未登录 / 没有 `?org=` / 还没查到 */
  liveAudit?: QueryProvenanceOut | null;
  liveAuditLoading?: boolean;
  liveAuditError?: string | null;
}) {
  const canWrite = ROLE_CAN_WRITE[view] && !readOnly;
  const canPublish = ROLE_STAGE_CONTROL[view] && !readOnly;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-results">
      {/* 项目结论 —— 契约未建模，四视角都如实说明不可用（不发明结论文本） */}
      <section>
        <SectionTitle meta="全仓无「项目结论」实体，暂不可用">项目结论</SectionTitle>
        <Card>
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-results-conclusion-unavailable">
            项目结论（结论文本 + 签字人）在 project 束契约里还没有出处——`getProjectOverview`
            的白名单四件与 `queryProvenance` 都不覆盖它。要真，得先补一个承载结论文本与签字的
            领域模型，那是接下来的 feature，本版不显示编造文案。
          </p>
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* 假设状态 —— 契约未建模 */}
        <section>
          <SectionTitle meta="全仓无「假设」实体，暂不可用">假设状态</SectionTitle>
          <Card>
            <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-results-hypothesis-unavailable">
              已验证/待验证/已推翻这三个计数在契约里没有任何字段能表达——全仓没有「假设」
              这个实体，遑论它的状态机，不显示编造数字。
            </p>
          </Card>
        </section>
        {/* 成果去向 —— 接真：getProjectOverview.backflow（uc-00-2 V1/V8/V9） */}
        <section>
          <SectionTitle meta="listBackflow · 项目侧回流投影">成果去向</SectionTitle>
          <Card>
            <BackflowPanel overview={liveOverview} loading={liveOverviewLoading} error={liveOverviewError} />
          </Card>
        </section>
      </div>

      {/* 发布结论 —— 契约未建模：没有「发布」这个领域动作，不留一个只弹本地对话框
          却不产生真实副作用的危险按钮（那是假功能缺陷，不是数据展示缺口） */}
      {canPublish && (
        <section>
          <SectionTitle meta="全仓无「发布结论」领域动作，暂不可用">发布结论</SectionTitle>
          <Card>
            <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-results-publish-unavailable">
              发布结论（绑定确定版本 + 二次确认 + 影响范围）在契约里还没有对应的写操作——
              点一个只在本地弹对话框、不产生真实副作用的「发布」按钮比没有按钮更糟（用户会
              以为真的发布了）。要真，得先补 `publishConclusion` 这类写操作与它的错误面，
              那是接下来的 feature，本版不放这个按钮。
            </p>
          </Card>
        </section>
      )}

      {/* 候选决策 —— 契约未建模：没有「候选决策」实体，同上理由不放签署按钮 */}
      {canWrite && (
        <section>
          <SectionTitle meta="全仓无「候选决策」实体，暂不可用">候选决策</SectionTitle>
          <Card>
            <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-results-candidates-unavailable">
              候选决策（来自转写、签署前可回听）在契约里没有承载它的实体——`provenance`
              只记「谁在什么时候做了什么」，不记「转写里哪句话是一条待签署的决策」。要真，
              得先补一个候选决策的领域模型与提取/签署两个写操作，本版不显示编造的候选列表。
            </p>
          </Card>
        </section>
      )}

      {/* 审计与反馈 —— 接真：queryProvenance（uc-00-1 V10 / uc-00-3 V11） */}
      <section>
        <SectionTitle meta="queryProvenance · 按本项目收窄 · 不可删除">审计与反馈</SectionTitle>
        <Card data-testid="project-results-audit">
          <AuditPanel audit={liveAudit} loading={liveAuditLoading} error={liveAuditError} />
        </Card>
      </section>
    </div>
  );
}

function BackflowPanel({
  overview, loading, error,
}: { overview: ProjectOverview | null; loading: boolean; error: string | null }) {
  if (loading) {
    return <div className="p-4 text-11 text-muted-foreground" data-testid="project-results-destinations-loading">读取回流列表中…</div>;
  }
  if (error) {
    return (
      <div className="p-4 text-11 text-destructive" data-testid="project-results-destinations-error">
        回流列表读取失败：{error}
      </div>
    );
  }
  if (overview === null) {
    return (
      <div className="p-4 text-11 text-muted-foreground" data-testid="project-results-destinations-signed-out">
        暂无真实数据（未登录，或链接未带 `?org=`）
      </div>
    );
  }
  if (overview.backflow.length === 0) {
    return <div className="p-4 text-11 text-muted-foreground" data-testid="project-results-destinations-empty">暂无已回流的产出</div>;
  }
  return (
    <ul className="divide-y divide-border" data-testid="project-results-destinations-list">
      {overview.backflow.map((b) => (
        <li key={b.bindingId} className="flex items-center gap-2.5 px-3.5 py-2.5 text-11">
          <StatChip tone={b.badge === "pinned" ? "success" : b.badge === "live" ? "ai" : "neutral"}>
            {BACKFLOW_BADGE_LABEL[b.badge]}
          </StatChip>
          <span className="min-w-0 flex-1 truncate">{b.title} · 版本 {b.version}</span>
          <span className="shrink-0 text-10 text-muted-foreground">{b.pinnedBy} · {b.pinnedAt}</span>
        </li>
      ))}
    </ul>
  );
}

const AUDIT_TYPE_LABEL: Partial<Record<ProvenanceEventType, string>> = {
  "unauthorized-attempt": "越权尝试",
};

function AuditPanel({
  audit, loading, error,
}: { audit: QueryProvenanceOut | null; loading: boolean; error: string | null }) {
  if (loading) {
    return <div className="p-3.5 text-11 text-muted-foreground" data-testid="project-results-audit-loading">读取审计事件中…</div>;
  }
  if (error) {
    return (
      <div className="p-3.5 text-11 text-destructive" data-testid="project-results-audit-error">
        审计事件读取失败：{error}
      </div>
    );
  }
  if (audit === null) {
    return (
      <div className="p-3.5 text-11 text-muted-foreground" data-testid="project-results-audit-signed-out">
        暂无真实数据（未登录，或链接未带 `?org=`）
      </div>
    );
  }
  if (audit.events.length === 0) {
    return <div className="p-3.5 text-11 text-muted-foreground" data-testid="project-results-audit-empty">本项目还没有审计事件，不生成示例条目</div>;
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <StatChip testId="project-results-audit-total">共 {audit.events.length} 条{audit.nextCursor ? "+" : ""}</StatChip>
      </div>
      <ul className="divide-y divide-border" data-testid="project-results-audit-list">
        {audit.events.map((e) => (
          <li key={e.id} className="flex items-start gap-3 px-3.5 py-2.5">
            <span className="shrink-0 font-mono text-10 text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
            <StatChip>{AUDIT_TYPE_LABEL[e.type] ?? e.type}</StatChip>
            <div className="min-w-0 flex-1">
              <div className="text-11">actor {e.actorId} → {e.target.kind}:{e.target.id}</div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
