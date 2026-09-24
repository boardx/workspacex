import * as React from "react";
import { Building2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isScopeOpen } from "@/lib/brain-view";

const LAYERS = [
  {
    scope: "project" as const,
    label: "项目记忆",
    icon: Users,
    what: "一个项目里大家共同确认过的决定和事实，项目成员都能用上。",
  },
  {
    scope: "org" as const,
    label: "组织记忆",
    icon: Building2,
    what: "整个组织沉淀下来、带有效期的经验和规则，全员可见。",
  },
];

/**
 * 项目与组织两层：本阶段没有开放（契约 `KG_SCOPES_ENABLED_PHASE_18` 只有对话与个人两级），
 * 所以如实写「尚未开放」，不摆示例数字、不演示台账。开放以后由真实数据接进来。
 */
export function SharedLayers() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="brain-shared">
      {LAYERS.map((l) => {
        const open = isScopeOpen(l.scope);
        return (
          <div key={l.scope} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" data-testid={`brain-layer-${l.scope}`}>
            <div className="flex items-center gap-2">
              <l.icon aria-hidden className="h-4 w-4 text-muted-foreground" />
              <span className="text-13 font-medium">{l.label}</span>
              <Badge tone="outline" className="ml-auto" data-testid={`brain-layer-${l.scope}-status`}>
                {open ? "已开放" : "尚未开放"}
              </Badge>
            </div>
            <p className="text-12 text-muted-foreground">{l.what}</p>
            {!open ? (
              <p className="text-11 text-muted-foreground">
                现在还不能用。开放以后，你可以把长期记忆里的内容分享到这里。
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
