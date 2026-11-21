import { createHash } from "node:crypto";
import { AIDT_ENTITY_THREAD_PREFIX, type SharedStageValue } from "@repo/contracts/aidt-stages";
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
    case 2:
      if (fields["interviewArchived:" + entityId] === "true") return null;
      return titleFor(fields, "interviewRecord:", entityId, "code", "访谈");
    case 3:
      return titleFor(fields, "definitionPersona:", entityId, "name", "用户画像")
        ?? titleFor(fields, "definitionHmw:", entityId, "text", "HMW");
    case 4: {
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
export function aidtSavedEntityContext(stage: SharedStageValue, entityId: string) {
  const { fields, ideas, discoveryCards } = stage.content.draft;
  const list = (value: Record<string, unknown> | null, keys: readonly string[]) =>
    value ? Object.fromEntries(keys.flatMap(key => {
      const item = value[key];
      return typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? [[key, item]] : [];
    })) : {};
  const read = (prefix: string, keys: readonly string[]) => list(readObject(fields[prefix + entityId]), keys);
  switch (stage.stageId) {
    case 1:
      return { entityId, fields: read("problemDraft:", ["initial", "rewrittenTheme", "reason", "whyWorthStudying", "sourceDetails", "problemSources",
        "known", "sourceUncertainty", "focus", "problemDirections", "problemDirectionId", "nextAction", "problemReflectionConfirmed"]) };
    case 2: {
      const card = discoveryCards?.find(item => item.id === entityId);
      return { entityId, fields: read("interviewRecord:", ["code", "topic", "goal", "original", "adopted", "guideConfirmed"]),
        finding: card ? { headline: card.headline, headlineKind: card.headlineKind, context: card.context } : undefined };
    }
    case 3:
      return { entityId, persona: read("definitionPersona:", ["name", "situation", "behavior", "need", "limits", "confirmed"]),
        hmw: read("definitionHmw:", ["text", "rationale", "confirmed"]) };
    case 4: {
      const idea = ideas.find(item => item.id === entityId);
      return { entityId, idea: idea ? { title: idea.title, description: idea.description } : undefined };
    }
    case 5: {
      const prototype = readObject(fields["prototypeEntity:" + entityId]);
      const content = prototype?.fields;
      return { entityId, fields: list(content && typeof content === "object" ? content as Record<string, unknown> : null,
        ["verificationQuestion", "beforeTestBelief", "verificationBasis", "verificationLimits", "designBrief", "version"]) };
    }
    case 6:
      return { entityId, fields: read("testGroup:", ["name", "task", "situation", "method", "reflection", "interpretation", "decision", "decisionReason"]) };
    default:
      return { entityId };
  }
}
