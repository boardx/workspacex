"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "./parts";
import { getStoredSessionToken } from "@/lib/api-client";
import { KG_TRI_STATE_LABEL_ZH, type KgClaimKind, type KgClaim } from "@repo/contracts/chat-knowledge-graph";
import { KG_CLAIM_KIND_LABEL_ZH } from "@/lib/knowledge-graph-view";
import { fetchProjectKnowledge, knowledgeGraphErrorCode, type ProjectKnowledge } from "@/lib/knowledge-graph-api";
import { httpFailureText } from "@/lib/http-failure-text";
import { ApiError } from "@/lib/api-client";

/**
 * 「项目大脑」面板（项目中枢 R8）——研究洞察 › 研究总览。
 *
 * 数据：`getProjectKnowledge(projectId)`（项目记忆 L2：由「记到项目大脑」晋升来的结论）。按类型分组
 * （事实 / 决定 / 待办 / 风险 / 猜测），每条带三态与支持 / 反对证据数。全部真实：项目里还没人记下
 * 东西 ⇒ 如实空态，并告诉用户怎么记（项目对话的知识面板）。
 * 非成员 ⇒ 服务端 403 `KG_NOT_VISIBLE`，如实显示。
 */
const KIND_ORDER: readonly KgClaimKind[] = ["decision", "fact", "hypothesis", "risk", "todo"];

export function ProjectBrainPanel({ projectId }: { projectId: string }) {
  const [data, setData] = React.useState<ProjectKnowledge | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!getStoredSessionToken()) { setData(null); return; }
    setLoading(true); setError(null);
    try {
      setData(await fetchProjectKnowledge(projectId));
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  React.useEffect(() => { void load(); }, [load]);

  const groups = KIND_ORDER
    .map((kind) => ({ kind, claims: (data?.claims ?? []).filter((c) => c.kind === kind) }))
    .filter((g) => g.claims.length > 0);

  return (
    <section data-testid="project-brain">
      <SectionTitle meta={data ? `${data.claims.length} 条 · ${data.objects.length} 个实体` : "项目记忆"}>项目大脑</SectionTitle>
      <Card>
        {error !== null ? (
          <div className="flex items-center gap-2 p-4">
            <p className="flex-1 text-11 text-destructive" data-testid="project-brain-error">{error}</p>
            <Button size="xs" variant="outline" onClick={() => void load()} data-testid="project-brain-retry">重试</Button>
          </div>
        ) : loading && data === null ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-brain-loading">读取项目记忆中…</p>
        ) : data === null ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-brain-anonymous">请先登录。</p>
        ) : groups.length === 0 ? (
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-brain-empty">
            这个项目还没有记下任何东西。在项目对话的知识面板里点「记到项目大脑」，记下的内容会出现在这里，项目里的对话也会自动想起它。
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border" data-testid="project-brain-groups">
            {groups.map((g) => (
              <div key={g.kind} className="flex flex-col gap-1.5 p-3.5" data-testid={`project-brain-group-${g.kind}`}>
                <div className="flex items-center gap-2">
                  <span className="text-12 font-medium">{KG_CLAIM_KIND_LABEL_ZH[g.kind]}</span>
                  <span className="font-mono text-10 text-muted-foreground">{g.claims.length}</span>
                </div>
                <ul className="flex flex-col gap-1">
                  {g.claims.map((c) => <ClaimRow key={c.id} claim={c} />)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

function ClaimRow({ claim }: { claim: KgClaim }) {
  const tone = claim.triState === "confirmed" ? "success" : claim.triState === "conflict" ? "danger" : "warning";
  return (
    <li className="flex items-start gap-2 text-11" data-testid={`project-brain-claim-${claim.id}`}>
      <span className="min-w-0 flex-1 leading-relaxed">{claim.statement}</span>
      <Badge tone={tone === "success" ? "primary" : "outline"}>{KG_TRI_STATE_LABEL_ZH[claim.triState]}</Badge>
      <span className="shrink-0 font-mono text-10 text-muted-foreground" title="支持 / 反对的证据数">
        +{claim.supportingCount} / −{claim.contradictingCount}
      </span>
    </li>
  );
}

function describeFailure(e: unknown): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === "KG_NOT_VISIBLE") return "你不在这个项目里，看不到它的项目记忆。";
  if (e instanceof ApiError) return httpFailureText(e.status);
  return e instanceof Error ? e.message : "读取失败，请稍后重试。";
}
