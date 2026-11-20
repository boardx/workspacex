"use client";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { OrganizationPageHeader } from "@/components/org-admin/organization-content";
import { AdminScreen } from "./admin-screen";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { UsageMonitorTab } from "./usage-monitor-tab";
import { LimitPolicyTab } from "./limit-policy-tab";
import { MemberQuotaTab } from "./member-quota-tab";
import type { UiState } from "@/lib/ui-state";

/** 三个并列 tab —— 原型（`WorkspaceX Standalone.html` 偏移 15851070/298/527）证实是
 * 同一屏三按钮，不是三个独立左栏菜单项，因此不新增 `AdminModuleKey`。 */
type MembersTabKey = "quota" | "usage" | "policy";

/* lint-no-backend-badge:backed-by-children — quota, usage and policy tabs read live data. */
export function MembersScreen({ state }: { state: UiState }) {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<MembersTabKey>("quota");

  return (
    <AdminScreen
      contentHeader={<OrganizationPageHeader title={t("adminMemberQuotas.quota")} description={t("orgControlsRedesign.quotaIntro")} />}
      state={state}
      moduleLabel={t("adminMemberQuotas.quota")}
      title={t("adminMemberQuotas.membersTitle")}
      /* F160：整屏级的「尚未接入真实后端」摘掉——三个 tab 都已读真库。
         仍是 mock 的局部区块（限额策略里的「降级阈值三级 / 按任务分级」，属 phase-03 F14）
         自带提示，贴着那个区块渲染——按区块说实话，比在页头挂一条覆盖全屏的话诚实。

         ⚠ #1165：只摘 `noticeOverride` 是不够的——`AdminScreen` 会落进
         `noticeOverride ?? <SampleConfigNotice />` 的默认分支，把一条讲「模型型号与定价」
         的提示挂到配额屏上（人类 2026-08-14 截图实测）。`liveBacked` 是那个缺口的第三态：
         这块屏既不是「示例组织配置」也不是「零后端」，两条屏级提示都不适用。 */
      liveBacked
      intro={t("adminMemberQuotas.shellintro")}
      emptyHint={t("adminMemberQuotas.emptyHint")}
      errors={{ quota: t("adminMemberQuotas.shellQuotaError") }}
      depFailure={t("adminMemberQuotas.shelldepFailure")}
      denialReason={t("adminMemberQuotas.shelldenialReason")}
      successMessage={t("adminMemberQuotas.shellsuccessMessage")}
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as MembersTabKey)} data-testid="admin-members-tabs">
        <TabsList>
          <TabsTrigger value="quota" data-testid="admin-members-tab-quota">{t("adminMemberQuotas.quota")}</TabsTrigger>
          <TabsTrigger value="usage" data-testid="admin-members-tab-usage">{t("adminMemberQuotas.usage")}</TabsTrigger>
          <TabsTrigger value="policy" data-testid="admin-members-tab-policy">{t("adminMemberQuotas.policy")}</TabsTrigger>
        </TabsList>

        {/* F161 起「用量监控」读真库，整块的 NoBackendNotice 摘掉；
            该 tab 内部仍是 mock 的那一小块（近期限额事件）自己带着提示，见其组件。 */}
        <TabsContent value="usage" data-testid="admin-members-tabpanel-usage">
          <div className="flex flex-col gap-3 pt-3">
            <UsageMonitorTab />
          </div>
        </TabsContent>

        {/* ⚠ #1165 顺带修掉的第二处：这里原本在 tabpanel 级也挂了一条 NoBackendNotice
            （F161 按 tab 分区时留下的）。F162 之后限额规则区已读真库，那条「panel 级」的
            提示等于在说「整个 tab 都是假的」——不实。真正仍是 mock 的只有 tab 内部的
            「降级阈值三级 / 按任务分级」两块（属 phase-03 F14），它们的提示由
            `LimitPolicyTab` 贴着那个区块渲染。两条同时在，红横幅还会出现两次。 */}
        <TabsContent value="policy" data-testid="admin-members-tabpanel-policy">
          <div className="flex flex-col gap-3 pt-3">
            <LimitPolicyTab />
          </div>
        </TabsContent>

      <TabsContent value="quota" data-testid="admin-members-tabpanel-quota">
      <div className="flex flex-col gap-5">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
            <p className="text-12 text-muted-foreground">
              {t("adminMemberQuotas.orgManagement")}
            </p>
            <Link
              href="/org-admin/members"
              data-testid="admin-members-open-org-admin"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-12 transition-colors duration-200 hover:bg-muted"
            >
              {t("adminMemberQuotas.openOrg")}
              <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        {/* 成员配额列表 —— F160 起改为**真栈**（`MemberQuotaTab`）。
            这里原先是 `lib/mock/admin.MEMBERS` 的 usedM/limitM 两个写死的浮点数；
            根因不在前端，是全仓此前零 token 计量落库（见 F159 的迁移）。 */}
        <MemberQuotaTab />

      </div>
      </TabsContent>
      </Tabs>
    </AdminScreen>
  );
}
