"use client";

import * as React from "react";
import { readAidtCandidateReply } from "./read-aidt-candidate-reply";
import { ChatHostTextActionContext } from "@/components/chat/chat-host-panel";
import { useOptionalSession } from "@/components/session/session-provider";
import { AIDT_CANDIDATE_ACTIONS, type AidtCandidateRequestKind } from "@repo/contracts/aidt-candidate-request";

export type AidtCandidateTurn = { id: string; role: string; content?: unknown };
export type AidtCandidateProvenance = { kind: AidtCandidateRequestKind; projectId: string; entityId: string; threadId: string; requestId: string; messageId: string; sourceKey: string };
export type AidtCandidateAdopter<T> = (candidate: T, provenance: AidtCandidateProvenance) => void | Promise<void>;
export type AidtCandidateBatchAdopter<T> = (candidates: readonly T[], provenance: AidtCandidateProvenance) => void | Promise<void>;
export type AidtCandidateController<T> = {
  candidates: readonly T[]; selectedIndex: number | null; choose: (index: number) => void;
  pending: boolean; busy: boolean; status: string; active: boolean; canStart: boolean;
  start: () => Promise<void>; cancel: () => void; adopt: (onAdopt: AidtCandidateAdopter<T>) => Promise<boolean>;
};
type Request<T> = { id: string; scope: string; sourceKey: string; prompt: string; threadId: string; prior: ReadonlySet<string>; settled: boolean; parse: (text: string) => readonly T[] };
type Preview<T> = { request: Request<T>; messageId: string; replyText: string; candidates: readonly T[] };

/** Only this native human request's settled reply supplies previews. Adoption is a separate local edit. */
export function useAidtCandidateRequest<T>(options: {
  kind: AidtCandidateRequestKind; projectId: string; entityId: string; sourceKey: string | null;
  messages: readonly AidtCandidateTurn[]; loading: boolean; running: boolean; enabled: boolean;
  disabledReason?: string; instruction: string; parseReply: (text: string) => readonly T[];
  readCurrentSource: (signal: AbortSignal) => Promise<string | null>;
}): AidtCandidateController<T> & { adoptMany: (indexes: readonly number[], onAdopt: AidtCandidateBatchAdopter<T>) => Promise<boolean> } {
  const action = React.useContext(ChatHostTextActionContext);
  const session = useOptionalSession()?.session;
  const scope = JSON.stringify([session?.currentOrgId, session?.userId, options.kind, options.projectId, options.entityId, action?.threadId]);
  const current = React.useRef({ options, scope, action }); current.current = { options, scope, action };
  const owner = React.useRef<Request<T> | null>(null);
  const aborter = React.useRef<AbortController | null>(null);
  const live = React.useRef(true);
  const [pending, setPending] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [preview, setPreview] = React.useState<Preview<T> | null>(null);
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  const clear = React.useCallback(() => { owner.current = null; aborter.current?.abort(); aborter.current = null; setPending(false); setPreview(null); setSelectedIndex(null); }, []);
  React.useEffect(() => { live.current = true; return () => { live.current = false; owner.current = null; aborter.current?.abort(); }; }, []);
  React.useEffect(() => { clear(); setStatus(""); }, [scope, options.sourceKey, options.enabled, clear]);
  const owns = React.useCallback((request: Request<T>) => live.current && owner.current === request && current.current.scope === request.scope && current.current.options.sourceKey === request.sourceKey && current.current.options.enabled, []);
  const sameSource = async (request: Request<T>, signal: AbortSignal) => (await current.current.options.readCurrentSource(signal)) === request.sourceKey && owns(request);
  const afterRequest = React.useCallback((request: Request<T>) => {
    const turns = current.current.options.messages;
    const index = turns.findIndex(turn => turn.role === "user" && turn.content === request.prompt);
    return index < 0 ? null : turns.slice(index + 1);
  }, []);
  const canStart = options.enabled && !!options.sourceKey && !!action?.threadId && action.projectId === options.projectId && action.available && !action.occupied && !action.running && !options.loading && !options.running && !owner.current && !busy;
  const start = async () => {
    if (!canStart || !action?.threadId || !options.sourceKey) return;
    const id = crypto.randomUUID();
    const prompt = `${AIDT_CANDIDATE_ACTIONS[options.kind]}\n本次请求：${id}\n当前实体：${options.entityId}\n${options.instruction}\n以上仅请求可审阅候选；不保存、不确认，不替学生选择。未知内容明确保留，AI 建议不作为真实用户原话或已经验证的事实。`;
    const request: Request<T> = { id, scope, sourceKey: options.sourceKey, prompt, threadId: action.threadId, prior: new Set(options.messages.map(turn => turn.id)), settled: false, parse: options.parseReply };
    owner.current = request; setPending(true); setPreview(null); setSelectedIndex(null); setStatus("正在核对当前来源…");
    const abort = new AbortController(); aborter.current = abort;
    try {
      if (!await sameSource(request, abort.signal)) { if (owns(request)) { clear(); setStatus("来源有未保存修改、版本或权限已改变，请先核对再重试。"); } return; }
      if (!owns(request)) return;
      setStatus("正在整理候选，你仍保有选择权…");
      const sent = await action.sendText(prompt);
      if (!owns(request)) return;
      request.settled = true; setPending(false);
      if (!sent) { clear(); setStatus("本轮尚未取得可用回复，请查看聊天状态后重试。"); }
    } catch { if (owns(request)) { clear(); setStatus("暂时无法读取来源或生成候选。原内容保留，可以重试或继续手写。"); } }
  };
  React.useEffect(() => {
    const request = owner.current;
    if (!request?.settled || options.loading || options.running || action?.running || !owns(request)) return;
    if (action?.failed) { clear(); setStatus("本轮对话未完成，请先处理聊天中的错误。"); return; }
    const turns = afterRequest(request);
    if (!turns) return;
    if (turns.some(turn => turn.role === "user")) { clear(); setStatus("对话已有新的学生输入，请重新生成当前候选。"); return; }
    if (preview) return;
    const reply = turns.findLast(turn => turn.role === "assistant" && !request.prior.has(turn.id) && typeof turn.content === "string" && turn.content.trim());
    if (!reply || typeof reply.content !== "string") { setStatus("尚未取得完整候选。请查看对话，或取消后继续手写。"); return; }
    let candidates: readonly T[] = [];
    try { candidates = request.parse(reply.content); } catch { /* Invalid model text stays in Chat. */ }
    if (!candidates.length || candidates.length > 24) { clear(); setStatus("回复中没有可采用的候选，请补充材料后重试或继续手写。"); return; }
    setPreview({ request, messageId: reply.id, replyText: reply.content, candidates }); setStatus("");
  }, [options.messages, options.loading, options.running, action?.running, action?.failed, preview, pending, clear, owns, afterRequest]);
  const adoptMany = async (indexes: readonly number[], onAdopt: AidtCandidateBatchAdopter<T>) => {
    if (!preview || !indexes.length || busy || !owns(preview.request)) return false;
    const candidates = [...new Set(indexes)].map(index => preview.candidates[index]);
    if (candidates.some(candidate => candidate === undefined)) return false;
    const turns = afterRequest(preview.request);
    if (!turns || turns.some(turn => turn.role === "user") || !turns.some(turn => turn.id === preview.messageId && turn.role === "assistant" && turn.content === preview.replyText)) { clear(); setStatus("对话已改变，请重新核对候选。"); return false; }
    setBusy(true);
    const abort = new AbortController(); aborter.current = abort;
    try {
      if (!await sameSource(preview.request, abort.signal)) { if (owns(preview.request)) { clear(); setStatus("当前来源或权限已改变，未采用候选。"); } return false; }
      const token = session?.sessionToken;
      if (!token) return false;
      const durable = await readAidtCandidateReply({ projectId: options.projectId, threadId: preview.request.threadId, prompt: preview.request.prompt, replyText: preview.replyText, sessionToken: token, signal: abort.signal });
      if (!owns(preview.request)) return false;
      const latestTurns = afterRequest(preview.request);
      if (!owns(preview.request) || !latestTurns || latestTurns.some(turn => turn.role === "user") || !latestTurns.some(turn => turn.id === preview.messageId && turn.role === "assistant" && turn.content === preview.replyText)) return false;
      await onAdopt(candidates as T[], { kind: options.kind, projectId: options.projectId, entityId: options.entityId, threadId: preview.request.threadId, requestId: preview.request.id, messageId: durable.messageId, sourceKey: preview.request.sourceKey });
      if (live.current && owner.current === preview.request) { clear(); setStatus("已采用到本地可编辑草稿。请核对内容，再按原流程保存、确认。"); }
      return true;
    } catch { if (owns(preview.request)) setStatus("尚未采用，原内容保留。请核对后重试。"); return false; }
    finally { if (live.current) setBusy(false); }
  };
  const notice = !options.enabled || !options.sourceKey ? options.disabledReason || "请先补充自己的初稿和本步所需来源。" : action?.occupied ? "输入框还有草稿或附件，请先处理。" : !action?.threadId || action.projectId !== options.projectId ? "当前对话尚未就绪。" : "";
  return { candidates: preview?.candidates ?? [], selectedIndex, choose: index => { if (!busy && preview && index >= 0 && index < preview.candidates.length) setSelectedIndex(index); }, pending, busy, status: status || notice, active: !!owner.current, canStart, start, cancel: () => { clear(); setStatus("已取消采用候选。已发出的聊天请求仍可能完成，原内容保留。"); }, adoptMany, adopt: onAdopt => selectedIndex === null ? Promise.resolve(false) : adoptMany([selectedIndex], (candidates, provenance) => onAdopt(candidates[0]!, provenance)) };
}
