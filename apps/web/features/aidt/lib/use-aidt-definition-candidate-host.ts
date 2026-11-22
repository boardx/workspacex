"use client";

import * as React from "react";
import { canvas } from "@repo/contracts";
import { isAidtCandidateRequest } from "@repo/contracts/aidt-candidate-request";
import { ChatHostTextActionContext } from "@/components/chat/chat-host-panel";
import { useOptionalSession } from "@/components/session/session-provider";
import { getThread } from "@/lib/live-chat";
import { apiRequest } from "@/lib/api-client";
import { readAllPersistedMessages } from "@/lib/copilotkit-v2-persisted-messages";
import { loadAidtAuthorizedDefinitionEvidence, aidtDefinitionCardTextIdentity, AIDT_DEFINITION_SYNTHETIC_NOTICE, sameAidtDefinitionSyntheticSources } from "./aidt-definition-current-evidence";
import { readAidtStage } from "./live-aidt-stages";
import { readAidtDefinition } from "./aidt-definition";
import type { AidtDefinitionTurn } from "./aidt-definition-chat";
import type { AidtPersonaCandidateHost, AidtPersonaGenerationRequest } from "./aidt-persona-candidates";

/** Sends through the native composer guard; returns only the current turn's persisted reply, never AG-UI temporary IDs. */
export function useAidtDefinitionCandidateHost({ projectId, revision, definitionRevision, canWrite, messages, loading, running }: {
  projectId?: string; revision?: number; definitionRevision?: number; canWrite: boolean; messages: readonly AidtDefinitionTurn[]; loading: boolean; running: boolean;
}): AidtPersonaCandidateHost {
  const action = React.useContext(ChatHostTextActionContext);
  const session = useOptionalSession()?.session;
  const scope = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, projectId, revision, definitionRevision, action?.threadId]);
  const current = React.useRef({ scope, action, canWrite, messages, loading, running });
  current.current = { scope, action, canWrite, messages, loading, running };
  const [tick, changed] = React.useReducer(value => value + 1, 0);
  type Pending = {
    scope: string; prompt: string; before: Set<string>; accepted: boolean; reading: boolean; request: AidtPersonaGenerationRequest;
    resolve: (value: Awaited<ReturnType<AidtPersonaCandidateHost["generate"]>>) => void; reject: (error: Error) => void;
  };
  const pending = React.useRef<Pending | null>(null);
  const checking = React.useRef(false);
  const assertEvidence = React.useCallback(async (request: AidtPersonaGenerationRequest) => {
    const token = session?.sessionToken;
    if (!token) throw new Error("当前访谈授权无法核对。");
    const evidence = await loadAidtAuthorizedDefinitionEvidence({ projectId: request.source.projectId, revision: request.source.revision,
      sessionToken: token, cardIds: request.source.cardIds });
    if (!request.cards || request.cards.length !== request.source.cardIds.length || request.source.cardIds.some(id => {
      const supplied = request.cards?.find(card => card.id === id), saved = evidence.cards.find(card => card.id === id);
      return !supplied || !saved || aidtDefinitionCardTextIdentity(supplied) !== aidtDefinitionCardTextIdentity(saved);
    })) throw new Error("候选材料与冻结版本不一致，未发送。");
    if (request.source.syntheticCardIds && !sameAidtDefinitionSyntheticSources(request.source.syntheticCardIds, evidence.syntheticCardIds)) throw new Error("访谈材料性质已变化，请重新生成候选。");
    if (request.kind === "hmw") {
      const { stage } = await readAidtStage(request.source.projectId, 3, token);
      if (!stage || stage.projectId !== request.source.projectId || stage.stageId !== 3 || stage.revision !== request.source.definitionRevision)
        throw new Error("来源画像不属于本轮精确保存版本，未发送。");
      const profiles = readAidtDefinition(stage.content.draft.fields).personas;
      if (!request.personaIds?.length || !profiles || request.personaIds.some(id => {
        const profile = profiles.find(item => item.id === id && item.confirmed && !item.archived);
        return !profile || !profile.cardIds.length || profile.cardIds.some(cardId => !request.source.cardIds.includes(cardId))
          || !request.prompt.split("\n").includes(JSON.stringify(profile));
      })) throw new Error("来源画像或其访谈授权已变化，未发送。");
    }
    return evidence;
  }, [session?.sessionToken]);
  React.useEffect(() => {
    return () => { pending.current?.reject(new Error("候选来源或对话已变化，请重新选择。")); pending.current = null; };
  }, [scope]);
  React.useEffect(() => {
    const work = pending.current;
    if (!work || !work.accepted || work.reading) return;
    if (work.scope !== scope || !canWrite || action?.failed) {
      pending.current = null; work.reject(new Error("本轮对话未完成，已有候选不会自动加入。")); return;
    }
    if (loading || running || action?.running) return;
    const humanIndex = messages.findIndex(message => message.role === "user" && message.content === work.prompt && !work.before.has(message.id));
    if (humanIndex < 0) return;
    const after = messages.slice(humanIndex + 1);
    if (after.some(message => message.role === "user")) { pending.current = null; work.reject(new Error("本轮之后已有新的讨论，请在对应对话中核对候选。")); return; }
    if (!after.some(message => message.role === "assistant" && typeof message.content === "string" && message.content.trim())) return;
    const token = session?.sessionToken; const threadId = action?.threadId;
    if (!token || !threadId || !projectId) return;
    work.reading = true;
    const assertCurrent = () => {
      if (pending.current !== work || current.current.scope !== work.scope || !current.current.canWrite || current.current.action?.failed) throw new Error("候选来源或权限已变化。");
    };
    void (async () => {
      assertCurrent();
      const detail = await getThread(threadId, projectId, token);
      assertCurrent();
      if (detail.thread.projectId !== projectId || detail.thread.visibilityScope !== "plenary" || detail.thread.archived || !detail.capabilities.includes("composer.send")) throw new Error("本组对话不再可用。");
      const persisted = await readAllPersistedMessages(threadId, token);
      assertCurrent();
      if (persisted.pendingRunId) throw new Error("教学回复尚未完成，请回到对话查看。");
      const humans = persisted.messages.filter(message => message.role === "user" && message.content === work.prompt);
      if (humans.length !== 1) throw new Error("无法定位本轮真实学生请求。");
      const runId = humans[0]!.agentRunId;
      if (!runId) throw new Error("本轮请求尚无可核对的教学运行。");
      const index = persisted.messages.findIndex(message => message.id === humans[0]!.id);
      const tail = persisted.messages.slice(index + 1);
      if (tail.some(message => message.role === "user")) throw new Error("本轮之后已有新的讨论。");
      const replies = tail.filter(message => message.role === "assistant" && message.agentRunId === runId && typeof message.content === "string" && message.content.trim());
      if (!replies.length) throw new Error("尚未读回本轮真实教学回复。");
      if (work.request.template) {
        const operation = canvas.operations.listTemplates;
        const result = operation.out.parse(await apiRequest<unknown>(operation.path, { method: operation.method, sessionToken: token,
          query: { orgId: work.request.source.orgId, filter: "published" } }));
        assertCurrent();
        const frozen = work.request.template;
        const same = result.templates.some(row => row.key === frozen.key && row.version === frozen.version && row.platform === frozen.platform
          && JSON.stringify([row.sections, row.title, row.footer, row.size, row.gridCols, row.gridRows]) === JSON.stringify([frozen.sections, frozen.title, frozen.footer, frozen.size, frozen.gridCols, frozen.gridRows]));
        if (!same) throw new Error("后台画像模板已变化，请基于当前版本重新核对。");
      }
      const verified = await assertEvidence(work.request);
      assertCurrent(); pending.current = null; work.resolve({ threadId, messages: replies, syntheticCardIds: verified.syntheticCardIds });
    })().catch(error => {
      if (pending.current === work) pending.current = null;
      work.reject(error instanceof Error ? error : new Error("本轮候选读回未完成。"));
    });
  }, [scope, action, canWrite, loading, running, messages, session?.sessionToken, projectId, tick, assertEvidence]);

  return React.useMemo(() => ({ generate: async (request: AidtPersonaGenerationRequest) => {
    const state = current.current;
    const actor = state.action;
    if (checking.current || pending.current || !state.canWrite || state.loading || state.running || !actor?.available || actor.running || actor.failed || actor.occupied
      || actor.projectId !== request.source.projectId || !actor.threadId || request.source.revision !== revision || request.source.definitionRevision !== definitionRevision
      || request.source.orgId !== session?.currentOrgId || request.source.projectId !== projectId || !isAidtCandidateRequest(request.prompt, request.kind)) throw new Error("请先回到本组可用的第3步对话，处理未发送内容后再生成。");
    checking.current = true;
    let verifiedSource: Awaited<ReturnType<typeof loadAidtAuthorizedDefinitionEvidence>>;
    try {
      verifiedSource = await assertEvidence(request);
      if (current.current.scope !== state.scope || !current.current.canWrite || current.current.action !== actor || actor.running || actor.failed || actor.occupied)
        throw new Error("来源、权限或对话已变化，未发送。");
    } finally { checking.current = false; }
    const prepared = { ...request, source: { ...request.source, syntheticCardIds: verifiedSource.syntheticCardIds } };
    const [first, ...rest] = request.prompt.split("\n");
    const prompt = [first, `本次候选请求：${crypto.randomUUID()}`, `本次候选来源坐标：${JSON.stringify(prepared.source)}`,
      ...(verifiedSource.syntheticCardIds.length ? [AIDT_DEFINITION_SYNTHETIC_NOTICE, `合成材料引用：${verifiedSource.syntheticCardIds.join("、")}。以下原文保留原貌，不得将其改称真人引文、行为或有效性证明。`] : []), ...rest].join("\n");
    return await new Promise<Awaited<ReturnType<AidtPersonaCandidateHost["generate"]>>>((resolve, reject) => {
      const work: Pending = { scope: state.scope, prompt, before: new Set(state.messages.map(message => message.id)), accepted: false, reading: false, request: prepared, resolve, reject };
      pending.current = work;
      void actor.sendText(prompt).then(accepted => {
        if (pending.current !== work || current.current.scope !== work.scope) return;
        if (!accepted) { pending.current = null; reject(new Error("当前对话未受理候选请求。")); return; }
        work.accepted = true; changed();
      }).catch(error => { if (pending.current === work) pending.current = null; reject(error instanceof Error ? error : new Error("发送未完成。")); });
    });
  } }), [projectId, revision, definitionRevision, session?.currentOrgId, assertEvidence]);
}
