"use client";
import { Card } from "@/components/ui/card";
import { SectionTitle, ObserverNotice } from "./parts";
import { observerHidden, type ProjectRole } from "@/lib/project-workbench";
import { ProjectBrainPanel } from "./project-brain-panel";

/**
 * 研究总览（原型 isWsRov）—— 研究 / 访谈 / 问卷 / 深度研究在项目下的汇总投影。
 *
 * ⚠ 此前三块（洞察库 / 洞察来源分布 / 尚未验证的假设）渲染的是 `lib/mock/project.ts` 的虚构数据，
 *   已删除；本版三块如实空态。接真实数据是项目中枢 B2 的工作。
 * ⚠ 观察者显著更少：原始洞察库与未验证假设是内部研究过程，整块消失。
 * ⚠ 项目中枢 R8：「项目大脑」面板（`ProjectBrainPanel`）——项目记忆 L2 的真实结论，按类型分组。
 */
export function ResearchOverview({ view, readOnly = false, projectId }: {
  view: ProjectRole; readOnly?: boolean; projectId?: string;
}) {
  void readOnly;
  const isObserver = observerHidden(view);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-research">
      <p className="rounded-md border border-border bg-panel px-3 py-2 text-11 text-muted-foreground">
        本屏将汇总研究 / 访谈 / 问卷 / 深度研究在本项目下的产出。这些能力尚未挂到项目上，暂无可汇总的真实数据。
      </p>

      {projectId ? <ProjectBrainPanel projectId={projectId} /> : null}

      {isObserver ? (
        <ObserverNotice
          testId="project-research-observer-notice"
          what="原始洞察库与尚未验证的假设属于内部研究过程，不在观察者只读范围内。你能看到的是下方脱敏的洞察来源分布。"
        />
      ) : (
        <section>
          <SectionTitle meta="每条都必须能点回原始证据">洞察库</SectionTitle>
          <Card>
            <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-research-insights-empty">
              本项目还没有洞察。洞察目前只挂在单场访谈下，项目维度的洞察库尚未接通。
            </p>
          </Card>
        </section>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <section>
          <SectionTitle>洞察来源分布</SectionTitle>
          <Card>
            <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-research-sources-empty">
              暂无数据。只有真人来源能把洞察标成「强」，虚拟来源将单独计数。
            </p>
          </Card>
        </section>

        {!isObserver && (
          <section>
            <SectionTitle>尚未验证的假设</SectionTitle>
            <Card>
              <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-research-unverified-empty">
                暂无数据。项目级假设尚未建模。
              </p>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
