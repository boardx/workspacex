"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/session/session-provider";
import { resolveAidtStepChat, AidtStepChatChoiceError, type AidtStepChat } from "@/features/aidt/lib/live-aidt-step-chat";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";
import { CopilotKitV2Providers } from "@/app/chat/copilotkit-v2/copilotkit-v2-providers";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { aidtHref, AIDT_TEACHING_RULES, type AidtStep } from "@/features/aidt/lib/project-aidt";
import { AidtChatEmptyState } from "@/features/aidt/components/aidt-chat-empty-state";
import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";
function TeachingContext({ step, projectId }: { step: AidtStep; projectId: string }) {
  const value = React.useMemo(() => ({ projectId, step: step.id, skillStableName: step.skill, skillInstruction: "使用本步骤已挂载的教学 Skill 引导对话。切勿把指导文字当作研究证据。", guidance: step.prompt, rules: AIDT_TEACHING_RULES }), [step, projectId]);
  useAgentContext({ description: "AIDT 教学工作区：步骤指导，非用户研究证据或已确认决定", value });
  return null;
}
type AidtChatProps = { projectId: string; step: AidtStep; thread: string | null };
export function ProjectAidtChat(props: AidtChatProps) {
  if (!isAidtModuleEnabled()) return <p role="status" data-testid="aidt-chat-disabled" className="p-4 text-13 text-muted-foreground">教学模块未启用。</p>;
  return <EnabledAidtChat {...props} />;
}
function EnabledAidtChat({ projectId, step, thread }: AidtChatProps) {
  const { session } = useSession();
  const scope = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, projectId, step.id, thread]);
  const [state, setState] = React.useState<{ scope: string; value?: AidtStepChat; error?: string; choices?: readonly { id: string; title: string }[] } | null>(null);
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    if (!session?.currentOrgId || !session.sessionToken) return;
    let active = true;
    const cancellation = new AbortController();
    setState(null);
    void resolveAidtStepChat({ orgId: session.currentOrgId, userId: session.userId, sessionToken: session.sessionToken, projectId, step, thread, signal: cancellation.signal }).then((value) => {
      if (!active) return;
      const query = new URLSearchParams(window.location.search);
      window.history.replaceState(null, "", aidtHref(projectId, step.id, { thread: value.threadId, tool: query.get("tool") ?? undefined, resource: query.get("resource") ?? undefined }));
      setState({ scope, value });
    }).catch((error: unknown) => { if (active) setState({ scope, error: error instanceof Error ? error.message : "步骤对话读取失败，请重试。", choices: error instanceof AidtStepChatChoiceError ? error.choices : undefined }); });
    return () => { active = false; cancellation.abort(); };
  }, [scope, session, projectId, step, thread, retry]);
  const path = React.useCallback((id: string | null) => aidtHref(projectId, step.id, { thread: id }), [projectId, step.id]);
  const fromLocation = React.useCallback(() => new URLSearchParams(window.location.search).get("thread"), []);
  const current = state?.scope === scope ? state : null;
  if (!current) return <p role="status" className="p-4">正在准备本步对话与 Skill…</p>;
  if (current.error || !current.value) return <div role="alert" className="p-4" data-testid="aidt-chat-error"><p>{current.error}</p>{current.choices && <ul className="my-3 space-y-2">{current.choices.map((choice) => <li key={choice.id}><a className="text-primary underline" href={aidtHref(projectId, step.id, { thread: choice.id })}>{choice.title} · 继续这条对话</a></li>)}</ul>}<Button variant="outline" onClick={() => setRetry((n) => n + 1)}>重试</Button><a className="ml-3 text-primary" href={aidtHref(projectId, step.id)}>返回本步对话</a></div>;
  return <CopilotKitV2AgentSelectionProvider><CopilotKitV2Providers>
    <div className="flex h-full min-h-0 flex-col"><p className="border-b border-border px-4 py-2 text-12 text-muted-foreground" data-testid="aidt-step-skill">本组共享对话 · 教学 Skill：{current.value.skillName}</p>
    <TeachingContext projectId={projectId} step={step} />
    <CopilotKitV2Shell key={current.value.threadId} initialThreadId={current.value.threadId} projectId={projectId} singleConversation threadPath={path} threadFromLocation={fromLocation} projectReturnHref={aidtHref(projectId)} emptyState={() => <AidtChatEmptyState />} />
    </div>
  </CopilotKitV2Providers></CopilotKitV2AgentSelectionProvider>;
}
