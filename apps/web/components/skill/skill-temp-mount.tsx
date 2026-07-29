"use client";
import * as React from "react";
import { Plus, Settings2, Sparkles, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { ScreenHead, RoleGate, NewScreenTag } from "./skill-shared";
import { CHAT_MOUNT, TEMP_PICKER, type SkillView } from "@/lib/mock/skill";

export function SkillTempMount({ state, view }: { state: UiState; view: SkillView }) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const canAdd = view === "facilitator" || view === "groupLead";

  return (
    <div className="flex flex-col gap-4">
      <ScreenHead title="对话里临时加减 skill" uc="UC-3.3 R3 · F65">
        引导师/组长在对话输入区上方 ＋加技能：只对<strong className="text-foreground">当前这条对话</strong>生效、不改蓝本。
        组员默认不可自加（服务端拒），临时挂载在复盘里可「提交回蓝本」。
      </ScreenHead>

      <RoleGate view={view} allow={["facilitator", "groupLead", "member", "maintainer"]} what="对话运行时配置带">
        <StateShell
          state={state}
          skeletonRows={2}
          emptyHint="本对话还没有挂载任何 skill——只用本议程环节蓝本绑定"
          errors={{ mount: "临时挂载失败：所选 skill 不在「已启用 ∩ 可见性覆盖你 ∩ 当前角色允许自挂」的池内" }}
          depFailure={{ what: "该 skill 依赖的模型/MCP 暂不可用，无法挂载到当前对话。不静默换模型。" }}
          denial={{ layer: "project", reason: "组员不能在对话里自行加减 skill——只能用引导师下发的" }}
          successMessage="已加入当前对话：Ava ＋3 · skill：假设拆解（仅本对话生效）"
        >
          {/* 运行时配置带（结果态挂载栏，已建成可直接签） */}
          <Card data-testid="skill-chat-configbar">
            <CardContent className="flex flex-col gap-2 pt-4">
              <span className="text-10 uppercase tracking-wide text-muted-foreground">输入区上方 · 运行时配置带</span>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="ai" className="gap-1"><Sparkles aria-hidden className="h-3 w-3" />Ava ＋3</Badge>
                {CHAT_MOUNT.map((m) => (
                  <Badge key={m.skillId} tone={m.origin === "temp" ? "warning" : "outline"} className="gap-1" data-testid={`skill-mount-${m.skillId}`}>
                    skill：{m.name} <span className="font-mono opacity-60">{m.version}</span>
                    {m.origin === "temp" && <span className="text-9">· 临时</span>}
                    {m.origin === "temp" && canAdd && (
                      <button aria-label={`摘掉 ${m.name}`} className="ml-0.5 rounded-full p-0.5 transition-colors duration-200 hover:bg-background/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`skill-mount-remove-${m.skillId}`}>
                        <X aria-hidden className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </Badge>
                ))}
                <span className="text-9 text-muted-foreground">已引用 3 项上下文 · 输出到「假设树」</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canAdd ? (
                  <Button size="xs" variant="primary" onClick={() => setPickerOpen((v) => !v)} data-testid="skill-chat-add">
                    <Plus aria-hidden className="h-3 w-3" /> 加技能 <NewScreenTag>入口原型确认缺失</NewScreenTag>
                  </Button>
                ) : (
                  <span className="text-10 text-destructive" data-testid="skill-chat-add-blocked">
                    组员看不到「＋加技能」；直接调接口挂载会被服务端拒绝并记安全审计。
                  </span>
                )}
                <Button size="xs" variant="ghost" data-testid="skill-chat-more">
                  <Settings2 aria-hidden className="h-3 w-3" /> 更多设置 ▸
                </Button>
              </div>
              <p className="text-9 text-muted-foreground">
                摘掉 skill 即时生效，但历史消息上的 skill 角标保留（不回溯）。
                临时挂载不构成提权，数据范围仍受三层权限约束。
              </p>
            </CardContent>
          </Card>

          {/* ＋加技能选择器（补画）：分两段 */}
          {pickerOpen && canAdd && (
            <Card className="border-primary/30" data-testid="skill-chat-picker">
              <CardContent className="flex flex-col gap-3 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-13 font-semibold">加技能 · 选择器</h3>
                  <NewScreenTag>选择器面板需补画</NewScreenTag>
                </div>

                <section className="flex flex-col gap-1">
                  <span className="text-10 uppercase tracking-wide text-muted-foreground">本议程环节已绑定（只读 · 来自蓝本 · 置顶避免重复挂载）</span>
                  {TEMP_PICKER.boundBySegment.map((s) => (
                    <div key={s.skillId} className="flex items-center justify-between rounded-md border border-border-subtle bg-muted px-2 py-1.5 text-10" data-testid={`skill-picker-bound-${s.skillId}`}>
                      <span>{s.name} <span className="font-mono opacity-60">{s.version}</span></span>
                      <Badge tone="outline">已绑定</Badge>
                    </div>
                  ))}
                </section>

                <section className="flex flex-col gap-1">
                  <span className="text-10 uppercase tracking-wide text-muted-foreground">可临时加载（可选）</span>
                  {TEMP_PICKER.available.map((s) => (
                    <button key={s.skillId} className="flex items-center justify-between rounded-md border border-border-subtle bg-card px-2 py-1.5 text-10 text-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`skill-picker-avail-${s.skillId}`}>
                      <span>{s.name} <span className="font-mono opacity-60">{s.version}</span></span>
                      <Plus aria-hidden className="h-3 w-3" />
                    </button>
                  ))}
                </section>
                <p className="text-9 text-muted-foreground">
                  单次对话临时挂载数量上限待确认（对照 UC-3.2「超 6 个提示分散注意力」）。
                </p>
              </CardContent>
            </Card>
          )}

          {/* 复盘：临时加载标记 + 提交回蓝本 */}
          <Card data-testid="skill-chat-retro">
            <CardContent className="flex flex-col gap-2 pt-4">
              <span className="text-11 font-medium">会后复盘 · 临时挂载</span>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5">
                <span className="text-10">旅程图生成 v2 <Badge tone="warning" className="ml-1">临时加载</Badge></span>
                <Button size="xs" variant="outline" data-testid="skill-chat-promote-to-blueprint">提交回蓝本</Button>
              </div>
              <p className="text-9 text-muted-foreground">
                「提交回蓝本」的复盘流程归属与审批人待确认；组长能否自行加减是否需引导师逐场开关待确认。
              </p>
            </CardContent>
          </Card>
        </StateShell>
      </RoleGate>
    </div>
  );
}
