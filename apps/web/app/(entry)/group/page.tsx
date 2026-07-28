import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { EntryPreviewSwitcher } from "@/components/entry/preview-switcher";
import { GroupWorkbench } from "@/components/entry/group-workbench";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { JOIN_CONTEXT, GROUP_WORKBENCH, GROUP_VIEW_ROLES, resolveGroupRole } from "@/lib/mock/entry";

/**
 * 小组工作台（档案第九节 C）——落进本组后只看得到本组的东西。
 * 免注册参与者上下文，不套 AppShell；组员/组长两视角经 `?as=` 预览切换。
 */
export default function GroupPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const role = resolveGroupRole(searchParams.as);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-3 p-4">
      <div className="flex flex-col gap-1.5">
        <StatePreviewSwitcher current={state} />
        <div className="flex flex-wrap gap-1.5">
          <EntryPreviewSwitcher
            label="视角"
            param="as"
            options={GROUP_VIEW_ROLES}
            current={role}
            testid="group-role-switcher"
          />
        </div>
        <p className="text-10 text-muted-foreground">
          当前状态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        {/* 组头：你在第 2 组 · 组长 · 人数 */}
        <header className="flex flex-wrap items-center justify-between gap-2" data-testid="group-header">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-18 font-semibold tracking-tight">
                第 {JOIN_CONTEXT.groupNo} 组 · {JOIN_CONTEXT.groupName}
              </h1>
              <Badge tone={role === "groupLead" ? "primary" : "neutral"}>
                {role === "groupLead" ? "组长视角" : "组员视角"}
              </Badge>
            </div>
            <p className="text-12 text-muted-foreground">
              组长 {JOIN_CONTEXT.groupLead} · {GROUP_WORKBENCH.members.length} 人
            </p>
          </div>
          <div className="flex -space-x-1.5" aria-hidden>
            {GROUP_WORKBENCH.members.map((m) => (
              <Avatar
                key={m.initials}
                initials={m.initials}
                size="sm"
                tone={m.role === "组长" ? "human" : "muted"}
                className="ring-1 ring-card"
              />
            ))}
          </div>
        </header>

        <GroupWorkbench state={state} role={role} />
      </div>
    </div>
  );
}
