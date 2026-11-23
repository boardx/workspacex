import { aidtBrainstormTitle, AIDT_BRAINSTORM_METHODS, AIDT_BRAINSTORM_METHOD_GUIDES, readAidtBrainstorm, readAidtBrainstorms } from "@repo/contracts/aidt-brainstorm";
import { createHash } from "node:crypto";
import { AIDT_ENTITY_THREAD_PREFIX, aidtInterviewTitle, isAidtProblemControlText, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { AidtPrototypeReferenceSchema, readAidtQuestionSnapshot } from "@repo/contracts/aidt-return-reflection";
import { readAidtProblemCandidateSource, readAidtInterviewFindingAiSource } from "@repo/contracts/aidt-candidate-request";
import { aidtPersonaCanvasKey, readStoredAidtPersonaCanvas } from "@repo/contracts/aidt-persona-canvas";
import { AIDT_PROTOTYPE_TEXT_MAX_CHARS, AidtPrototypeLineage, AidtPrototypeTextOutputBinding, projectAidtPrototypeTextEntity, readAidtPrototypeTextConfirmationFields, isAidtPrototypeTextConfirmationCurrent } from "@repo/contracts/aidt-prototype-text";
import { AIDT_TEST_VIRTUAL_RESEARCH_PREFIX, AidtTestResearchPath, AidtVirtualResearchBindingSchema, AidtSyntheticFileAsrKind } from "@repo/contracts/aidt-test-research";
import { checkedInterviewExcerpt, interviewSyntheticAsrContext } from "./interview-skill-draft";
import type { StageActor } from "./ports";

export function aidtEntityThreadId(actor: StageActor, stageId: number, entityId: string, purpose: "stage" | "report") {
  const identity = JSON.stringify([actor.orgId, actor.projectId, stageId, entityId, purpose]);
  return AIDT_ENTITY_THREAD_PREFIX + createHash("sha256").update(identity).digest("hex");
}

function readObject(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Only the provider's authenticated scope and authorized current stage read belong here. */
export type AidtEntityContextScope = { orgId: string; currentInterviews?: SharedStageValue | null };
const metadataOmission = (note: string) => ({ kind: "missing" as const, note });

function personaTemplateContext(stage: SharedStageValue, entityId: string, scope?: AidtEntityContextScope) {
  const fields = stage.content.draft.fields;
  if (!Object.hasOwn(fields, aidtPersonaCanvasKey(entityId))) return;
  const canvas = readStoredAidtPersonaCanvas(fields, entityId);
  const persona = readObject(fields["definitionPersona:" + entityId]);
  const current = scope?.currentInterviews;
  const cardIds = persona?.cardIds;
  const omitted = () => ({ omissions: [metadataOmission("画像模板来源、当前材料授权或已保存版本无法核对；模板与画布正文未加入上下文。 ")] });
  if (!canvas || !scope || !current) return omitted();
  const sourceMatches = canvas.source.orgId === scope.orgId && canvas.source.projectId === stage.projectId
    && canvas.source.revision === Number(fields.definitionEvidenceRevision)
    && (canvas.source.definitionRevision === undefined || canvas.source.definitionRevision <= stage.revision)
    && persona?.id === entityId && persona.archived !== true
    && Array.isArray(cardIds) && new Set(cardIds).size === cardIds.length && canvas.source.cardIds.length === cardIds.length
    && canvas.source.cardIds.every(id => cardIds.includes(id));
  const currentlyAllowed = sourceMatches && current.projectId === stage.projectId && current.stageId === 2
    && canvas.source.cardIds.every(id => {
      const interview = readObject(current.content.draft.fields["interviewRecord:" + id]);
      const consent = interview?.consent;
      return interview?.id === id && current.content.draft.fields["interviewArchived:" + id] !== "true"
        && current.content.draft.fields["interviewConfirmed:" + id] === "true"
        && typeof consent === "object" && consent !== null && !Array.isArray(consent)
        && (consent as Record<string, unknown>).notes === true
        && current.content.draft.discoveryCards?.some(card => card.id === id);
    });
  if (!currentlyAllowed) return omitted();
  return {
    evidenceStatus: "AI 辅助画像，经学生选择；不是受访者原话或已验证证据。",
    omissions: [metadataOmission("已保存画布代码可能含历史引文，自动上下文不读取；如需使用正文须重新核对原件授权。")],
    source: { ...canvas.source, loadedDefinitionRevision: stage.revision, currentInterviewRevision: current.revision },
    templateSnapshot: canvas.template,
  };
}

function prototypeTextContext(stage: SharedStageValue, entityId: string) {
  const entity = projectAidtPrototypeTextEntity(stage.content.draft.fields, entityId);
  if (!entity?.prototypeTextDesign) return;
  const body = entity.prototypeTextDesign;
  if (body.length > AIDT_PROTOTYPE_TEXT_MAX_CHARS) return { omissions: [metadataOmission("正式文字设计超出保存格式，未加入上下文。")], status: "unreadable" };
  const confirmation = readAidtPrototypeTextConfirmationFields(entity);
  const current = Boolean(confirmation && confirmation.projectId === stage.projectId && confirmation.designId === entityId
    && confirmation.stageRevision <= stage.revision && isAidtPrototypeTextConfirmationCurrent(entity));
  const lineage = AidtPrototypeLineage.safeParse(readObject(entity.prototypeTextLineage));
  const source = current && lineage.success && lineage.data.projectId === stage.projectId ? lineage.data : undefined;
  const output = AidtPrototypeTextOutputBinding.safeParse(readObject(entity.prototypeTextOutputBinding));
  const reference = AidtPrototypeReferenceSchema.safeParse(readObject(entity.prototypeReference));
  const binding = current && confirmation && output.success && output.data.projectId === stage.projectId && output.data.designId === entityId
    && reference.success && reference.data.designId === output.data.designId && reference.data.versionId === output.data.versionId
    && output.data.textStageRevision === confirmation.stageRevision && output.data.textVersion === confirmation.textVersion
    && output.data.textSha256 === createHash("sha256").update(body).digest("hex")
    && output.data.lineageSha256 === createHash("sha256").update(confirmation.lineage).digest("hex") ? output.data : undefined;
  return {
    // Canonical JSON sorts keys: keep the short status/version/hash before long lineage.
    design: { status: current ? "student-confirmed-current-text" : "draft-or-confirmation-stale",
      sha256: createHash("sha256").update(body).digest("hex"), characters: body.length,
      textVersion: entity.prototypeTextVersion, confirmedStageRevision: current ? confirmation?.stageRevision : undefined },
    evidenceStatus: "学生保存的设计及关联元数据；确认不代表原件当前授权、真实测试通过或服务商验证。",
    omissions: [metadataOmission("正式文字及确认正文可能含历史访谈内容，未重核原件许可，自动上下文仅提供摘要哈希与来源坐标。")],
    outputBinding: binding,
    source: source ? { projectId: source.projectId, stage4Revision: source.stage4Revision, brainstormId: source.brainstormId,
      ideas: source.ideas.map(idea => ({ ideaId: idea.ideaId, references: idea.references })) } : undefined,
  };
}

function titleFor(fields: Record<string, string>, key: string, id: string, name: string, fallback: string): string | null {
  const value = readObject(fields[key + id]);
  if (!value || value.id !== id || value.archived === true) return null;
  const title = value[name];
  return typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : fallback;
}

export function isAidtPrototypeEntityArchived(stage: SharedStageValue | null, entityId: string) {
  return readObject(stage?.content.draft.fields["prototypeEntity:" + entityId])?.prototypeArchived === "true";
}

export function aidtSavedEntityTitle(stage: SharedStageValue | null, entityId: string, purpose: "stage" | "report"): string | null {
  if (purpose === "report") {
    if (entityId === "group-report") return "小组研究报告";
    return stage?.stageId === 6 && stage.content.reports && Object.hasOwn(stage.content.reports, entityId)
      ? "小组研究报告"
      : null;
  }
  if (!stage) return null;
  const { draft } = stage.content;
  const { fields } = draft;
  switch (stage.stageId) {
    case 1:
      return titleFor(fields, "problemEntity:", entityId, "title", "理解与提出问题");
    case 2: {
      if (fields["interviewArchived:" + entityId] === "true") return null;
      const code = titleFor(fields, "interviewRecord:", entityId, "code", "访谈");
      if (code === null) return null;
      const name = readObject(fields["interviewRecord:" + entityId])?.displayName;
      return aidtInterviewTitle(code, typeof name === "string" ? name.slice(0, 80) : undefined);
    }
    case 3:
      if (entityId === "primary-surprise" && fields.definitionPrimaryEntity === "true") return "意外发现";
      return titleFor(fields, "definitionPersona:", entityId, "name", "用户画像")
        ?? titleFor(fields, "definitionHmw:", entityId, "text", "HMW")
        ?? titleFor(fields, "definitionSurprise:", entityId, "observation", "意外发现");
    case 4: {
      const session = readAidtBrainstorm(fields, entityId);
      if (session) return session.archived ? null : aidtBrainstormTitle(session);
      if (/^draft-[123]$/.test(entityId)) return null;
      let archived: unknown;
      try { archived = JSON.parse(fields.ideaArchivedIds || "[]"); } catch { return null; }
      if (!Array.isArray(archived) || archived.includes(entityId)) return null;
      const idea = draft.ideas.find(item => item.id === entityId);
      return idea ? idea.title.trim().slice(0, 200) || "点子" : null;
    }
    case 6:
      return titleFor(fields, "testGroup:", entityId, "name", "测试");
    default:
      return null;
  }
}

/** Read only the selected entity's saved teaching fields. Native attachments use their own authorized tools. */
export function aidtSavedEntityContext(stage: SharedStageValue, entityId: string, includeCheckedExcerpt = true, scope?: AidtEntityContextScope) {
  const { fields, ideas, discoveryCards } = stage.content.draft;
  const list = (value: Record<string, unknown> | null, keys: readonly string[]) =>
    value ? Object.fromEntries(keys.flatMap(key => {
      const item = value[key];
      if (key === "topic" && typeof item === "string" && isAidtProblemControlText(item)) return [];
      return typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? [[key, item]] : [];
    })) : {};
  const read = (prefix: string, keys: readonly string[]) => list(readObject(fields[prefix + entityId]), keys);
  switch (stage.stageId) {
    case 1: {
      const problem = readObject(fields["problemDraft:" + entityId]);
      const studentSource = readAidtProblemCandidateSource(Object.fromEntries(Object.entries(problem ?? {})
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")));
      return { entityId, ...(studentSource ? { activity: { provenance: studentSource,
        status: "学生选择并编辑的 AI 辅助候选来源，不是原话、授权或成果确认。" } } : {}),
        fields: read("problemDraft:", ["initial", "rewrittenTheme", "people", "scene", "activity", "reason", "whyWorthStudying", "sourceDetails", "problemSources",
          "known", "sourceUncertainty", "focus", "problemDirections", "problemDirectionId", "nextAction", "problemReflectionConfirmed"]) };
    }
    case 2: {
      const card = discoveryCards?.find(item => item.id === entityId);
      const studentSource = card && readAidtInterviewFindingAiSource(fields, entityId, stage.projectId, card.headline);
      const record = readObject(fields["interviewRecord:" + entityId]);
      const observation = record?.kind === "observation";
      const synthetic = interviewSyntheticAsrContext(fields,entityId,stage.projectId);
      return { entityId, activity: {
        researchKind: observation ? "observation" : "interview",
        researchKindLabel: observation ? "观察记录" : "访谈记录",
        status: observation ? "学生观察记录；区分实际看见的行为与学生解释，不将解释写为受访者原话。"
          : "学生访谈记录；区分受访者陈述与学生解释，材料仍须核对。",
        ...(synthetic ?? {}),
        ...(studentSource ? { provenance: studentSource, provenanceStatus: "学生选择的 AI 归纳，不是原话、证据核验或成果确认。" } : {}),
      },
        fields: read("interviewRecord:", ["kind", "code", "topic", "goal", "original", "adopted", "guideConfirmed"]),
        checkedExcerpt: includeCheckedExcerpt ? checkedInterviewExcerpt(fields, entityId, stage.projectId) : undefined,
        finding: card && !synthetic ? { headline: card.headline, headlineKind: card.headlineKind, context: card.context } : undefined };
    }
    case 3:
      if (entityId === "primary-surprise") {
        return { entityId, kind: "surprise", fields: list(fields, [
          "surpriseStatus", "priorBelief", "surprisingFinding", "surpriseInterpretation",
        ]) };
      }
      if (Object.hasOwn(fields, "definitionPersona:" + entityId)) {
        return { entityId, kind: "persona", activity: personaTemplateContext(stage, entityId, scope),
          fields: read("definitionPersona:", ["name", "situation", "behavior", "need", "limits", "confirmed"]) };
      }
      if (Object.hasOwn(fields, "definitionHmw:" + entityId)) {
        return { entityId, kind: "hmw", fields: read("definitionHmw:", ["text", "rationale", "confirmed"]) };
      }
      return { entityId, kind: "surprise", fields: read("definitionSurprise:", ["priorBelief", "observation", "interpretation", "unknowns", "confirmed"]) };
    case 4: {
      const session = readAidtBrainstorm(fields, entityId);
      if (session) return { entityId, brainstorm: {
        // Canonical context JSON sorts keys. Keep the current activity ahead of
        // potentially long HMW/student text so its guide survives the existing cap.
        activity: { methodKey: session.method, methodGuide: AIDT_BRAINSTORM_METHOD_GUIDES[session.method] },
        method: AIDT_BRAINSTORM_METHODS[session.method],
        targetCount: session.count, generatedCount: session.candidates.length, hmw: session.source,
      }, existingCandidateTitles: ideas.filter(idea => session.candidates.includes(idea.id)).map(idea => idea.title) };
      const idea = ideas.find(item => item.id === entityId);
      const owner = readAidtBrainstorms(fields).find(record => record.candidates.includes(entityId));
      return { entityId, idea: idea ? { title: idea.title, description: idea.description } : undefined, hmw: owner?.source };
    }
    case 5:
      return { entityId, activity: prototypeTextContext(stage, entityId), fields: read("prototypeEntity:", [
        "verificationQuestion", "beforeTestBelief", "verificationBasis", "verificationLimits", "designBrief", "version",
        "type", "situation", "task", "touchpoints", "operations", "requirements",
      ]) };
    case 6: {
      const group = readObject(fields["testGroup:" + entityId]);
      if (!group || group.id !== entityId || group.archived === true) return { entityId,
        activity: { omissions: [metadataOmission("当前测试实体未保存、已归档或标识不匹配；未读取其他测试。 ")] } };
      const question = readAidtQuestionSnapshot(stage.content.draft);
      const matched = question && group?.stage5Revision === question.sourceStageRevision
        && group.designId === question.prototypeDesignId && group.versionId === question.prototypeVersionId;
      const requestedPath = AidtTestResearchPath.safeParse(group?.researchPath ?? (group?.method === "survey" ? "survey" : "offline"));
      const path = requestedPath.success ? requestedPath.data : undefined;
      const syntheticFile = AidtSyntheticFileAsrKind.safeParse(group.evidenceOrigin).success;
      const binding = AidtVirtualResearchBindingSchema.safeParse(readObject(fields[AIDT_TEST_VIRTUAL_RESEARCH_PREFIX + entityId]));
      const selectedSource = group?.source;
      const sourceId = typeof selectedSource === "object" && selectedSource !== null && !Array.isArray(selectedSource)
        && (selectedSource as Record<string, unknown>).kind === "interview" ? (selectedSource as Record<string, unknown>).id : undefined;
      const linkedVirtual = path === "virtual" && group?.id === entityId && group.archived !== true && binding.success
        && binding.data.interviewId === sourceId ? binding.data : undefined;
      return { entityId, activity: {
        ...(syntheticFile ? { evidenceOrigin: "synthetic-file-asr", evidenceStatus: "合成文件 ASR 软件验收记录，未回源重核；不是受访者录音或真人行为证据。" } : {}),
        researchPath: path,
        researchStatus: path === "virtual" ? "学生保存的模拟研究摘录，未回源重核；不是当前授权、真人访谈或实际行为证据。"
          : path === "survey" ? "问卷自报或意向，不能自动视为实际行为。" : path === "offline" ? "学生记录的线下材料，真实性与证据边界须核对。" : "研究方式无法读取，请学生核对。",
        ...(path === "virtual" ? linkedVirtual ? { virtualResearch: {
          binding: { interviewId: linkedVirtual.interviewId, revisionId: linkedVirtual.revisionId, envelopeVersion: linkedVirtual.envelopeVersion,
            outline: linkedVirtual.outline, runs: linkedVirtual.runs, report: linkedVirtual.report },
          findings: linkedVirtual.findings,
        } }
          : { omissions: [metadataOmission("当前测试没有匹配的模拟文档固定版本；未加入摘录，不改用最新版本。 ")] } : {}),
      }, fields: list(group, ["name", "participant", "task", "situation", "method", "reflection", "interpretation", "evidenceGap", "sourceLocation", "decision", "decisionReason",
        ...(path === "virtual" || syntheticFile ? [] : ["said", "did"])]),
        question: matched ? question : undefined };
    }
    default:
      return { entityId };
  }
}
