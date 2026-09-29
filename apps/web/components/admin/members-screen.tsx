"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { UsageMonitorTab } from "./usage-monitor-tab";
import { LimitPolicyTab } from "./limit-policy-tab";
import { MemberQuotaTab } from "./member-quota-tab";
import { MemberInvitesPanel } from "./member-invites-panel";
import { AdminBoundaryLive } from "./admin-boundary-live";
import type { UiState } from "@/lib/ui-state";

/** 三个并列 tab —— 原型（`WorkspaceX Standalone.html` 偏移 15851070/298/527）证实是
 * 同一屏三按钮，不是三个独立左栏菜单项，因此不新增 `AdminModuleKey`。 */
type MembersTabKey = "quota" | "usage" | "policy";

/*
 * lint-no-backend-badge:backed-by-children —— 这块屏的真实请求全在同目录子组件里：
 * `member-quota-tab`（配额三卡与成员行）、`usage-monitor-tab`（四窗口聚合 + 限额事件）、
 * `limit-rules-live`（限额规则 CRUD）、`admin-boundary-live`（个人层计数与访问留痕）、
 * `member-invites-panel`（F11 起：名册 + 待处理邀请，真栈）。屏文件自己只剩布局。
 *
 * ⚠ 这不是「把门关掉」：`lint-no-backend-badge.mjs` 读到这行标记后**会去验证**它——
 * 至少一个同目录子组件确实有后端调用才放行。子组件全变回 mock 的那天，这行标记救不了它。
 */
export function MembersScreen({ state }: { state: UiState }) {
  const [tab, setTab] = React.useState<MembersTabKey>("quota");

  return (
    <AdminScreen
      state={state}
      moduleLabel="成员配额"
      title="成员与配额"
      /* F160：整屏级的「尚未接入真实后端」摘掉——三个 tab 都已读真库。
         仍是 mock 的局部区块（限额策略里的「降级阈值三级 / 按任务分级」，属 phase-03 F14）
         自带提示，贴着那个区块渲染——按区块说实话，比在页头挂一条覆盖全屏的话诚实。

         ⚠ #1165：只摘 `noticeOverride` 是不够的——`AdminScreen` 会落进
         `noticeOverride ?? <SampleConfigNotice />` 的默认分支，把一条讲「模型型号与定价」
         的提示挂到配额屏上（人类 2026-08-14 截图实测）。`liveBacked` 是那个缺口的第三态：
         这块屏既不是「示例组织配置」也不是「零后端」，两条屏级提示都不适用。 */
      liveBacked
      intro="管理员不是超级用户。你能看到每个人的用量与个人层「条目数」，但看不到个人层的内容——这一层是三层记忆里唯一对管理员封闭的一层。团队/名册/邀请的完整管理在「组织成员」（下方链接，已接真实后端）；本屏只做配额与「管理员看不到什么」这两块，两者不是同一功能。"
      emptyHint="组织里还没有成员"
      errors={{ quota: "提额失败：目标额度超过组织剩余额度（1,380 万 tokens），请先调整组织总额度" }}
      depFailure="用量统计依赖计量流水线（UC-17.7）；流水线不可用，配额与个人层计数无法刷新。"
      denialReason="成员与配额仅组织管理员可见；顾问只能通过『看我的访问记录』查看自己的访问历史。"
      successMessage="已为吴桐单独提额至 5.0M；本次操作已记入审计"
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as MembersTabKey)} data-testid="admin-members-tabs">
        <TabsList>
          <TabsTrigger value="quota" data-testid="admin-members-tab-quota">成员配额</TabsTrigger>
          <TabsTrigger value="usage" data-testid="admin-members-tab-usage">用量监控</TabsTrigger>
          <TabsTrigger value="policy" data-testid="admin-members-tab-policy">限额策略</TabsTrigger>
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
        {/* 2026-08-11（菜单去重复查）：与「组织成员」（/org-admin/members，真实后端）
            的关系，同 canvas-template-screen.tsx / blueprint-screen.tsx 的「打开 X」链接
            是同一套模式——本屏只做配额与「管理员看不到什么」，成员/邀请的**完整**读写
            （批准、拒绝、撤销双人复核等）仍只在那一屏，不在这里重做一遍状态机
            （F11 起下面的 `MemberInvitesPanel` 已经是真栈，但只做摘要 + 重发）。
            ⚠ 链接此前误指向 `/org-admin/preview`（原型/mock 版本，2026-09-03 后已停用）——
            这是本轮顺手修的第二处 mock 痕迹。 */}
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
            <p className="text-12 text-muted-foreground">
              成员/邀请的批准、拒绝与撤销双人复核，组织资料，在「组织成员」管理（已接真实后端）。
              这里是配额与「管理员看不到什么」这两块——组织级邀请管理不重复做。
            </p>
            <Link
              href="/org-admin/members"
              data-testid="admin-members-open-org-admin"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-12 transition-colors duration-200 hover:bg-muted"
            >
              打开组织成员管理
              <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        {/* 成员配额列表 —— F160 起改为**真栈**（`MemberQuotaTab`）。
            这里原先是 `lib/mock/admin.MEMBERS` 的 usedM/limitM 两个写死的浮点数；
            根因不在前端，是全仓此前零 token 计量落库（见 F159 的迁移）。 */}
        <MemberQuotaTab />

        {/* F11：名册 + 待处理邀请，真栈（`listOrgMembers`/`listOrgInvites`/`resendOrgInvite`，
            与 `/org-admin/invites`、`/org-admin/members` 同一组真实端点）。 */}
        <MemberInvitesPanel />

        {/* 管理员权力边界（D-18 / UC-17.5）—— F163 起接**既有**真端点
            （GET /identity/personal-layer/summary + GET /admin-access-log/mine，
            两条都是 F06 已 passing 的，此前前端一直没接、读的是 mock）。 */}
        <AdminBoundaryLive />

      </div>
      </TabsContent>
      </Tabs>

      {/* F10 的 [邀请成员] 弹层已搬进 `MemberInvitesPanel`（真栈，F11）。
          ⚠ 这里此前还有两块死代码：「单独提额」弹层（`quotaOf`/`openQuota`，从未被任何
          东西调用——真实的提额入口已经是上面 `MemberQuotaTab` 每行的 [调整] 按钮，F160
          接线时把 `openQuota` 遗留在文件里没删）与「我的访问记录」抽屉（`accessOpen`，
          同样没有任何按钮把它设为 true——真实的边界信息已经是 `AdminBoundaryLive`，
          F163 接线时同样只加了新组件、没删旧抽屉）。两块渲染的都是 `lib/mock/admin.ts`
          的假数据，但从未被用户看到过；删掉而不是保留是因为「反正显示不出来」本身
          就是死代码的定义，留着只会让下一个人以为它还在被使用。 */}
    </AdminScreen>
  );
}
