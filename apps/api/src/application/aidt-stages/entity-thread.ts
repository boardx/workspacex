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
  if (!stage) return null;
  const { draft } = stage.content;
  const { fields } = draft;
  if (purpose === "report") {
    return stage.stageId === 6 && entityId === "group-report" ? "小组研究报告" : null;
  }
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
