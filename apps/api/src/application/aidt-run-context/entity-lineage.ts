import { AidtEntityId, AIDT_LEGACY_PROBLEM, isAidtLegacyProblem, aidtEntitySourceHref, isAidtProblemControlText, readIdeaHmwSource, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { aidtSavedEntityContext } from "../aidt-stages/entity-thread";

type Ref = { stageId: number; revision: number; entityId: string };
type Fields = Record<string, unknown>;
function object(raw: unknown): Fields {
  if (typeof raw !== "string") return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Fields : {};
  } catch { return {}; }
}

function refs(stageId: number, revision: unknown, ids: unknown): Ref[] {
  const number = typeof revision === "string" && /^[1-9]\d*$/.test(revision) ? Number(revision) : revision;
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0 || number > 2147483647 || !Array.isArray(ids)) return [];
  return [...new Set(ids)].flatMap(entityId => typeof entityId === "string" && AidtEntityId.safeParse(entityId).success
    ? [{ stageId, revision: number, entityId }] : []);
}

export function problemReference(fields: Fields) {
  const labels: Record<string,string> = { rewrittenTheme:"研究问题", initial:"原始命题", people:"研究对象", scene:"具体场景", activity:"活动",
    focus:"研究方向", whyWorthStudying:"选题理由", sourceDetails:"来源说明", known:"已知", sourceUncertainty:"待核实" };
  return Object.fromEntries(Object.entries(labels).flatMap(([key,label]) => {
    const value = fields[key];
    return typeof value === "string" && value.trim() && !isAidtProblemControlText(value) ? [[label,value.trim()]] : [];
  }));
}

function parents(stage: SharedStageValue, id: string): Ref[] {
  const fields = stage.content.draft.fields;
  switch (stage.stageId) {
    case 2: {
      const row = object(fields["interviewRecord:" + id]);
      return row.id === id ? refs(1,row.topicRevision,[row.problemEntityId]) : [];
    }
    case 3: {
      if (id === "primary-surprise") {
        let ids: unknown;
        try { ids = JSON.parse(fields.surpriseCardIds ?? "[]"); } catch { return []; }
        return refs(2,fields.surpriseSourceRevision,ids);
      }
      const row = ["definitionPersona:", "definitionHmw:", "definitionSurprise:"].map(prefix => object(fields[prefix + id])).find(row => row.id === id);
      return row ? [...refs(2,fields.definitionEvidenceRevision,row.cardIds),...refs(3,stage.revision,row.personaIds),...refs(3,stage.revision,row.surpriseIds)] : [];
    }
    case 4: {
      if (!stage.content.draft.ideas.some(idea => idea.id === id)) return [];
      const hmw = readIdeaHmwSource(fields.ideaHmwSource);
      return hmw ? refs(3,hmw.revision,[hmw.id]) : [];
    }
    case 5: {
      const selection = object(object(fields["prototypeEntity:" + id]).prototypeIdeaSource);
      return refs(4,selection.revision,selection.ideaIds);
    }
    case 6: {
      const group = object(fields["testGroup:" + id]);
      return group.id === id ? refs(5,group.stage5Revision,[group.prototypeEntity ?? group.designId]) : [];
    }
    default: return [];
  }
}

export async function entityLineage(stage: SharedStageValue, entityId: string,
  exact: (stageId: number, revision: number) => Promise<SharedStageValue>,
  recover?: (source: SharedStageValue, entityId: string) => Promise<string | undefined>) {
  const queue = parents(stage,entityId);
  async function addLegacyInterview(source: SharedStageValue, id: string) {
    if (source.stageId !== 2) return;
    const interview = object(source.content.draft.fields["interviewRecord:" + id]);
    if (interview.id !== id || interview.problemEntityId || typeof interview.topicRevision !== "number" || !Number.isInteger(interview.topicRevision) || interview.topicRevision < 1 || interview.topicRevision > 2147483647) return;
    const topic = await exact(1,interview.topicRevision);
    const fields = topic.content.draft.fields;
    if (isAidtLegacyProblem(fields)) {
      queue.push({stageId:1,revision:topic.revision,entityId:AIDT_LEGACY_PROBLEM});
      return;
    }
    const handoff = fields.problemHandoffEntity;
    // Old interview cards stored the version alone. Only the handoff selected *in that version* identifies its problem.
    if (AidtEntityId.safeParse(handoff).success && handoff && topic.content.draft.fields["problemDraft:"+handoff]) queue.push({stageId:1, revision:topic.revision, entityId:handoff});
  }
  await addLegacyInterview(stage,entityId);
  const visited = new Set<string>([JSON.stringify([stage.stageId,stage.revision,entityId])]);
  const sources: { step:number; revision:number; entityId:string; href:string; content:unknown }[] = [];
  for (let index=0; index<queue.length && sources.length<40; index++) {
    const ref = queue[index]!;
    const key = JSON.stringify([ref.stageId,ref.revision,ref.entityId]);
    if (visited.has(key)) continue;
    visited.add(key);
    const upstream = await exact(ref.stageId,ref.revision);
    const fields = upstream.content.draft.fields;
    const legacy = ref.stageId === 1 && ref.entityId === AIDT_LEGACY_PROBLEM && isAidtLegacyProblem(fields);
    if (ref.stageId === 1 && !legacy && !fields["problemDraft:"+ref.entityId]) continue;
    const problem = ref.stageId === 1 ? problemReference(legacy ? fields : object(fields["problemDraft:"+ref.entityId])) : undefined;
    if (problem && !problem["研究问题"] && !problem["原始命题"] && recover && !legacy) {
      const original = await recover(upstream,ref.entityId);
      if (original) problem["原始命题（同一对话已核对）"] = original;
    }
    const content = problem ?? aidtSavedEntityContext(upstream,ref.entityId);
    sources.push({step:ref.stageId,entityId:ref.entityId,revision:ref.revision,href:aidtEntitySourceHref(stage.projectId,ref.stageId,ref.entityId,ref.revision),content});
    queue.push(...parents(upstream,ref.entityId));
    await addLegacyInterview(upstream,ref.entityId);
  }
  return sources.sort((a,b)=>a.step-b.step);
}
