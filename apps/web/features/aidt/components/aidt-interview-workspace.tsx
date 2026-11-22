"use client";

import * as React from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import type { ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";
import { AidtNewEntityCardButton } from "./aidt-entity-card";
import { aggregateTags } from "@/lib/tag-utils";
import { AidtInterviewCards, InterviewCardEditor, type InterviewDetails } from "./aidt-interview-cards";
import { AidtInterviewRecorder } from "./aidt-interview-recorder";
import { AidtInterviewGuideExport } from "./aidt-interview-guide-export";
import { AidtInterviewOutput } from "./aidt-interview-output";
import { AidtInterviewSyntheticAsrSlot } from "./aidt-interview-synthetic-asr";
import { AidtInterviewFindingEditor } from "./aidt-interview-finding-editor";
import { AidtResearchMaterialControl, AidtResearchMaterialPreview } from "./aidt-research-material";
import { listAidtStageHistory, readAidtStage, type AidtSharedStage } from "../lib/live-aidt-stages";
import { AIDT_ROUND_COMPLETION_FIELD, aidtRoundConfirmation, aidtRoundDigest, aidtRoundPayload } from "../lib/aidt-round-completion";
import { formatAidtProblemReflectionMarkdown } from "../lib/aidt-problem-reflection";
import { isAidtResearchImage } from "../lib/aidt-research-material-reference";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import {
  aidtInterviewMaterialKey, archiveAidtInterview,
  getAidtInterviewFinding, isAidtInterviewArchived, isAidtObservation, readAidtInterviewAudio, readAidtInterviewMaterials, readAidtInterviewPhoto,
  readAidtInterviewTranscript, readAidtInterviews, setAidtInterviewPhoto, writeAidtInterview,
  writeAidtInterviewAudio, writeAidtInterviewMaterial, writeAidtInterviewTranscript, type AidtInterview,
} from "../lib/aidt-interviews";

type UpdateDraft = (mutate: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;
type Topic = { revision: number | null; text: string; reflection?: string; problemEntityId?: string };
type ConsentFlags = { notes: boolean; photos: boolean; audio: boolean; capture: boolean; asr: boolean };
const consentFlags = (interview: AidtInterview): ConsentFlags => ({
  notes: !!interview.consent?.notes, photos: !!interview.consent?.photos,
  audio: !!interview.consent?.audio, capture: !!interview.consent?.capture, asr: !!interview.consent?.asr,
});
const inputClass = "mt-1 w-full rounded-md border border-border bg-background p-2 text-13";
const blankTopic: Topic = { revision: null, text: "" };

const problemEntry = z.object({ id: z.string().uuid(), archived: z.boolean() });
const problemFields = z.record(z.string());

function readProblemDraft(draft: AidtUiStageDraft, id?: string): AidtUiStageDraft | null {
  if (!id) return draft;
  try {
    const entity = problemEntry.parse(JSON.parse(draft.fields["problemEntity:" + id] ?? "null"));
    if (entity.id !== id || entity.archived) return null;
    const fields = problemFields.parse(JSON.parse(draft.fields["problemDraft:" + id] ?? "null"));
    return { fields, ideas: [], selectedIdeaId: "" };
  } catch { return null; }
}

async function confirmedTopic(stage: AidtSharedStage | null, problemEntityId?: string): Promise<Topic | null> {
  if (!stage) return null;
  problemEntityId ??= stage.content.draft.fields.problemHandoffEntity || undefined;
  const draft = readProblemDraft(stage.content.draft, problemEntityId);
  if (!draft) return null;
  const { fields } = draft;
  const record = fields[AIDT_ROUND_COMPLETION_FIELD];
  if (!record || !fields.rewrittenTheme?.trim()) return null;
  const digest = await aidtRoundDigest(aidtRoundPayload(stage.projectId, 1, draft, stage.sourceStageRevisions));
  return record === aidtRoundConfirmation(stage.projectId, 1, digest)
    ? { revision: stage.revision, text: fields.rewrittenTheme, reflection: formatAidtProblemReflectionMarkdown(draft).slice(1).join("\n"), problemEntityId }
    : null;
}

async function readExactTopic(projectId: string, token: string, revision: number, signal: AbortSignal, id?: string) {
  if (!Number.isInteger(revision) || revision < 1 || revision > 2147483647) return null;
  const { stage } = await readAidtStage(projectId, 1, token, signal);
  if (stage?.revision === revision) return confirmedTopic(stage, id);
  if (!stage || stage.revision < revision || revision === 2147483647) return null;
  const { items } = await listAidtStageHistory(projectId, 1, token, { beforeRevision: revision + 1, limit: 1 }, signal);
  return confirmedTopic(items[0]?.revision === revision ? items[0] : null, id);
}

function InterviewField({ label, value, maxLength, disabled, onChange, rows = 1 }: {
  label: string; value: string; maxLength: number; disabled: boolean;
  onChange: (value: string) => void; rows?: number;
}) {
  return <label className="block text-12">{label}{rows > 1
    ? <textarea className={inputClass} rows={rows} maxLength={maxLength} disabled={disabled} value={value} onChange={event => onChange(event.currentTarget.value)} />
    : <input className={inputClass} maxLength={maxLength} disabled={disabled} value={value} onChange={event => onChange(event.currentTarget.value)} />}</label>;
}

export function AidtInterviewWorkspace({ projectId, draft, update, readOnly, toChat, entityId, onOpen, onCreate, surface = "legacy", savedIds, problemEntityId, problemRevision }: {
  projectId: string; draft: AidtUiStageDraft; update: UpdateDraft; readOnly: boolean;
  toChat?: (text: string) => ComposerOfferResult;
  problemEntityId?: string; problemRevision?: number;
  surface?: "materials" | "finding" | "legacy";
  savedIds?: ReadonlySet<string>;
  entityId?: string | null; onOpen?: (id: string) => void; onCreate?: (id: string, change: Parameters<UpdateDraft>[0]) => Promise<boolean>;
}) {
  const token = useOptionalSession()?.session?.sessionToken;
  const [selected, setSelected] = React.useState<string | null>(null);
  const [topic, setTopic] = React.useState<Topic>(blankTopic);
  const [topicError, setTopicError] = React.useState(false);
  const [attempt, retry] = React.useReducer((attempt: number) => attempt + 1, 0);
  const listFocus = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    setTopic(blankTopic);
    setTopicError(false);
    if (!token) return;
    const controller = new AbortController();
    async function load(sessionToken: string) {
      if (problemEntityId !== undefined || problemRevision !== undefined) {
        const exact = problemEntityId && problemRevision !== undefined
          ? await readExactTopic(projectId, sessionToken, problemRevision, controller.signal, problemEntityId)
          : null;
        if (!controller.signal.aborted) {
          if (exact) setTopic(exact);
          else setTopicError(true);
        }
        return;
      }
      const { stage } = await readAidtStage(projectId, 1, sessionToken, controller.signal);
      if (!stage) return;
      let latest = await confirmedTopic(stage);
      if (!latest && stage.revision > 1 && !controller.signal.aborted) {
        const { items } = await listAidtStageHistory(projectId, 1, sessionToken, { beforeRevision: stage.revision, limit: 20 }, controller.signal);
        for (const candidate of items) {
          latest = await confirmedTopic(candidate);
          if (latest || controller.signal.aborted) break;
        }
      }
      if (latest && !controller.signal.aborted) setTopic(latest);
    }
    void load(token).catch(() => { if (!controller.signal.aborted) setTopicError(true); });
    return () => controller.abort();
  }, [projectId, token, attempt, problemEntityId, problemRevision]);

  const records = readAidtInterviews(draft.fields);
  const interview = records.find(record => record.id === (entityId === undefined ? selected : entityId));
  const explicit = problemEntityId !== undefined || problemRevision !== undefined;
  const validTopic = !explicit || (topic.problemEntityId === problemEntityId && topic.revision === problemRevision);
  const canAdd = !readOnly && validTopic && topic.revision !== null && Object.keys(draft.fields).length < 90;
  const [creating, setCreating] = React.useState(false);
  const createId = React.useRef("");
  const add = (details: InterviewDetails) => {
    if (!canAdd) return Promise.resolve(false);
    const id = createId.current;
    const record: AidtInterview = {
      version: 1, ...details,
      id, code: "",
      topicRevision: topic.revision,
      ...(topic.problemEntityId ? { problemEntityId: topic.problemEntityId } : {}),
      topic: topic.text.slice(0, 650),
      goal: "", original: "", adopted: "", guideConfirmed: false, consent: null,
    };
    const change = (old: AidtUiStageDraft) => {
      const existing = readAidtInterviews(old.fields);
      if (existing.some(row => row.id === id) || Object.keys(old.fields).length >= 90) return old;
      const codes = new Set(existing.map(row => row.code.normalize("NFKC").toUpperCase()));
      const codePrefix = isAidtObservation(record) ? "O" : "U";
      let number = 1;
      while (codes.has(`${codePrefix}${String(number).padStart(2, "0")}`)) number += 1;
      return writeAidtInterview(old, { ...record, code: `${codePrefix}${String(number).padStart(2, "0")}` });
    };
    if (onCreate) return onCreate(id, change);
    update(change);
    if (entityId === undefined) setSelected(id);
  };
  const back = () => {
    setSelected(null);
    requestAnimationFrame(() => listFocus.current?.focus());
  };

  return <section className="space-y-4" aria-label={interview && isAidtObservation(interview) ? "观察工作区" : "访谈工作区"}>
    {entityId && !interview ? <p role="status">找不到此研究记录。请返回列表查找其最新状态。</p> : interview
      ? entityId && surface === "legacy" ? <AidtInterviewOutput entityId={entityId} draft={draft} projectId={projectId} /> : <InterviewDetail surface={surface} compact={Boolean(entityId)} key={interview.id} {...{ interview, draft, update, projectId, topic, toChat }} readOnly={readOnly || isAidtInterviewArchived(draft.fields, interview.id)} onBack={entityId ? undefined : back} />
      : <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-16 font-semibold" ref={listFocus} tabIndex={-1}>{records.some(isAidtObservation) ? "访谈与观察" : "访谈列表"}</h4>
          <AidtNewEntityCardButton disabled={!canAdd} onClick={() => { createId.current = crypto.randomUUID(); setCreating(true); }} />
        </div>
        {topic.revision && <details className="text-12"><summary className="cursor-pointer">已确认研究问题 · 第 1 步 V{topic.revision}</summary><p className="mt-2 whitespace-pre-wrap">{topic.text}</p></details>}
        {!topic.revision && !topicError && <p className="text-12 text-muted-foreground">确认并保存第 1 步的研究问题后可新建访谈或观察。</p>}
        {topicError && <p role="alert" className="text-12">研究问题读取失败。<Button size="xs" variant="ghost" onClick={retry}>重试读取</Button></p>}
        {creating && canAdd && <InterviewCardEditor source={`第 1 步 V${topic.revision} · ${topic.text}`} knownTags={aggregateTags(records.filter(row => !isAidtInterviewArchived(draft.fields, row.id)))} close={() => setCreating(false)} save={add} />}
        <AidtInterviewCards {...{ projectId, records, draft, readOnly, update, savedIds }} onOpen={id => onOpen ? onOpen(id) : setSelected(id)} />
      </>}
  </section>;
}

function InterviewSection({ compact, title, children }: { compact: boolean; title: string; children: React.ReactNode }) {
  return compact ? <details className="space-y-3 border-t border-border pt-3"><summary className="cursor-pointer text-13 font-medium">{title}</summary>{children}</details> : <>{children}</>;
}

function InterviewDetail({ interview, draft, update, projectId, readOnly, onBack, topic, toChat, surface, compact }: {
  surface: "materials" | "finding" | "legacy"; compact: boolean;
  interview: AidtInterview; draft: AidtUiStageDraft; update: UpdateDraft; projectId: string;
  readOnly: boolean; onBack?: () => void; topic: Topic; toChat?: (text: string) => ComposerOfferResult;
}) {
  const { id, code } = interview;
  const observation = isAidtObservation(interview);
  const token = useOptionalSession()?.session?.sessionToken;
  const [pinned, setPinned] = React.useState<Topic | null>(null);
  React.useEffect(() => {
    const revision = interview.topicRevision;
    if (!token || !revision || (topic.revision === revision && topic.problemEntityId === interview.problemEntityId)) return;
    const controller = new AbortController();
    void readExactTopic(projectId, token, revision, controller.signal, interview.problemEntityId)
      .then(result => { if (result && !controller.signal.aborted) setPinned(result); })
      .catch(() => { if (!controller.signal.aborted) setPinned(null); });
    return () => controller.abort();
  }, [projectId, token, interview.topicRevision, interview.problemEntityId, topic.revision, topic.problemEntityId]);
  const matchesTopic = (candidate: Topic | null) => candidate?.revision === interview.topicRevision && candidate?.problemEntityId === interview.problemEntityId;
  const exactTopic = matchesTopic(topic) ? topic : matchesTopic(pinned) ? pinned : null;
  const topicText = exactTopic?.text ?? interview.topic;
  const [newCode, setNewCode] = React.useState(code);
  const [status, setStatus] = React.useState("");
  const [archiving, setArchiving] = React.useState(false);
  const [consentEdits, setConsentEdits] = React.useState<{ values: Partial<ConsentFlags>; photoBasis?: string | null }>({ values: {} });
  const authority = consentFlags(interview);
  const consentRevision = interview.consent?.observedAt ?? null;
  const stalePhotoEdit = consentEdits.values.photos !== undefined && consentEdits.photoBasis !== consentRevision;
  const { notes, audio, capture, asr, photos } = {
    ...authority, ...consentEdits.values,
    photos: stalePhotoEdit ? authority.photos : consentEdits.values.photos ?? authority.photos,
  };
  const editConsent = (field: keyof ConsentFlags, value: boolean) => setConsentEdits(old => ({
    ...old, values: { ...old.values, [field]: value }, ...(field === "photos" ? { photoBasis: consentRevision } : {}),
  }));
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => { if (surface === "legacy") heading.current?.focus(); }, [surface]);
  const record = (patch: Partial<AidtInterview>) => {
    if (readOnly) return;
    update(old => {
      const current = readAidtInterviews(old.fields).find(item => item.id === id);
      return current ? writeAidtInterview(old, { ...current, ...patch }) : old;
    });
  };
  const finding = getAidtInterviewFinding(draft, interview);
  const materials = readAidtInterviewMaterials(draft.fields, id, projectId);
  const photoKey = readAidtInterviewPhoto(draft, interview, projectId)?.key ?? "";
  const transcript = readAidtInterviewTranscript(draft.fields, id) ?? { sourceKey: "", locator: "", text: "", checked: false };
  const editableEvidence = !readOnly && !!interview.consent?.notes;
  const isAllowed = (mime: string) => mime.startsWith("image/") ? interview.consent?.photos
    : mime.startsWith("audio/") ? interview.consent?.audio : interview.consent?.notes;
  const allowedKinds = (["document", "image", "audio"] as const).filter(kind =>
    kind === "document" ? interview.consent?.notes : kind === "image" ? interview.consent?.photos : interview.consent?.audio,
  );

  return <div className="space-y-4">
    {surface === "legacy" && <><div className="flex flex-wrap items-center justify-between gap-2">
      {onBack && <Button type="button" size="xs" variant="ghost" onClick={onBack}>返回访谈列表</Button>}
      <h4 className="text-16 font-semibold" ref={heading} tabIndex={-1}>{code} · {observation ? "观察详情" : "访谈详情"}</h4>
    </div>
    <InterviewSection compact={compact} title={observation ? "观察设置与研究问题" : "访谈设置与研究问题"}>
    <div className="flex items-end gap-2">
      <InterviewField label={observation ? "观察记录代号" : "受访者代号"} value={newCode} maxLength={32} disabled={readOnly} onChange={setNewCode} />
      <Button type="button" size="sm" variant="outline" disabled={readOnly || !newCode.trim() || newCode.trim() === code} onClick={() => {
        if (readAidtInterviews(draft.fields).some(item => item.id !== id && item.code.normalize("NFKC").toLowerCase() === newCode.trim().normalize("NFKC").toLowerCase())) {
          setStatus(observation ? "该代号已存在，请打开原研究记录。" : "该受访者代号已存在，补访请打开原访谈卡。");
        } else {
          record({ code: newCode.trim() });
          setStatus("");
        }
      }}>保存代号</Button>
    </div>
    <p className="whitespace-pre-wrap text-12">{interview.topicRevision ? `第 1 步 V${interview.topicRevision} · ${topicText}${exactTopic ? "" : "（保存的摘要）"}` : "尚无已确认的研究问题引用。"}</p>
    {exactTopic?.reflection && <details className="text-12">
      <summary className="cursor-pointer">查看第 1 步同版本的问题反思</summary>
      <p className="mt-2 whitespace-pre-wrap">{exactTopic.reflection}</p>
    </details>}
    {topic.revision !== null && topic.problemEntityId === interview.problemEntityId && topic.revision !== interview.topicRevision && <Button type="button" size="sm" variant="outline" disabled={readOnly} onClick={() =>
      record({ topicRevision: topic.revision, topic: topic.text.slice(0, 650), guideConfirmed: false })
    }>改用第 1 步 V{topic.revision} 并重新核对提纲</Button>}
    </InterviewSection>
    <InterviewSection compact={compact} title={observation ? "编辑观察计划" : "编辑提纲"}>
    <section className="space-y-3 border-t border-border pt-3" aria-label={observation ? "观察计划" : "访谈提纲"}>
      <h5 className="text-14 font-semibold">{observation ? "观察计划" : "访谈提纲"}</h5>
      <InterviewField label={observation ? "本次观察关注什么" : "想了解什么"} value={interview.goal} maxLength={250} disabled={readOnly} onChange={goal => record({ goal, guideConfirmed: false })} />
      <InterviewField label={observation ? "学生观察计划原稿" : "学生提纲原稿"} value={interview.original} maxLength={1000} disabled={readOnly} rows={3} onChange={original => record({ original, guideConfirmed: false })} />
      {toChat && <Button type="button" size="sm" variant="outline" disabled={readOnly || !interview.original.trim()} onClick={() => {
        const result = toChat(observation
          ? `观察记录：${code}\n研究问题：${topicText || "尚未确认"}\n观察关注点：${interview.goal}\n学生观察计划：\n${interview.original}\n请帮助聚焦实际可观察的行为与情境，区分观察记录和推断，不生成受访者原话或虚构现场。`
          : `受访者代号：${code}\n研究问题：${topicText || "尚未确认"}\n想了解：${interview.goal}\n学生提纲原稿：\n${interview.original}\n请核对提问是否中立，并指出可追问的具体经验。`);
        setStatus(result === "accepted" ? "原稿已带入输入框，请检查后发送。" : result === "occupied" ? "有未发送的聊天草稿，请先处理。" : "本步聊天尚未就绪。");
      }}>向引导师核对原稿</Button>}
      <InterviewField label={observation ? "学生采纳的观察关注点" : "学生采纳清单"} value={interview.adopted} maxLength={1000} disabled={readOnly} rows={3} onChange={adopted => record({ adopted, guideConfirmed: false })} />
      <Button type="button" size="sm" disabled={readOnly || interview.guideConfirmed || !interview.original.trim() || !interview.adopted.trim()} onClick={() => record({ guideConfirmed: true })}>{interview.guideConfirmed ? observation ? "已核对观察计划" : "已核对清单" : observation ? "确认观察关注点" : "确认此人的问题清单"}</Button>
      {!compact && <AidtInterviewGuideExport kind={observation ? "observation" : "interview"} scopeKey={id} guide={interview.original} adoptedGuide={interview.guideConfirmed ? [code, topicText, interview.adopted].filter(Boolean).join("\n\n") : ""} />}
    </section>
    </InterviewSection>
    </>}
    {surface !== "finding" && <InterviewSection compact={false} title={observation ? "观察材料与授权" : "访谈材料与授权"}>
    <section className="space-y-3 border-t border-border pt-3" aria-label={observation ? "授权和观察材料" : "授权和访谈材料"}>
      <h5 className="text-14 font-semibold">授权和材料</h5>
      {observation && <p className="text-12 text-muted-foreground">上传真实观察笔记、现场照片等材料，记录时间、情境与行为。学生解释与实际观察分开，不补写受访者原话。</p>}
      <p className="text-12 text-muted-foreground">{interview.consent ? `学生记录于 ${new Date(interview.consent.observedAt).toLocaleString()}` : "尚未记录可共享的材料授权。"}请按实际授权勾选。</p>
      <label className="flex items-center gap-2 text-12"><input type="checkbox" checked={notes} disabled={readOnly} onChange={event => editConsent("notes", event.currentTarget.checked)} />已获授权共享文字记录</label>
      <label className="flex items-center gap-2 text-12"><input type="checkbox" checked={photos} disabled={readOnly} onChange={event => editConsent("photos", event.currentTarget.checked)} />已获授权共享照片</label>
      <label className="flex items-center gap-2 text-12"><input type="checkbox" checked={audio} disabled={readOnly} onChange={event => editConsent("audio", event.currentTarget.checked)} />已获授权共享原始录音</label>
      <label className="flex items-center gap-2 text-12"><input type="checkbox" checked={audio && capture} disabled={readOnly || !audio} onChange={event => editConsent("capture", event.currentTarget.checked)} />已获授权在此录音</label>
      <label className="flex items-center gap-2 text-12"><input type="checkbox" checked={audio && capture && asr} disabled={readOnly || !audio || !capture} onChange={event => editConsent("asr", event.currentTarget.checked)} />已获授权使用在线转写服务</label>
      {stalePhotoEdit && <p role="status" className="text-12 text-muted-foreground">照片授权已在其他位置更新，请重新核对照片选择。</p>}
      <Button type="button" size="sm" variant="outline" disabled={readOnly || ((audio && capture && asr) === authority.asr && (audio && capture) === authority.capture && audio === authority.audio && notes === authority.notes && photos === authority.photos)} onClick={() => {
        if (readOnly) return;
        update(old => {
          const current = readAidtInterviews(old.fields).find(item => item.id === id);
          if (!current || isAidtInterviewArchived(old.fields, id)) return old;
          const next = { ...consentFlags(current), ...consentEdits.values,
            photos: consentEdits.values.photos !== undefined && consentEdits.photoBasis === (current.consent?.observedAt ?? null)
              ? consentEdits.values.photos : !!current.consent?.photos };
          return writeAidtInterview(old, { ...current, consent: next.notes || next.photos || next.audio ? {
            ...next, observedAt: new Date().toISOString(), capture: next.audio && next.capture, asr: next.audio && next.capture && next.asr,
          } : null });
        });
        setConsentEdits({ values: {} });
      }}>更新授权记录</Button>
      {interview.consent?.audio && interview.consent.capture && token && <AidtInterviewRecorder
        key={JSON.stringify([projectId, token, id, interview.consent.observedAt, readOnly])}
        projectId={projectId} participantCode={code} sessionToken={token}
        disabled={readOnly || Object.keys(draft.fields).length >= 95} asrAllowed={!!interview.consent.asr}
        onAttached={({ source, ...metadata }) => {
          const key = aidtInterviewMaterialKey(id, encodeURIComponent(source.runId));
          update(old => writeAidtInterviewAudio(old, id, key, source, metadata));
        }}
      />}
      {interview.consent && !!allowedKinds.length && <AidtResearchMaterialControl
        projectId={projectId} label={`${code}研究原件`} readOnly={readOnly || Object.keys(draft.fields).length >= 95}
        allowedKinds={allowedKinds}
        onlyLocalMaterials selectionScope={interview.consent.observedAt} localMaterials={materials.map(item => item.reference)}
        onChange={reference => {
          if (!reference || !isAllowed(reference.mime)) return;
          const key = aidtInterviewMaterialKey(id, `${encodeURIComponent(reference.artifactId)}:${encodeURIComponent(reference.versionId)}`);
          update(old => writeAidtInterviewMaterial(old, id, key, JSON.stringify(reference)));
        }}
      />}
      {materials.filter(item => isAllowed(item.reference.mime)).map(({ key, reference }) => {
        const recorded = readAidtInterviewAudio(draft.fields, key);
        return <div key={key} className="space-y-2">
          {recorded && <p className="text-12 text-muted-foreground">
            录音 ${new Date(recorded.startedAt).toLocaleString()} · ${Math.round(recorded.durationMs / 1000)} 秒
          </p>}
          <AidtResearchMaterialPreview projectId={projectId} reference={reference} quote={key === transcript.sourceKey ? finding.quote : undefined} />
          {!readOnly && interview.consent?.notes && interview.consent.audio && reference.mime.startsWith("audio/") && <AidtInterviewSyntheticAsrSlot projectId={projectId} entityId={id} materialKey={key} />}
          {isAidtResearchImage(reference) && <Button type="button" size="xs" variant="outline"
            disabled={readOnly || photoKey === key}
            onClick={() => update(old => setAidtInterviewPhoto(old, id, key, projectId))}>
            {photoKey === key ? "已用作发现卡照片" : "用作发现卡照片"}
          </Button>}
          {recorded?.draftTranscript && interview.consent?.asr && <details className="text-12">
            <summary className="cursor-pointer">查看自动转写摘录</summary>
            <p className="mt-2 whitespace-pre-wrap">{recorded.draftTranscript}</p>
            <p className="text-muted-foreground">时间标记为浏览器收到文字时的录音位置，请对照原件校对。</p>
            <Button type="button" size="xs" variant="outline" disabled={!editableEvidence || !!transcript.text.trim()} onClick={() => {
              update(old => writeAidtInterviewTranscript(old, id, { sourceKey: key, locator: "", text: recorded.draftTranscript, checked: false }));
            }}>带入待校对摘录</Button>
          </details>}
          <Button type="button" size="xs" variant="ghost" disabled={readOnly} onClick={() => update(old => writeAidtInterviewMaterial(old, id, key, ""))}>{observation ? "移除此观察的材料关联" : "移除此访谈的材料关联"}</Button>
        </div>;
      })}
      {interview.consent?.notes && <>
        <label className="block text-12">{observation ? "观察记录原件" : "转写原件"}<select className={inputClass} value={transcript.sourceKey} disabled={!editableEvidence} onChange={event => {
          const sourceKey = event.currentTarget.value;
          update(old => writeAidtInterviewTranscript(old, id, { sourceKey, locator: "", text: "", checked: false }));
        }}><option value="">{observation ? "选择本次观察原件" : "选择本访谈原件"}</option>{materials.filter(item => !item.reference.mime.startsWith("image/") && isAllowed(item.reference.mime)).map(item =>
          <option key={item.key} value={item.key}>{item.reference.name}</option>
        )}</select></label>
        <InterviewField label="定位（如 01:42 或第 3 段）" value={transcript.locator} maxLength={120} disabled={!editableEvidence || !transcript.sourceKey} onChange={locator =>
          update(old => writeAidtInterviewTranscript(old, id, { ...transcript, locator, checked: false }))
        } />
        <InterviewField label={observation ? "校对后的观察记录摘录" : "校对后的摘录"} value={transcript.text} maxLength={1700} disabled={!editableEvidence || !transcript.sourceKey} rows={3} onChange={text =>
          update(old => writeAidtInterviewTranscript(old, id, { ...transcript, text, checked: false }))
        } />
        <label className="flex items-center gap-2 text-12"><input type="checkbox" checked={transcript.checked} disabled={!editableEvidence || !transcript.text.trim() || !transcript.locator.trim()} onChange={event => {
          const checked = event.currentTarget.checked;
          update(old => writeAidtInterviewTranscript(old, id, { ...transcript, checked }, projectId));
        }} />已对照原始材料校对</label>
      </>}
    </section>
    </InterviewSection>
    }
    {surface !== "materials" && <InterviewSection compact={surface === "legacy" && compact} title={observation ? "整理观察发现" : "整理访谈发现"}>
      <AidtInterviewFindingEditor {...{ projectId, interview, draft, readOnly, update }} />
    </InterviewSection>
    }
    {!readOnly && !compact && surface === "legacy" && <div className="space-y-2 border-t border-border pt-3">{archiving ? <>
      <p className="text-12">归档后从待交接列表移除，历史版本和原件可按权限回查。</p>
      <Button type="button" size="xs" variant="outline" onClick={() => { update(old => archiveAidtInterview(old, id)); onBack?.(); setArchiving(false); }}>确认归档</Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => setArchiving(false)}>取消</Button>
    </> : <Button type="button" size="xs" variant="ghost" onClick={() => setArchiving(true)}>{observation ? "归档此观察" : "归档此访谈"}</Button>}</div>}
    {status && <p role="status" className="text-12">{status}</p>}
  </div>;
}
