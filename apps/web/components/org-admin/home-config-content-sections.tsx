"use client";
import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { QUICK_ACTION_CATALOG, QUICK_ACTION_ORDER } from "@/lib/home-config-catalog";
import type { HomeConfigFormState } from "./home-config-form-model";

type Props = { form: HomeConfigFormState; onChange: (next: HomeConfigFormState) => void };
const SECTION = "flex flex-col gap-3 rounded-lg border border-border bg-panel p-4";

/** 快捷入口：十个真实模块入口的开关，顺序固定为目录声明顺序。 */
export function QuickActionsSection({ form, onChange }: Props) {
  return (
    <section className={SECTION} data-testid="home-config-quick-actions">
      <h2 className="text-13 font-semibold text-card-foreground">快捷入口（默认模块）</h2>
      <p className="text-11 text-muted-foreground">勾选要在首页露出的模块。关闭只是不在首页展示，不影响左侧导航里的入口。</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {QUICK_ACTION_ORDER.map((key) => (
          <Checkbox
            key={key}
            label={QUICK_ACTION_CATALOG[key].label}
            description={QUICK_ACTION_CATALOG[key].desc}
            checked={form.quickActionEnabled[key]}
            onChange={(e) => onChange({ ...form, quickActionEnabled: { ...form.quickActionEnabled, [key]: e.target.checked } })}
            data-testid={`home-config-quick-action-${key}`}
          />
        ))}
      </div>
    </section>
  );
}

/** 整块内容开关。「提交反馈」不在此列：每个首页都有，不可关。 */
export function SectionsSection({ form, onChange }: Props) {
  return (
    <section className={SECTION} data-testid="home-config-sections">
      <h2 className="text-13 font-semibold text-card-foreground">首页板块</h2>
      <Checkbox
        label="当前任务"
        description="显示「我的任务」与进行中的项目"
        checked={form.sections.currentTasks}
        onChange={(e) => onChange({ ...form, sections: { ...form.sections, currentTasks: e.target.checked } })}
        data-testid="home-config-section-tasks"
      />
      <Checkbox
        label="继续你的工作"
        description="每个人自己的最近对话、项目（含协作者）、深度研究、用户访谈、问卷卡片"
        checked={form.sections.recentWork}
        onChange={(e) => onChange({ ...form, sections: { ...form.sections, recentWork: e.target.checked } })}
        data-testid="home-config-section-recent"
      />
      <p className="text-11 text-muted-foreground">「提交反馈」入口每个首页都有，不受这里控制。</p>
    </section>
  );
}
