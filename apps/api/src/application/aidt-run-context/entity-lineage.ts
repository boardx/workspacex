import { readAidtBrainstorm, readAidtBrainstorms, readAidtBrainstormRoundCompletion } from "@repo/contracts/aidt-brainstorm";
import { AidtPrototypeInputSelection } from "@repo/contracts/aidt-prototype-text";
import { AidtEntityId, AIDT_LEGACY_PROBLEM, isAidtLegacyProblem, aidtEntitySourceHref, isAidtConfirmedHmwSource, isAidtProblemControlText, readIdeaHmwSource, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { aidtSavedEntityContext, type AidtEntityContextScope } from "../aidt-stages/entity-thread";

type Ref = { stageId: number; revision: number; entityId: string; expectedHmwText?: string; formalBrainstormId?: string };
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
      const isIdea = stage.content.draft.ideas.some(idea => idea.id === id);
      const session = readAidtBrainstorm(fields, id) ?? (isIdea ? readAidtBrainstorms(fields).find(row => row.candidates.includes(id)) : undefined);
      if (session) {
        const { id: hmwId, text: expectedHmwText, revision } = session.source;
        return [{ stageId: 3, revision, entityId: hmwId, expectedHmwText }];
      }
      // Generated idea IDs are bound to their owning brainstorm even if its record cannot be read.
      if (!isIdea || id.startsWith("brainstorm-")) return [];
      const hmw = readIdeaHmwSource(fields["ideaHmwSource:" + id] ?? fields.ideaHmwSource);
      return hmw ? refs(3,hmw.revision,[hmw.id]) : [];
    }
    case 5: {
      const raw = object(object(fields["prototypeEntity:" + id]).prototypeIdeaSource);
      const selection = AidtPrototypeInputSelection.safeParse(raw);
      if (!selection.success) return [];
      return refs(4,selection.data.revision,selection.data.ideaIds).map(ref => ({ ...ref,
        ...(selection.data.brainstormId ? { formalBrainstormId: selection.data.brainstormId } : {}) }));
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
  recover?: (source: SharedStageValue, entityId: string) => Promise<string | undefined>,
  contextScope?: AidtEntityContextScope) {
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
  const visited = new Set<string>([JSON.stringify([stage.stageId,stage.revision,entityId,null])]);
  const sources: { step:number; revision:number; entityId:string; href:string; content:unknown }[] = [];
  for (let index=0; index<queue.length && sources.length<40; index++) {
    const ref = queue[index]!;
    const key = JSON.stringify([ref.stageId,ref.revision,ref.entityId,ref.formalBrainstormId ?? null]);
    if (visited.has(key)) continue;
    visited.add(key);
    const upstream = await exact(ref.stageId,ref.revision);
    if (upstream.projectId !== stage.projectId || upstream.stageId !== ref.stageId || upstream.revision !== ref.revision) continue;
    if (ref.formalBrainstormId !== undefined) {
      // Only an explicitly pinned S5 source uses formal round content. The S4
      // discussion entity continues to project its current saved draft.
      const parsedRound = upstream.stageId === 4
        ? readAidtBrainstormRoundCompletion(upstream.content.draft.fields, ref.formalBrainstormId) : null;
      const hmw = parsedRound?.projectId === stage.projectId ? await exact(3,parsedRound.source.revision) : null;
      const round = parsedRound && hmw?.projectId === stage.projectId && hmw.stageId === 3 && hmw.revision === parsedRound.source.revision
        && isAidtConfirmedHmwSource(hmw,parsedRound.source) ? parsedRound : null;
      const sheet = round?.sheets.find(idea => idea.id === ref.entityId);
      const content = round && sheet ? {
        trust: "untrusted-student-material", evidenceStatus: "not-verified", reviewStatus: "student-confirmed-round",
        entityId: ref.entityId, brainstormId: round.sessionId,
        activity: { title: round.title, method: round.method, source: round.source,
          classification: { tags: round.classification.tags[sheet.id] ?? [], reason: round.classification.reasons[sheet.id] ?? "" },
          omissions: ["图片材料未在本次上下文中回源核验访问权；不加载图片、原始材料或把图像引用视为已核实证据。"] },
        fields: { title: sheet.title, description: sheet.description },
      } : {
        entityId: ref.entityId, brainstormId: ref.formalBrainstormId, kind: "missing",
        note: "所固定版本中没有同项目、同轮次的正式点子描述单；不以全局点子草稿或其他轮次替代。",
      };
      const href = aidtEntitySourceHref(stage.projectId,ref.stageId,ref.formalBrainstormId,ref.revision);
      // An idea's global draft may differ from its formal sheet. Link to the
      // round in that exact revision and retain both reference coordinates.
      if (!sources.some(source => source.step === 4 && source.revision === ref.revision && source.entityId === ref.formalBrainstormId)) {
        sources.push({step:4,entityId:ref.formalBrainstormId,revision:ref.revision,href,
          content: round && sheet ? {entityId:round.sessionId,title:round.title,status:"student-confirmed-round",evidenceStatus:"not-verified"}
            : {entityId:ref.formalBrainstormId,kind:"missing",note:"固定的正式创意列表缺失或不匹配。"}});
      }
      if (sources.length < 40) sources.push({step:ref.stageId,entityId:ref.entityId,revision:ref.revision,href,content});
      if (round && sheet) queue.push({stageId:3,revision:round.source.revision,entityId:round.source.id,expectedHmwText:round.source.text});
      continue;
    }
    if (ref.expectedHmwText !== undefined && (upstream.projectId !== stage.projectId
      || !isAidtConfirmedHmwSource(upstream, { id: ref.entityId, revision: ref.revision, text: ref.expectedHmwText }))) continue;
    const fields = upstream.content.draft.fields;
    const legacy = ref.stageId === 1 && ref.entityId === AIDT_LEGACY_PROBLEM && isAidtLegacyProblem(fields);
    if (ref.stageId === 1 && !legacy && !fields["problemDraft:"+ref.entityId]) continue;
    const problem = ref.stageId === 1 ? problemReference(legacy ? fields : object(fields["problemDraft:"+ref.entityId])) : undefined;
    if (problem && !problem["研究问题"] && !problem["原始命题"] && recover && !legacy) {
      const original = await recover(upstream,ref.entityId);
      if (original) problem["原始命题（同一对话已核对）"] = original;
    }
    const content = problem ?? aidtSavedEntityContext(upstream,ref.entityId,false,contextScope);
    sources.push({step:ref.stageId,entityId:ref.entityId,revision:ref.revision,href:aidtEntitySourceHref(stage.projectId,ref.stageId,ref.entityId,ref.revision),content});
    queue.push(...parents(upstream,ref.entityId));
    await addLegacyInterview(upstream,ref.entityId);
  }
  return sources.sort((a,b)=>a.step-b.step);
}
