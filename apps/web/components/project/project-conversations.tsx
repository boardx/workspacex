"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "./parts";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import { listThreads, createProjectThread, type ListThreadsOut } from "@/lib/live-chat";
import { CHAT_VISIBILITY_LABEL } from "@/lib/chat-visibility";

/**
 * 项目内的对话（项目中枢 R4）——研究洞察 › 对话 子页。
 *
 * 读：`listThreads(projectId)`（服务端按 `resolveVisibility` 过滤：本人 / 本组 / 全场，
 *     非成员直接 403，这里如实显示）。分组（今天 / 本周 / 更早）由服务端给，不在前端重排。
 * 写：「新建对话」→ `createProjectThread(projectId)`（`projectId` 非空 ⇒ 线程属于本项目，
 *     可见范围取服务端默认），成功后**直接进入**该线程（`/chat/<id>?projectId=`）。
 * 每张卡片链到 `/chat/<id>?projectId=<projectId>`——chat 壳层用 `?projectId` 把线程列表限定到本项目。
 */
export function ProjectConversations({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const router = useRouter();
  const [data, setData] = React.useState<ListThreadsOut | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (!getStoredSessionToken()) { setData(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    listThreads(projectId)
      .then((out) => { if (!cancelled) setData(out); })
      .catch((e: unknown) => { if (!cancelled) setError(describeFailure(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const threadHref = (id: string) => `/chat/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`;

  async function create() {
    setCreating(true); setError(null);
    try {
      const out = await createProjectThread(projectId, null);
      router.push(threadHref(out.threadId));
    } catch (e) {
      setError(describeFailure(e));
      setCreating(false);
    }
  }

  const cards = data?.groups.flatMap((g) => g.cards.map((c) => ({ group: g.label, ...c }))) ?? [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6" data-testid="project-conversations">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle meta="本项目里的对话：成员按可见范围各看各的" className="mb-0">对话</SectionTitle>
        <span className="flex-1" />
        {canWrite && (
          <Button size="sm" variant="primary" disabled={creating} onClick={() => void create()} data-testid="project-conversations-new">
            <Plus aria-hidden className="h-3.5 w-3.5" />在本项目中新建对话
          </Button>
        )}
      </div>

      {error !== null ? (
        <Card><p className="p-4 text-11 text-destructive" data-testid="project-conversations-error">{error}</p></Card>
      ) : loading && data === null ? (
        <Card><p className="p-4 text-11 text-muted-foreground" data-testid="project-conversations-loading">读取对话中…</p></Card>
      ) : data === null ? (
        <Card><p className="p-4 text-11 text-muted-foreground" data-testid="project-conversations-anonymous">请先登录。</p></Card>
      ) : cards.length === 0 ? (
        <Card>
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-conversations-empty">
            本项目还没有你能看到的对话。{canWrite ? "点「在本项目中新建对话」开始。" : ""}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3" data-testid="project-conversations-list">
          {data.groups.filter((g) => g.cards.length > 0).map((g) => (
            <section key={g.label}>
              <h3 className="mb-1.5 px-1 text-10 font-medium uppercase tracking-wide text-muted-foreground">{g.label}</h3>
              <ul className="flex flex-col gap-1.5">
                {g.cards.map((c) => (
                  <li key={c.id}>
                    <a
                      href={threadHref(c.id)}
                      data-testid={`project-conversation-${c.id}`}
                      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 transition-colors hover:border-primary"
                    >
                      <MessagesSquare aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-12 font-medium">{c.title}</div>
                        {c.subtitle && <div className="truncate text-10 text-muted-foreground">{c.subtitle}</div>}
                      </div>
                      <Badge tone="outline">{CHAT_VISIBILITY_LABEL[c.visibilityScope] ?? c.visibilityScope}</Badge>
                      {c.artifactCount > 0 && <Badge tone="neutral">产物 {c.artifactCount}</Badge>}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function describeFailure(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.reasonCode) {
      case "NO_PROJECT_ROLE": return "你不在这个项目里，看不到项目内的对话。";
      case "PROJECT_ARCHIVED": return "项目已归档，不能再新建对话。";
      case "AUTH_SERVICE_UNAVAILABLE": return "身份校验服务暂时不可用，请稍后重试。";
    }
    if (e.status === 401) return "登录已失效，请重新登录。";
    return httpFailureText(e.status);
  }
  return e instanceof Error ? e.message : "操作失败，请稍后重试。";
}
