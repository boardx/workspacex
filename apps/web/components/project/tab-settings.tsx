"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { SectionTitle, StatChip } from "./parts";
import {
  SETTINGS_SECTIONS, PARTICIPANTS, INVITE_IDENTITIES, AI_PERMISSIONS, PROJECT_HEADER,
  ROLE_CAN_WRITE, type ProjectRole,
} from "@/lib/mock/project";

/**
 * 设置（原型 isWsSetup）—— 六块：工作流编排 / 参与者与邀请 / 基本信息 / AI 权限 / 知识图谱 / 产出与留存。
 * ⚠ 设置只有引导师与项目负责人可改；观察者/组员看到只读投影（此原型用 canWrite 投影）。
 */
export function TabSettings({ view }: { view: ProjectRole }) {
  const canWrite = ROLE_CAN_WRITE[view] && view !== "member";
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-settings">
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

      {/* 产出与留存 */}
      <section>
        <SectionTitle>产出与留存</SectionTitle>
        <Card><div className="flex flex-col gap-2 p-3.5 text-11 text-muted-foreground" data-testid="project-settings-retention">
          <div className="flex items-center gap-2"><span className="text-success">✓</span><span>结束后自动写回组织大脑</span></div>
          <div className="flex items-center gap-2"><span className="text-success">✓</span><span>客户可见的分享链接（观察者按已发布内容可见）</span></div>
          <div className="flex items-center gap-2"><span className="text-success">✓</span><span>转录留存 180 天</span></div>
          <p className="mt-1 rounded-md bg-panel px-2.5 py-1.5 text-10">
            本项目研究的是「{PROJECT_HEADER.question.slice(0, 16)}…」；归档 / 生命周期状态未在契约定义 → OPEN-QUESTIONS Q-5。
          </p>
        </div></Card>
      </section>
    </div>
  );
}
