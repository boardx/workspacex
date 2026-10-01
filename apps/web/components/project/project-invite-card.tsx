"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SectionTitle } from "./parts";
import { ProjectInviteEmailForm } from "./project-invite-email-form";
import { ProjectInviteLinkSection } from "./project-invite-link-section";
import { ProjectInvitePendingList } from "./project-invite-pending-list";
import { listInvitations, describeInvitationFailure, type InvitationListItem } from "@/lib/live-project-invitations";

/**
 * 「邀请成员」卡（#4788，通用项目；只有负责人能看到）：三种方式并列成标签——
 *   按名字（组织里已有的人，`children` 传入：协作者面板原有的指派条）/ 按邮箱 / 按链接，
 * 下面跟一张「待处理邀请」列表。列表由本组件统一拉取，邮箱表单 / 链接区写成功后重新拉一次。
 */
export function ProjectInviteCard({ projectId, nameTab }: { projectId: string; nameTab: React.ReactNode }) {
  const [items, setItems] = React.useState<InvitationListItem[] | undefined>(undefined);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const out = await listInvitations(projectId);
      setItems(out.invitations);
      setLoadError(null);
    } catch (e) {
      setLoadError(describeInvitationFailure(e));
    }
  }, [projectId]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const liveLink = (items ?? []).find((i) => i.kind === "link" && i.status === "pending") ?? null;
  const onChanged = React.useCallback(() => { void refresh(); }, [refresh]);
  const hidden = "data-[state=inactive]:hidden";

  return (
    <div className="flex flex-col gap-5" data-testid="project-invite-card">
      <section>
        <SectionTitle meta="按名字加组织里的人，或用邮箱 / 链接邀请组织外的人">邀请成员</SectionTitle>
        <Card className="p-3.5">
          <Tabs defaultValue="name">
            <TabsList className="max-w-full overflow-x-auto" data-testid="project-invite-methods">
              <TabsTrigger value="name" data-testid="project-invite-method-name">按名字</TabsTrigger>
              <TabsTrigger value="email" data-testid="project-invite-method-email">按邮箱</TabsTrigger>
              <TabsTrigger value="link" data-testid="project-invite-method-link">按链接</TabsTrigger>
            </TabsList>
            <TabsContent value="name" forceMount className={hidden}>{nameTab}</TabsContent>
            <TabsContent value="email" forceMount className={hidden}>
              <ProjectInviteEmailForm projectId={projectId} onChanged={onChanged} />
            </TabsContent>
            <TabsContent value="link" forceMount className={hidden}>
              <ProjectInviteLinkSection projectId={projectId} existing={liveLink} onChanged={onChanged} />
            </TabsContent>
          </Tabs>
        </Card>
      </section>
      <ProjectInvitePendingList projectId={projectId} items={items} loadError={loadError} onChanged={onChanged} onRetry={onChanged} />
    </div>
  );
}
