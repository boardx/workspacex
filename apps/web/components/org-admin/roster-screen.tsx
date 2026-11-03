"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { Copy, QrCode, ExternalLink, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toast } from "@/components/admin/panel";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { OrgAdminFrame } from "./org-admin-frame";
import {
  ROSTER, ROSTER_PRESENT, ROSTER_TOTAL,
  type AttendState,
} from "@/lib/mock/org-admin";

/**
 * UC-1.3 载体二 · 现场协作 → 全场 → 分组与签到（现场面）
 *
 * 与载体一**共用同一份数据**（同一批链接、同一份名单），任务侧重不同：这里是开场与到场核对。
 * 逐项照录 R8：每组链接 + [复制] + [二维码] + 签到名单 + 到场状态（组长/已到/未到）+
 * 每组 n/m + 全场计数（11/12 已到）+ [看加入页]。观察者只见脱敏聚合（R5）。
 */
export function RosterScreen({ state, previewRole }: { state: UiState; previewRole: ProjectRole }) {
  const { t } = useI18n();
  const [toast, setToast] = React.useState<((t: ReturnType<typeof useI18n>["t"]) => string) | null>(null);

  // 观察者：到场信息至多脱敏聚合，链接/二维码不可见（R5）
  const observer = previewRole === "observer";

  return (
    <OrgAdminFrame
      state={state}
      uc={t("orgMembersPreview.roster.uc")}
      title={t("orgMembersPreview.roster.title")}
      intro={t("orgMembersPreview.roster.intro", { present: ROSTER_PRESENT, total: ROSTER_TOTAL })}
      emptyHint={t("orgMembersPreview.roster.empty")}
      errors={{ roster: t("orgMembersPreview.roster.error") }}
      depFailure={t("orgMembersPreview.roster.dependency")}
      denial={observer
        ? { layer: "project", reason: t("orgMembersPreview.roster.observerDenial") }
        : { layer: "project", reason: t("orgMembersPreview.roster.denial") }}
      successMessage={t("orgMembersPreview.roster.success")}
      skeletonRows={4}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2">
          <Users aria-hidden className="h-4 w-4 text-muted-foreground" />
          <span className="text-13 font-medium">{t("orgMembersPreview.roster.count", { present: ROSTER_PRESENT, total: ROSTER_TOTAL })}</span>
          <span className="text-11 text-muted-foreground">{t("orgMembersPreview.roster.joinHint")}</span>
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => setToast(() => (t: ReturnType<typeof useI18n>["t"]) => t("orgMembersPreview.roster.previewToast"))} data-testid="roster-see-join-page"><ExternalLink aria-hidden className="h-3 w-3" /> {t("orgMembersPreview.roster.preview")}</Button>
        </div>

        {observer && (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-11 text-muted-foreground" data-testid="roster-observer-note">
            {t("orgMembersPreview.roster.observer")}
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {ROSTER.map((g) => (
            <li key={g.groupNo} className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="roster-group-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-11 text-accent-foreground">{g.groupNo}</span>
                <span className="text-13 font-medium">{g.title}</span>
                <Badge tone={g.present === g.total ? "primary" : "warning"} data-testid="roster-count">{g.present}/{g.total}</Badge>
                {!observer && (
                  <div className="ml-auto flex gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => setToast(() => (t: ReturnType<typeof useI18n>["t"]) => t("orgMembersPreview.roster.copied", { group: g.groupNo }))} data-testid="roster-copy"><Copy aria-hidden className="h-3 w-3" /> {t("orgMembersPreview.roster.copy")}</Button>
                    <Button size="xs" variant="outline" onClick={() => setToast(() => (t: ReturnType<typeof useI18n>["t"]) => t("orgMembersPreview.roster.qrToast"))} data-testid="roster-qr"><QrCode aria-hidden className="h-3 w-3" /> {t("orgMembersPreview.roster.qr")}</Button>
                  </div>
                )}
              </div>
              {!observer && (
                <div className="flex flex-wrap items-center gap-1.5 pl-7" data-testid="roster-signin-list">
                  {g.members.map((m) => (
                    <span key={m.name} className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-11">
                      {m.name}
                      <AttendTag state={m.state} />
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Toast message={toast?.(t) ?? null} testid="roster-toast" onDismiss={() => setToast(null)} />
    </OrgAdminFrame>
  );
}

function AttendTag({ state }: { state: AttendState }) {
  const { t } = useI18n();
  const tone = state === "lead" ? "ai" : state === "present" ? "primary" : "outline";
  return <Badge tone={tone} data-testid={`roster-attend-${state}`}>{t(`orgMembersPreview.attend.${state}`)}</Badge>;
}
