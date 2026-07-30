"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionTitle, StatChip } from "./parts";
import {
  RESULTS, CANDIDATE_DECISIONS, AUDIT_TRAIL, ROLE_CAN_WRITE, type ProjectRole,
} from "@/lib/mock/project";

/**
 * 成果沉淀（原型 isWsAfter）—— 项目结论 / 假设状态 / 成果去向 /
 * 发布结论（危险动作：绑定确定版本 + 二次确认 + 影响范围）/ 候选决策（来自转写，签署是危险动作）/ 审计。
 */
export function TabResults({ view }: { view: ProjectRole }) {
  const canWrite = ROLE_CAN_WRITE[view];
  const canPublish = view === "facilitator"; // [原型] 发布人「林可 · 引导师 有发布授权」
  const [confirmPublish, setConfirmPublish] = React.useState(false);
  const h = RESULTS.hypothesis;
  const d = RESULTS.destinations;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-results">
      {/* 项目结论 */}
      <section>
        <SectionTitle meta={RESULTS.conclusion.signedBy}>项目结论</SectionTitle>
        <Card><div className="p-4 text-13 leading-relaxed" data-testid="project-results-conclusion">{RESULTS.conclusion.text}</div></Card>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* 假设状态 */}
        <section>
          <SectionTitle>假设状态</SectionTitle>
          <Card><div className="flex items-center justify-around p-4" data-testid="project-results-hypothesis">
            <Stat n={h.verified} label="已验证" tone="text-success" />
            <Stat n={h.pending} label="待验证" tone="text-warning" />
            <Stat n={h.refuted} label="已推翻" tone="text-destructive" />
          </div></Card>
        </section>
        {/* 成果去向 */}
        <section>
          <SectionTitle>成果去向</SectionTitle>
          <Card><div className="flex items-center justify-around p-4" data-testid="project-results-destinations">
            <Stat n={d.decisions} label="决策记录" />
            <Stat n={d.insights} label="新增洞察" />
            <Stat n={d.actions} label="行动项" />
          </div></Card>
        </section>
      </div>

      {/* 发布结论 —— 危险动作，必须绑定确定版本 */}
      {canPublish && (
        <section>
          <SectionTitle meta="必须绑定一个确定的产出版本">发布结论</SectionTitle>
          <Card data-testid="project-results-publish">
            <div className="flex flex-col gap-2.5 p-4">
              <div className="flex items-center gap-2 text-12">
                <span className="flex-1">{RESULTS.publish.boundVersion}</span>
                <StatChip tone="success">{RESULTS.publish.versionTag}</StatChip>
              </div>
              <dl className="flex flex-col gap-1 text-11 text-muted-foreground">
                <Row k="发布范围" v={RESULTS.publish.scope} />
                <Row k="发布人" v={RESULTS.publish.publisher} />
                <Row k="前置检查" v={RESULTS.publish.precheck} />
              </dl>
              <div className="rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-11">
                <span className="font-medium text-warning">保留意见 · 1 条（随结论一起发布）</span>
                <p className="mt-0.5 text-muted-foreground">{RESULTS.publish.reservation}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => setConfirmPublish(true)} data-testid="project-results-publish-btn">
                  发布结论 · 绑定 {RESULTS.publish.versionTag.replace("绑定 ", "")}
                </Button>
                <Button size="sm" variant="outline" data-testid="project-results-preview-btn">预览客户版</Button>
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* 候选决策 —— 来自转写，签署是危险动作 */}
      {canWrite && (
        <section>
          <SectionTitle meta="来自转写 · 每条带引用位置，签署前可回听">候选决策</SectionTitle>
          <div className="flex flex-col gap-2" data-testid="project-results-candidates">
            {CANDIDATE_DECISIONS.map((c) => (
              <Card key={c.id} data-testid={`project-results-candidate-${c.id}`}>
                <div className="flex flex-col gap-2 p-3.5">
                  <p className="text-12 font-medium">{c.text}</p>
                  <div className="flex flex-wrap items-center gap-2 text-10 text-muted-foreground">
                    <span className="font-mono">{c.transcript}</span>
                    <span>{c.basis}</span>
                    <StatChip tone="ai">{c.extractedBy}</StatChip>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={c.canSign ? "flex-1 text-10 text-success" : "flex-1 text-10 text-muted-foreground"}>{c.authz}</span>
                    <Button
                      size="xs"
                      variant={c.canSign ? "primary" : "outline"}
                      disabled={!c.canSign}
                      data-testid={`project-results-sign-${c.id}`}
                    >
                      {c.signLabel}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
            <p className="px-1 text-10 text-muted-foreground">另有 3 条被 Echo 判为「像结论但没人拍板」，不进台账</p>
          </div>
        </section>
      )}

      {/* 审计与反馈（所有角色可见其存在，观察者看脱敏聚合数） */}
      <section>
        <SectionTitle meta="角色 · 版本 · Agent 调用 · 决策，同一条时间线，不可删除">审计与反馈</SectionTitle>
        <Card data-testid="project-results-audit">
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            <StatChip>全部 {AUDIT_TRAIL.totals.all}</StatChip>
            <StatChip>角色变更 {AUDIT_TRAIL.totals.role}</StatChip>
            <StatChip>版本 {AUDIT_TRAIL.totals.version}</StatChip>
            <StatChip tone="ai">Agent 调用 {AUDIT_TRAIL.totals.agent}</StatChip>
            <StatChip>决策 {AUDIT_TRAIL.totals.decision}</StatChip>
          </div>
          <ul className="divide-y divide-border">
            {AUDIT_TRAIL.entries.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-3.5 py-2.5">
                <span className="shrink-0 font-mono text-10 text-muted-foreground">{e.time}</span>
                <StatChip>{e.kind}</StatChip>
                <div className="min-w-0 flex-1">
                  <div className="text-11">{e.text}</div>
                  <div className="text-10 text-muted-foreground">{e.meta}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* 发布二次确认对话框 —— R8：危险动作须二次确认 + 影响范围 */}
      {confirmPublish && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-inverse/40 p-4" role="dialog" aria-modal="true" data-testid="project-results-publish-confirm">
          <Card className="w-full max-w-md">
            <div className="flex flex-col gap-3 p-5">
              <h4 className="text-14 font-semibold">确认发布结论？</h4>
              <p className="text-12 text-muted-foreground">
                发布会把 <span className="font-medium text-card-foreground">{RESULTS.publish.versionTag}</span> 作为
                <span className="font-medium text-card-foreground">确定版本</span>对下列范围可见，且会带上 1 条保留意见：
              </p>
              <ul className="flex flex-col gap-1.5 rounded-md bg-panel p-3 text-11">
                <li>· 影响范围：{RESULTS.publish.scope}</li>
                <li>· 观察者将按已发布内容获得只读权</li>
                <li>· 发布后审计留痕，不可静默撤回</li>
              </ul>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirmPublish(false)} data-testid="project-results-publish-cancel">取消</Button>
                <Button size="sm" variant="destructive" onClick={() => setConfirmPublish(false)} data-testid="project-results-publish-confirm-btn">确认发布</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({ n, label, tone = "text-card-foreground" }: { n: number; label: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`font-mono text-18 tabular-nums ${tone}`}>{n}</span>
      <span className="text-10 text-muted-foreground">{label}</span>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 flex-1 text-card-foreground">{v}</dd>
    </div>
  );
}
