"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { SectionTitle, StatChip, ObserverNotice } from "./parts";
import {
  SETTINGS_SECTIONS, PARTICIPANTS, INVITE_IDENTITIES, AI_PERMISSIONS,
  RETENTION_SETTINGS, RETENTION_DAYS_LABEL, PROJECT_HEADER,
  ROLE_CAN_WRITE, observerHidden, type ProjectRole,
} from "@/lib/mock/project";

/**
 * 设置（原型 isWsSetup）—— 六块：工作流编排 / 参与者与邀请 / 基本信息 / AI 权限 / 知识图谱 / 产出与留存。
 * ⚠ 设置只有引导师与项目负责人可改；组员看只读投影；观察者**整个配置区消失**（只留产出与留存只读）。
 * ⚠ 「客户可见的分享链接」默认**关**——已对原型 JS 数据区核过（v1 曾误画成开，见 V1-WAS-WRONG.md）。
 */
export function TabSettings({ view, readOnly = false }: { view: ProjectRole; readOnly?: boolean }) {
  const canWrite = ROLE_CAN_WRITE[view] && view !== "member" && !readOnly;
  const isObserver = observerHidden(view);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-settings">
      {isObserver ? (
        <ObserverNotice
          testId="project-settings-observer-notice"
          what="设置是项目配置区（工作流 / 参与者 / AI 权限 / 知识图谱），不在观察者只读范围内。你能看到的只有下方的产出与留存策略。"
        />
      ) : (
        <>
          {/* 六块入口 */}
          <section>
            <SectionTitle meta="这场项目的配置枢纽">设置</SectionTitle>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="project-settings-sections">
              {SETTINGS_SECTIONS.map((s) => (
                <Card key={s.key} data-testid={`project-settings-section-${s.key}`}>
                  <div className="flex flex-col gap-1 p-3.5">
                    <span className="text-12 font-medium">{s.title}</span>
                    <span className="text-10 text-muted-foreground">{s.desc}</span>
                  </div>
                </Card>
              ))}
            </div>
          </section>

          {/* 参与者与邀请 */}
          <section>
            <SectionTitle meta="9 / 12 已确认 · 打开即带身份进场，不需要提前注册">参与者与邀请</SectionTitle>
            <Card data-testid="project-settings-participants">
              {canWrite && (
                <div className="flex items-center gap-2 border-b border-border p-3">
                  <span className="flex-1 text-10 text-muted-foreground">身份：{INVITE_IDENTITIES.join(" · ")}</span>
                  <Button size="xs" variant="primary" data-testid="project-settings-invite">邀请</Button>
                </div>
              )}
              <ul className="divide-y divide-border">
                {PARTICIPANTS.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-10 font-medium text-muted-foreground">{p.initial}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-12">{p.name}</div>
                      <div className="text-10 text-muted-foreground">{p.role}</div>
                    </div>
                    {p.status === "已确认"
                      ? <StatChip tone="success">已确认</StatChip>
                      : <StatChip tone="warning">{p.status}</StatChip>}
                  </li>
                ))}
              </ul>
            </Card>
          </section>

          {/* AI 权限 */}
          <section>
            <SectionTitle meta="3 项 · 1 项已关">AI 在这场里的权限</SectionTitle>
            <Card data-testid="project-settings-ai">
              <ul className="divide-y divide-border">
                {AI_PERMISSIONS.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-3.5 py-3">
                    <span className="min-w-0 flex-1 text-12">{a.label}</span>
                    <Toggle checked={a.on} onCheckedChange={() => undefined} label={a.label} disabled={!canWrite} data-testid={`project-settings-ai-${a.id}`} />
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        </>
      )}

      {/* 产出与留存（观察者也能看——它决定观察者能看到什么；默认「分享链接」关） */}
      <section>
        <SectionTitle>产出与留存</SectionTitle>
        <Card data-testid="project-settings-retention">
          <ul className="divide-y divide-border">
            {RETENTION_SETTINGS.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-12">{r.label}</div>
                  {r.note && <div className="text-10 text-muted-foreground">{r.note}</div>}
                </div>
                <Toggle checked={r.on} onCheckedChange={() => undefined} label={r.label} disabled={!canWrite} data-testid={`project-settings-retention-${r.id}`} />
              </li>
            ))}
            <li className="flex items-center gap-3 px-3.5 py-3 text-11 text-muted-foreground">
              <span className="flex-1">{RETENTION_DAYS_LABEL}</span>
              <span className="font-mono text-10">180d</span>
            </li>
          </ul>
          <p className="border-t border-border px-3.5 py-2 text-10 text-muted-foreground">
            本项目研究的是「{PROJECT_HEADER.question.slice(0, 16)}…」；归档 / 生命周期状态未在契约定义 → OPEN-QUESTIONS Q-5。
          </p>
        </Card>
      </section>
    </div>
  );
}
