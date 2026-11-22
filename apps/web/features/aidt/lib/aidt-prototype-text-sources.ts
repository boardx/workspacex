import { AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX } from "@repo/contracts/aidt-test-research";
import { parseAidtResearchMaterial, researchMaterialKey, isAidtResearchImage, type AidtResearchMaterialReference } from "./aidt-research-material-reference";
import { ApiError } from "@/lib/api-client";
import { readAidtStage, readAidtStageRevision, type AidtSharedStage } from "./live-aidt-stages";
import { readAidtIdeaHandoff, readAidtIdeaHmwSource } from "./aidt-idea-handoff";
import { readAidtBrainstorms, AIDT_BRAINSTORM_METHODS } from "@repo/contracts/aidt-brainstorm";
import { readAidtConfirmedBrainstormRounds } from "./aidt-brainstorm";
import { aidtIdeaClassificationFor } from "./aidt-idea-classification";
import { readAidtDefinition, readAidtDefinitionEvidenceRevision } from "./aidt-definition";
import { readAidtInterviews, isAidtInterviewArchived, isAidtInterviewConfirmed } from "./aidt-interviews";
import { listAidtProblems, readAidtProblemEntityDraft } from "./aidt-problem-entities";
import { AidtPrototypeLineage, type AidtPrototypeTraceReference } from "./aidt-prototype-text-state";
import type { AidtPrototypeInputSelection } from "./aidt-prototype-handoff";

type Input = { projectId: string; sessionToken: string; selection: AidtPrototypeInputSelection; signal?: AbortSignal; lineage?: AidtPrototypeLineage };
export type AidtPrototypeSourceView = { reference: AidtPrototypeTraceReference; title: string; text: string; href: string; image?: AidtResearchMaterialReference };
export type AidtPrototypeSources = { lineage: AidtPrototypeLineage; items: { ideaId: string; title: string; views: AidtPrototypeSourceView[]; missing: string[] }[]; restricted: boolean };

/** No raw research is copied into lineage. Every view rechecks the same project
 * and current interview consent, even when the source or text design is old. */
export async function loadAidtPrototypeTextSources(input: Input): Promise<AidtPrototypeSources> {
  const current = () => {
    if (!input.projectId || !input.sessionToken || input.signal?.aborted) throw new Error("AIDT_CONTEXT_CHANGED");
  };
  current();
  const cache = new Map<string, Promise<AidtSharedStage | null>>();
  function stage(stageId: number, revision?: number) {
    current();
    const key = `${stageId}:${revision ?? "current"}`;
    if (!cache.has(key)) cache.set(key, (revision === undefined
      ? readAidtStage(input.projectId, stageId, input.sessionToken, input.signal).then(result => result.stage)
      : readAidtStageRevision(input.projectId, stageId, revision, input.sessionToken, input.signal)).then(value => {
      current();
      if (value && (value.projectId !== input.projectId || value.stageId !== stageId || revision !== undefined && value.revision !== revision)) throw new Error("AIDT_PROTOTYPE_SOURCE_SCOPE_MISMATCH");
      return value;
    }));
    return cache.get(key)!;
  }
  const ideation = await stage(4, input.selection.revision);
  if (!ideation) throw new Error("AIDT_PROTOTYPE_SOURCE_MISSING");
  const formalRound = input.selection.brainstormId ? readAidtConfirmedBrainstormRounds(ideation.content.draft, input.projectId,
    { sessionId: input.selection.brainstormId, includeArchived: true }).find(round => round.stableId === input.selection.brainstormId && !round.legacy) : null;
  const legacy = input.selection.brainstormId ? null : readAidtIdeaHandoff(ideation.content.draft, input.projectId);
  const available = formalRound?.ideas ?? legacy?.ideas ?? [];
  if ((input.selection.brainstormId && !formalRound) || !input.selection.ideaIds.length
    || !input.selection.ideaIds.every(id => available.some(idea => idea.id === id))) throw new Error("AIDT_PROTOTYPE_SOURCE_UNCONFIRMED");
  const frozenDraft = formalRound?.draft ?? ideation.content.draft;
  let lineage: AidtPrototypeLineage;
  if (input.lineage) {
    lineage = AidtPrototypeLineage.parse(input.lineage);
    if (lineage.projectId !== input.projectId || lineage.stage4Revision !== input.selection.revision || lineage.brainstormId !== input.selection.brainstormId
      || JSON.stringify(lineage.ideas.map(item => item.ideaId)) !== JSON.stringify(input.selection.ideaIds)) throw new Error("AIDT_PROTOTYPE_SOURCE_SCOPE_MISMATCH");
  } else {
    const traces: AidtPrototypeLineage["ideas"] = [];
    for (const ideaId of input.selection.ideaIds) {
      const references: AidtPrototypeTraceReference[] = [{ stageId: 4, revision: ideation.revision, entityId: ideaId, role: "idea" }];
      const missing: string[] = [];
      const add = (ref: AidtPrototypeTraceReference) => { if (!references.some(value => JSON.stringify(value) === JSON.stringify(ref))) references.push(ref); };
      const owner = readAidtBrainstorms(frozenDraft.fields).find(session => session.candidates.includes(ideaId));
      if (formalRound) add({ stageId: 4, revision: ideation.revision, entityId: formalRound.stableId, role: "brainstorm" });
      else if (owner) add({ stageId: 4, revision: ideation.revision, entityId: owner.id, role: "brainstorm" });
      else missing.push("S4 未记录所属头脑风暴场次；点子版本仍固定。");
      const hmwSource = formalRound?.source ?? readAidtIdeaHmwSource(frozenDraft, ideaId);
      if (!hmwSource) { missing.push("S3 未绑定该点子的画像与 HMW 来源。"); traces.push({ ideaId, references, missing }); continue; }
      const definition = await stage(3, hmwSource.revision);
      const records = definition && readAidtDefinition(definition.content.draft.fields);
      const hmw = records?.hmws.find(record => record.id === hmwSource.id && record.confirmed && !record.archived && record.text.trim() === hmwSource.text);
      if (!definition || !records || !hmw || records.invalid) { missing.push("S3 无法核对所绑定的确认 HMW；未用最新版本替代。"); traces.push({ ideaId, references, missing }); continue; }
      add({ stageId: 3, revision: definition.revision, entityId: hmw.id, role: "hmw" });
      const personas = records.personas.filter(persona => hmw.personaIds.includes(persona.id) && persona.confirmed && !persona.archived);
      for (const persona of personas) add({ stageId: 3, revision: definition.revision, entityId: persona.id, role: "persona" });
      if (!personas.length || personas.length !== hmw.personaIds.length) missing.push("S3 部分画像缺少可核对的确认记录。");
      const evidenceRevision = readAidtDefinitionEvidenceRevision(definition.content.draft.fields);
      const cardIds = [...new Set([...hmw.cardIds, ...personas.flatMap(persona => persona.cardIds)])];
      if (!evidenceRevision || !definition.sourceStageRevisions.some(ref => ref.stageId === 2 && ref.revision === evidenceRevision) || !cardIds.length) {
        missing.push("S2 未绑定该 HMW／画像所用的研究版本与发现卡。"); missing.push("S1 缺少通过访谈关联的原始挑战版本。");
      } else {
        const research = await stage(2, evidenceRevision);
        const interviews = research ? readAidtInterviews(research.content.draft.fields) : [];
        for (const cardId of cardIds) {
          const interview = interviews.find(record => record.id === cardId);
          const finding = research?.content.draft.discoveryCards?.find(card => card.id === cardId);
          if (!research || !interview || !finding || !interview.consent?.notes || !isAidtInterviewConfirmed(research.content.draft.fields, cardId)) {
            missing.push("S2 部分引用缺少已授权、已核对的访谈发现。"); continue;
          }
          add({ stageId: 2, revision: research.revision, entityId: cardId, role: "interview" });
          add({ stageId: 2, revision: research.revision, entityId: cardId, role: "finding" });
          if (interview.problemEntityId && interview.topicRevision) {
            const challenge = await stage(1, interview.topicRevision);
            if (challenge && listAidtProblems(challenge.content.draft).some(record => record.id === interview.problemEntityId)) add({ stageId: 1, revision: challenge.revision, entityId: interview.problemEntityId, role: "challenge" });
            else missing.push("S1 所绑定的原始挑战记录不可核对。");
          } else missing.push("S1 该访谈未绑定确切的问题 ID 与版本。");
        }
      }
      traces.push({ ideaId, references, missing: [...new Set(missing)] });
    }
    lineage = AidtPrototypeLineage.parse({ schemaVersion: 1, projectId: input.projectId, stage4Revision: ideation.revision,
      ...(input.selection.brainstormId ? { brainstormId: input.selection.brainstormId } : {}), ideas: traces });
  }
  let restricted = false;
  const items: AidtPrototypeSources["items"] = [];
  for (const trace of lineage.ideas) {
    const views: AidtPrototypeSourceView[] = [], missing = [...trace.missing];
    for (const reference of trace.references) {
      if (formalRound && reference.stageId === 4 && (reference.revision !== ideation.revision
        || !["brainstorm", "idea"].includes(reference.role)
        || reference.role === "brainstorm" && reference.entityId !== formalRound.stableId
        || reference.role === "idea" && (!input.selection.ideaIds.includes(reference.entityId) || !formalRound.ideas.some(idea => idea.id === reference.entityId)))) throw new Error("AIDT_PROTOTYPE_SOURCE_SCOPE_MISMATCH");
      const value = await stage(reference.stageId, reference.revision);
      if (!value) { missing.push(`第 ${reference.stageId} 步 V${reference.revision} 来源缺失；未替换版本。`); continue; }
      const { fields } = value.content.draft;
      let title = "", text = "";
      let image: AidtResearchMaterialReference | undefined;
      if (reference.role === "interview" || reference.role === "finding") {
        const latest = await stage(2);
        const access = latest && readAidtInterviews(latest.content.draft.fields).find(record => record.id === reference.entityId);
        const original = readAidtInterviews(fields).find(record => record.id === reference.entityId);
        if (!latest || !access?.consent?.notes || !original?.consent?.notes) {
          restricted = true; missing.push("访谈文字授权已撤回或当前无法核对；对应文字设计暂不展示或继续制作。"); continue;
        }
        if (isAidtInterviewArchived(latest.content.draft.fields, reference.entityId)) missing.push("该访谈当前已归档；此处保留有授权的冻结历史引用。");
        title = original.code;
        if (reference.role === "interview") text = [original.topic, original.goal, original.adopted || original.original].filter(Boolean).join("\n");
        else {
          const card = value.content.draft.discoveryCards?.find(record => record.id === reference.entityId);
          const synthetic = Object.hasOwn(fields, AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + reference.entityId);
          text = card ? [...(synthetic ? ["合成音频软件 QA，非真人访谈，不作为真实用户证据。"] : []), `发现：${card.headline}`, `情境：${card.context}`, `${synthetic ? "合成转写摘录" : "原话"}：${card.quote || "未记录"}`, `学生解释：${fields["interviewInterpretation:" + reference.entityId] || "未记录"}`, `来源：${card.sourceRef || "未记录"}`].join("\n") : "";
        }
      } else if (reference.role === "challenge") {
        const record = listAidtProblems(value.content.draft).find(record => record.id === reference.entityId);
        const problem = record && readAidtProblemEntityDraft(value.content.draft, reference.entityId);
        title = record?.title ?? "";
        text = problem ? [`原始挑战：${problem.fields.initial || "未记录"}`, `情境：${problem.fields.scene || "未记录"}`, `学生重写：${problem.fields.rewrittenTheme || "未记录"}`].join("\n") : "";
      } else if (reference.role === "hmw" || reference.role === "persona") {
        const definition = readAidtDefinition(fields);
        if (reference.role === "hmw") {
          const hmw = definition.hmws.find(record => record.id === reference.entityId);
          title = hmw?.text ?? ""; text = hmw ? [hmw.text, hmw.rationale].join("\n") : "";
        } else {
          const persona = definition.personas.find(record => record.id === reference.entityId);
          title = persona?.name ?? ""; text = persona ? [persona.name, persona.situation, persona.behavior, persona.need, persona.limits].join("\n") : "";
        }
      } else if (reference.role === "brainstorm") {
        const session = formalRound ?? readAidtBrainstorms(fields).find(record => record.id === reference.entityId);
        title = session?.title || "头脑风暴"; text = session ? `${AIDT_BRAINSTORM_METHODS[session.method]} · ${session.source.text}` : "";
      } else {
        const idea = (formalRound?.ideas ?? value.content.draft.ideas).find(record => record.id === reference.entityId);
        title = idea?.title ?? ""; text = idea?.description ?? "";
        const material = parseAidtResearchMaterial((formalRound?.draft ?? value.content.draft).fields[researchMaterialKey("idea", reference.entityId)]);
        if (material?.projectId === input.projectId && isAidtResearchImage(material)) image = material;
        else missing.push("该点子的冻结描述单图片缺失或不可核对；未使用其他图片替代。");
        if (idea && formalRound) {
          const classification = aidtIdeaClassificationFor(formalRound.classificationDraft, idea.id);
          text += `\n学生分类：${classification.labels.join("、") || "暂未分类"}；理由：${classification.reason || "未记录"}`;
        }
      }
      if (!text) { missing.push(`第 ${reference.stageId} 步 ${reference.entityId} 正文未记录。`); continue; }
      // Individual idea history may now contain a later draft. Link the exact
      // confirmed list instead; its inspector projects the frozen sheet bodies.
      const linkedEntity = formalRound && reference.stageId === 4 ? formalRound.stableId : reference.entityId;
      views.push({ reference, title, text, ...(image ? { image } : {}), href: `/aidt/${encodeURIComponent(input.projectId)}?${new URLSearchParams({ step: String(reference.stageId), entity: linkedEntity, entityRevision: String(reference.revision) })}` });
    }
    items.push({ ideaId: trace.ideaId, title: available.find(idea => idea.id === trace.ideaId)?.title || trace.ideaId, views, missing: [...new Set(missing)] });
  }
  current();
  return { lineage, items, restricted };
}

export function aidtPrototypeSourceFailure(error: unknown) {
  return error instanceof ApiError && [401, 403, 404].includes(error.status)
    ? "当前无权读取来源；未使用旧副本继续展示或制作。" : "来源读取失败；未改用其他版本。";
}
