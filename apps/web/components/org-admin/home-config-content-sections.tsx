"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { Checkbox } from "@/components/ui/checkbox";
import { QUICK_ACTION_ORDER } from "@/lib/home-config-catalog";
import type { HomeConfigFormState } from "./home-config-form-model";

type Props = { form: HomeConfigFormState; onChange: (next: HomeConfigFormState) => void };
const SECTION = "flex flex-col gap-3 rounded-lg border border-border bg-panel p-4";

/** 快捷入口：十个真实模块入口的开关，顺序固定为目录声明顺序。 */
export function QuickActionsSection({ form, onChange }: Props) {
  const { t } = useI18n();
  return (
    <section className={SECTION} data-testid="home-config-quick-actions">
      <h2 className="text-13 font-semibold text-card-foreground">{t("homeConfig.quickActions")}</h2>
      <p className="text-11 text-muted-foreground">{t("homeConfig.quickActionsHelp")}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {QUICK_ACTION_ORDER.map((key) => (
          <Checkbox
            key={key}
            label={t(`action.${key}.label`)}
            description={t(`action.${key}.description`)}
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
  const { t } = useI18n();
  return (
    <section className={SECTION} data-testid="home-config-sections">
      <h2 className="text-13 font-semibold text-card-foreground">{t("homeConfig.sections")}</h2>
      <Checkbox
        label={t("homeConfig.currentTasks")}
        description={t("homeConfig.currentTasksHelp")}
        checked={form.sections.currentTasks}
        onChange={(e) => onChange({ ...form, sections: { ...form.sections, currentTasks: e.target.checked } })}
        data-testid="home-config-section-tasks"
      />
      <Checkbox
        label={t("homeConfig.recentWork")}
        description={t("homeConfig.recentWorkHelp")}
        checked={form.sections.recentWork}
        onChange={(e) => onChange({ ...form, sections: { ...form.sections, recentWork: e.target.checked } })}
        data-testid="home-config-section-recent"
      />
      <p className="text-11 text-muted-foreground">{t("homeConfig.feedbackHelp")}</p>
    </section>
  );
}
