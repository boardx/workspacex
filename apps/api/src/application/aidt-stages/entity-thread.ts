import { aidtBrainstormTitle, AIDT_BRAINSTORM_METHODS, AIDT_BRAINSTORM_METHOD_GUIDES, readAidtBrainstorm, readAidtBrainstorms } from "@repo/contracts/aidt-brainstorm";
import { createHash } from "node:crypto";
import { AIDT_ENTITY_THREAD_PREFIX, aidtInterviewTitle, isAidtProblemControlText, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { readAidtQuestionSnapshot } from "@repo/contracts/aidt-return-reflection";
import { checkedInterviewExcerpt } from "./interview-skill-draft";
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
export function aidtSavedEntityContext(stage: SharedStageValue, entityId: string, includeCheckedExcerpt = true) {
  const { fields, ideas, discoveryCards } = stage.content.draft;
  const list = (value: Record<string, unknown> | null, keys: readonly string[]) =>
    value ? Object.fromEntries(keys.flatMap(key => {
      const item = value[key];
      if (key === "topic" && typeof item === "string" && isAidtProblemControlText(item)) return [];
      return typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? [[key, item]] : [];
    })) : {};
  const read = (prefix: string, keys: readonly string[]) => list(readObject(fields[prefix + entityId]), keys);
  switch (stage.stageId) {
    case 1:
      return { entityId, fields: read("problemDraft:", ["initial", "rewrittenTheme", "people", "scene", "activity", "reason", "whyWorthStudying", "sourceDetails", "problemSources",
        "known", "sourceUncertainty", "focus", "problemDirections", "problemDirectionId", "nextAction", "problemReflectionConfirmed"]) };
    case 2: {
      const card = discoveryCards?.find(item => item.id === entityId);
      return { entityId, fields: read("interviewRecord:", ["code", "topic", "goal", "original", "adopted", "guideConfirmed"]),
        checkedExcerpt: includeCheckedExcerpt ? checkedInterviewExcerpt(fields, entityId, stage.projectId) : undefined,
        finding: card ? { headline: card.headline, headlineKind: card.headlineKind, context: card.context } : undefined };
    }
    case 3:
      if (entityId === "primary-surprise") {
        return { entityId, kind: "surprise", fields: list(fields, [
          "surpriseStatus", "priorBelief", "surprisingFinding", "surpriseInterpretation",
        ]) };
      }
      if (Object.hasOwn(fields, "definitionPersona:" + entityId)) {
        return { entityId, kind: "persona", fields: read("definitionPersona:", ["name", "situation", "behavior", "need", "limits", "confirmed"]) };
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
      return { entityId, fields: read("prototypeEntity:", [
        "verificationQuestion", "beforeTestBelief", "verificationBasis", "verificationLimits", "designBrief", "version",
      ]) };
    case 6: {
      const group = readObject(fields["testGroup:" + entityId]);
      const question = readAidtQuestionSnapshot(stage.content.draft);
      const matched = question && group?.stage5Revision === question.sourceStageRevision
        && group.designId === question.prototypeDesignId && group.versionId === question.prototypeVersionId;
      return { entityId, fields: list(group, ["name", "task", "situation", "method", "reflection", "interpretation", "decision", "decisionReason"]),
        question: matched ? question : undefined };
    }
    default:
      return { entityId };
  }
}
