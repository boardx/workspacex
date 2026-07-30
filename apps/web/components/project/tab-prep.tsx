"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionTitle, StatChip, ObserverNotice } from "./parts";
import {
  PROJECT_HEADER, PREP_GROUPS, AGENDA, BLUEPRINT_CATALOG, PROJECT_ROLE_LABEL,
  ROLE_CAN_WRITE, observerHidden, type ProjectRole,
} from "@/lib/mock/project";

/**
 * 项目筹备（原型 isWsScope / isWsAgenda）—— 复用 tpl 域（套用蓝本、议程环节）。
 * 净新在项目侧的是：定题与分组（四组：场景/组长/组员/访谈对象）+ 议程环节的三角色分工表。
 * ⚠ 「议程环节」命名**已裁决** → D-03a `agenda_segment`（Q-3① 改名对齐）；
 *   UI 显示中文「环节」，testid 统一为 `agenda-segment-*`。
 * ⚠ 观察者显著更少：分组名单（组长/组员/访谈对象）是内部编排，整块消失；只保留定题与议程只读。
 */
export function TabPrep({ view, readOnly = false }: { view: ProjectRole; readOnly?: boolean }) {
  const canWrite = ROLE_CAN_WRITE[view] && !readOnly;
  const isObserver = observerHidden(view);
  const roleKeys: ProjectRole[] = ["facilitator", "groupLead", "member"];
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-prep">
      {/* 定题 */}
      <section>
        <SectionTitle meta="蓝本决定环节骨架，改动只影响这一场">定题与分组</SectionTitle>
        <Card><div className="flex flex-col gap-2 p-4" data-testid="project-prep-topic">
          <h3 className="text-14 font-medium leading-snug">{PROJECT_HEADER.question}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <StatChip tone="success">已套用蓝本 {BLUEPRINT_CATALOG[0]?.name}</StatChip>
            <StatChip>{BLUEPRINT_CATALOG[0]?.meta}</StatChip>
            <span className="text-10 text-muted-foreground">工作坊模板骨架 · 环节字段名已定为 agenda_segment（D-03a）</span>
          </div>
        </div></Card>
      </section>

      {/* 四组：场景 / 组长 / 组员 / 访谈对象 —— 观察者不可见（内部编排） */}
      {isObserver ? (
        <ObserverNotice
          testId="project-prep-observer-notice"
          what="分组名单（组长 / 组员 / 访谈对象）与筹备编排属于内部协作视图，不在观察者只读范围内。你能看到的是定题与下方议程骨架。"
        />
      ) : (
        <section>
          <SectionTitle meta="每组：场景 · 组长 · 组员 · 访谈对象">分组与组长</SectionTitle>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" data-testid="project-prep-groups">
            {PREP_GROUPS.map((g) => (
              <Card key={g.id} data-testid={`project-prep-group-${g.id}`}>
                <div className="flex flex-col gap-1.5 p-3.5 text-11">
                  <div className="flex items-center gap-2">
                    <span className="text-12 font-medium">{g.name}</span>
                    <StatChip>{g.scenario}</StatChip>
                  </div>
                  <Row k="组长" v={g.lead} />
                  <Row k="组员" v={g.members} />
                  <Row k="访谈对象" v={g.interviewee} />
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* 议程环节 · 三角色分工表（只读骨架，四视角都可见） */}
      <section>
        <SectionTitle meta="编排一次，三套视图与待办自动生成">议程 · 每个环节三种角色各做什么</SectionTitle>
        <Card>
          <div className="grid grid-cols-[auto_repeat(3,1fr)] gap-x-3 gap-y-0 p-1 text-11" data-testid="project-prep-agenda">
            <div className="border-b border-border px-2.5 py-2 text-10 font-medium uppercase tracking-wide text-muted-foreground">环节</div>
            {roleKeys.map((r) => (
              <div key={r} className="border-b border-border px-2.5 py-2 text-10 font-medium uppercase tracking-wide text-muted-foreground">{PROJECT_ROLE_LABEL[r]}</div>
            ))}
            {AGENDA.map((seg) => (
              <RowGroup key={seg.no} seg={seg} roleKeys={roleKeys} />
            ))}
          </div>
        </Card>
        <p className="mt-2 px-1 text-10 text-muted-foreground">
          每一格都会变成对应角色的一条待办，同步到「待办」看板里；组长切换环节状态后，三种视角的首屏立刻跟着换。
        </p>
        {canWrite && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" data-testid="project-prep-edit-agenda">去议程里细调</Button>
            <Button size="sm" variant="ghost" className="transition-colors" data-testid="project-prep-save-template">另存为组织模板</Button>
          </div>
        )}
      </section>
    </div>
  );
}

function RowGroup({ seg, roleKeys }: { seg: typeof AGENDA[number]; roleKeys: ProjectRole[] }) {
  return (
    <>
      <div className={`px-2.5 py-2.5 ${seg.current ? "bg-panel" : ""}`} data-testid={`agenda-segment-${seg.no}`}>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-10 text-muted-foreground">{seg.no}</span>
          <span className="font-medium">{seg.title}</span>
          {seg.current && <StatChip tone="ai">当前</StatChip>}
        </div>
        <div className="mt-0.5 text-10 text-muted-foreground">{seg.meta}</div>
      </div>
      {roleKeys.map((r) => (
        <div key={r} className={`px-2.5 py-2.5 text-muted-foreground ${seg.current ? "bg-panel" : ""}`}>
          {seg.roles[r as keyof typeof seg.roles]}
        </div>
      ))}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 flex-1 text-card-foreground">{v}</span>
    </div>
  );
}
