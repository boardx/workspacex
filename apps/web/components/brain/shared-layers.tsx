import * as React from "react";
import { Building2, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { fetchOrgKnowledge, knowledgeGraphErrorCode, type OrgKnowledge } from "@/lib/knowledge-graph-api";
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
 * 项目与组织两层的开放状态只看契约 `KG_SCOPES_ENABLED_PHASE_18`（项目中枢 R7 放开项目，B2-S4 #4428 放开组织）。
 * 没开放的如实写「尚未开放」，不摆示例数字、不演示台账；开放的只说怎么用，真实内容各自在项目大脑 / 组织大脑接口里。
 */
export function SharedLayers() {
  const [org, setOrg] = React.useState<OrgKnowledge | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "ready" | "failed" | "denied">("idle");
  async function openOrg() {
    setStatus("loading");
    try { setOrg(await fetchOrgKnowledge()); setStatus("ready"); }
    catch (e) { setStatus(knowledgeGraphErrorCode(e) === "KG_NOT_VISIBLE" ? "denied" : "failed"); }
  }
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
            {open && l.scope === "project" ? <Link href="/projects" className="text-12 text-primary underline">查看项目记忆</Link> : null}
            {open && l.scope === "org" ? (
              <>
                <Button size="sm" variant="outline" disabled={status === "loading"} onClick={() => void openOrg()}>查看组织记忆</Button>
                {status === "loading" ? <p role="status" className="text-12">正在读取组织记忆…</p> : null}
                {status === "failed" ? <p role="alert" className="text-12">暂时读不到组织记忆，请点击上方按钮重试。</p> : null}
                {status === "denied" ? <p role="alert" className="text-12">你没有权限查看当前组织的记忆。</p> : null}
                {status === "ready" && org ? (
                  <div data-testid="brain-org-content" className="flex flex-col gap-2 text-12">
                    {org.claims.length === 0 ? <p>当前组织还没有记忆。可由负责人或管理员从项目大脑记到组织记忆。</p> : null}
                    {org.claims.map((c) => <p key={c.id}>{c.statement}</p>)}
                  </div>
                ) : null}
              </>
            ) : null}
            {!open ? (
              <p className="text-11 text-muted-foreground">
                现在还不能用。开放以后，你可以把长期记忆里的内容分享到这里。
              </p>
            ) : l.scope === "project" ? (
              <p className="text-11 text-muted-foreground" data-testid="brain-layer-project-hint">
                在项目对话的知识面板里点「记到项目大脑」，记下的内容就进入该项目的记忆；项目里的对话会自动想起它。
              </p>
            ) : (
              <p className="text-11 text-muted-foreground" data-testid="brain-layer-org-hint">
                组织负责人或管理员在项目大脑里点「记到组织记忆」，那一条就进入整个组织的记忆，组织里的每个成员都看得到。
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
