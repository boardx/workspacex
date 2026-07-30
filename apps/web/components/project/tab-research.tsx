"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionTitle, StatChip } from "./parts";
import { INSIGHTS, INSIGHT_SOURCES, UNVERIFIED_HYPOTHESES, ROLE_CAN_WRITE, type ProjectRole } from "@/lib/mock/project";

/**
 * 研究洞察（原型 isWsRov）—— 复用 itv/research/survey 域：本屏是它们在项目下的**投影**，
 * 不重画那些工作台。净新的是「洞察库 + 来源分布 + 尚未验证的假设」这三块项目级汇总。
 * ⚠ 强度只有真人来源能标「强」；虚拟来源单独计数（避免用 AI 生成的共识说服自己）。
 */
export function TabResearch({ view }: { view: ProjectRole }) {
  const canWrite = ROLE_CAN_WRITE[view];
  const maxCount = Math.max(...INSIGHT_SOURCES.map((s) => s.count));
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-research">
      <p className="rounded-md border border-border bg-panel px-3 py-2 text-11 text-muted-foreground">
        本屏是研究 / 访谈 / 问卷 Studio 在本项目下的汇总投影，点任意一条进入对应 Studio 工作台（复用 itv · research · survey 域）。
      </p>

      {/* 洞察库 */}
      <section>
        <SectionTitle meta="每条都必须能点回原始证据">洞察库 · 12</SectionTitle>
        <div className="flex flex-col gap-2" data-testid="project-research-insights">
          {INSIGHTS.map((i) => (
            <Card key={i.id} data-testid={`project-research-insight-${i.id}`} className={i.expired ? "opacity-70" : ""}>
              <div className="flex flex-col gap-2 p-3.5">
                <p className="text-12 leading-relaxed">{i.text}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatChip>{i.source}</StatChip>
                  <StatChip tone={i.strength === "强" ? "success" : "warning"}>强度 {i.strength}</StatChip>
                  {i.expired && <StatChip tone="danger">已过期 · 不参与定题强度</StatChip>}
                  <span className="flex-1" />
                  {canWrite
                    ? <Button size="xs" variant="outline" data-testid={`project-research-insight-cta-${i.id}`}>{i.expired ? "派任务重新核实" : i.state}</Button>
                    : <span className="text-10 text-muted-foreground">看原始证据</span>}
                </div>
              </div>
            </Card>
          ))}
          <p className="px-1 text-10 text-muted-foreground">其余 8 条洞察 · 可按来源与强度筛选（强 3 · 弱 3 · 探索性 1 · 过期 1）</p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* 来源分布 */}
        <section>
          <SectionTitle>洞察来源分布</SectionTitle>
          <Card><div className="flex flex-col gap-2.5 p-3.5" data-testid="project-research-sources">
            {INSIGHT_SOURCES.map((s) => (
              <div key={s.label} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-11">
                  <span className="min-w-0 truncate text-muted-foreground">{s.label}</span>
                  <span className="font-mono">{s.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(s.count / maxCount) * 100}%` }} />
                </div>
              </div>
            ))}
            <p className="text-10 text-muted-foreground">只有真人来源能把洞察标成「强」。虚拟来源单独计数。</p>
          </div></Card>
        </section>

        {/* 尚未验证的假设 */}
        <section>
          <SectionTitle>尚未验证的假设 · 3</SectionTitle>
          <Card><ul className="divide-y divide-border" data-testid="project-research-unverified">
            {UNVERIFIED_HYPOTHESES.map((h) => (
              <li key={h.id} className="flex flex-col gap-0.5 px-3.5 py-2.5">
                <span className="text-11">{h.text}</span>
                <span className="text-10 text-muted-foreground">{h.note}</span>
              </li>
            ))}
          </ul></Card>
        </section>
      </div>
    </div>
  );
}
