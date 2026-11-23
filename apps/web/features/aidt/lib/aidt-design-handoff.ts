import type { AidtResearchMaterialReference } from "./aidt-research-material-reference";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { DESIGN_TEXT_MAX_CHARS } from "@repo/contracts/design-workbench";
import { ApiError } from "@/lib/api-client";
import type { AidtSharedStage } from "./live-aidt-stages";
import { readAidtStage, listAidtStageHistory } from "./live-aidt-stages";
import { isAidtModuleEnabled } from "./aidt-module-config";
import { isVerificationQuestionConfirmed, readAidtQuestionSnapshot, aidtQuestionSnapshotMatches, isAidtReflectionConfirmed, readAidtReturnDecision } from "./aidt-verification-loop";
import { aidtPrototypePreparationError, readAidtPrototypeInputSelection, readAidtPrototypeEntityDraft, readAidtPrototypeHmwSource, resolveAidtPrototypeInputIdeas, usesAidtPrototypeInputSelection } from "./aidt-prototype-handoff";
import type { DesignComposerContextOffer } from "@/components/design-loop/composer-context-offer";
import { loadAidtConfirmedPrototypeText, loadAidtBoundPrototypeTextSources } from "./aidt-prototype-confirmed-text";
import { aidtPrototypeTextHashes, readAidtPrototypeTextOutputBinding, readAidtPrototypeTextOutputBindings } from "./aidt-prototype-text-state";
import { AidtPrototypeTextConfirmation } from "@repo/contracts/aidt-prototype-text";

export type AidtDesignHandoff = { offer: DesignComposerContextOffer; warnings: readonly string[]; sources: readonly { stageId: number; revision: number }[];
  sourceImages?: readonly { ideaId: string; title: string; stage4Revision: number; brainstormId: string; reference: AidtResearchMaterialReference }[];
  textBasis?: { designId: string; stageRevision: number; textVersion: string; textSha256: string } };
export type AidtDesignHandoffInput = { projectId: string; stageId: number; sessionToken: string; signal?: AbortSignal; roundRevision?: number; prototypeEntityId?: string };
const field = (stage: AidtSharedStage | null, id: string) => stage?.content.draft.fields[id]?.trim() ?? "";
function assertCurrent(input: AidtDesignHandoffInput) {
  if (!isAidtModuleEnabled() || input.signal?.aborted) throw new Error("AIDT_CONTEXT_CHANGED");
  if (!input.projectId.trim() || !input.sessionToken || ![5, 6].includes(input.stageId)) throw new Error("AIDT_DESIGN_CONTEXT_UNAVAILABLE");
}
function rethrowDeniedRead(error: unknown) {
  // AIDT_STAGE_NOT_FOUND also masks revoked project read access (service.ts).
  // An absent saved revision is returned as null/[], not an HTTP 404.
  if (error instanceof ApiError && [401, 403, 404].includes(error.status)) throw error;
}
async function saved(input: AidtDesignHandoffInput, stageId: number, revision?: number): Promise<AidtSharedStage | null> {
  assertCurrent(input);
  let stage: AidtSharedStage | null;
  if (revision === undefined) stage = (await readAidtStage(input.projectId, stageId, input.sessionToken, input.signal)).stage;
  else {
    if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER) throw new Error("AIDT_DESIGN_CONTEXT_UNAVAILABLE");
    const page = await listAidtStageHistory(input.projectId, stageId, input.sessionToken, { beforeRevision: revision + 1, limit: 1 }, input.signal);
    stage = page.items[0] ?? null;
  }
  assertCurrent(input);
  if (stage && (stage.projectId !== input.projectId || stage.stageId !== stageId || revision !== undefined && stage.revision !== revision)) throw new Error("AIDT_DESIGN_CONTEXT_UNAVAILABLE");
  return stage;
}

/** Only authorized saved records; no draft promotion, model request or native Design write. */
export async function loadAidtDesignHandoff(input: AidtDesignHandoffInput): Promise<AidtDesignHandoff> {
  assertCurrent(input);
  const warnings: string[] = [], sources: { stageId: number; revision: number }[] = [];
  const useFrozenRound = input.stageId === 6 || input.roundRevision !== undefined;
  const round = useFrozenRound ? await saved(input, 6, input.roundRevision) : null;
  const snapshot = round ? readAidtQuestionSnapshot(round.content.draft) : null;
  if (useFrozenRound && !snapshot) throw new Error("AIDT_DESIGN_SAVED_QUESTION_REQUIRED");
  if (input.stageId === 5 && input.roundRevision !== undefined) {
    const decision = round ? readAidtReturnDecision(round.content.draft) : null;
    if (!round || !isAidtReflectionConfirmed(round.content.draft) || decision?.kind !== "selected" || Number(decision.step) !== input.stageId) throw new Error("AIDT_DESIGN_RETURN_CONTEXT_INVALID");
  }
  if (round) sources.push({ stageId: 6, revision: round.revision });
  let prototype: AidtSharedStage | null = null;
  const entityId = useFrozenRound ? snapshot?.prototypeDesignId : input.prototypeEntityId;
  const projectPrototype = (stage: AidtSharedStage | null) => {
    if (!stage || !entityId) return stage;
    const draft = readAidtPrototypeEntityDraft(stage.content.draft, entityId);
    if (draft) return { ...stage, content: { ...stage.content, draft: StageDraft.parse(draft) } };
    return !useFrozenRound && input.prototypeEntityId ? null : stage;
  };
  if (!useFrozenRound) {
    prototype = projectPrototype(await saved(input, 5));
    if (!prototype || !isVerificationQuestionConfirmed(prototype.content.draft)) throw new Error("AIDT_DESIGN_SAVED_QUESTION_REQUIRED");
  } else if (snapshot?.sourceStageRevision) {
    try {
      prototype = projectPrototype(await saved(input, 5, snapshot.sourceStageRevision));
      if (!prototype || !round || !aidtQuestionSnapshotMatches(round.content.draft, prototype.content.draft, prototype.revision)) {
        prototype = null; warnings.push("第5步历史问题卡缺失或与本轮绑定不一致，未改用新的第5步；冻结问题仍保留。");
      }
    } catch (error) { assertCurrent(input); rethrowDeniedRead(error); warnings.push("未能读取本轮绑定的第5步历史，未改用新的第5步内容。"); }
  } else warnings.push("本轮未绑定第5步共享版本；只保留已保存的冻结问题，不采用当前第5步。");
  if (prototype) sources.push({ stageId: 5, revision: prototype.revision });
  let confirmed: Pick<Awaited<ReturnType<typeof loadAidtConfirmedPrototypeText>>, "confirmation" | "sources" | "hashes"> | null = null;
  if (entityId && !useFrozenRound) {
    confirmed = await loadAidtConfirmedPrototypeText({ projectId: input.projectId, designId: entityId, sessionToken: input.sessionToken, signal: input.signal });
  } else if (entityId && useFrozenRound) {
    // A frozen question can only use the binding recorded beside its exact old
    // prototype version. Never consult the current S5 text/confirmation here.
    const frozenDraft = prototype?.content.draft;
    const binding = frozenDraft && [readAidtPrototypeTextOutputBinding(frozenDraft), ...readAidtPrototypeTextOutputBindings(frozenDraft)]
      .find(value => value?.designId === entityId && value.versionId === snapshot?.prototypeVersionId);
    if (binding && prototype) {
      if (binding.projectId !== input.projectId || binding.textStageRevision > prototype.revision) throw new Error("AIDT_PROTOTYPE_TEXT_VERSION_MISMATCH");
      const original = await saved(input, 5, binding.textStageRevision);
      const originalText = original && readAidtPrototypeEntityDraft(original.content.draft, entityId);
      if (!originalText) {
        warnings.push("本轮旧原型所绑定的文字设计历史缺失；仅保留冻结问题与只读来源，未取当前文字替代。");
      } else {
        const basis = AidtPrototypeTextConfirmation.parse({ schemaVersion: 1, projectId: input.projectId, designId: entityId,
          stageRevision: binding.textStageRevision, textVersion: originalText.fields.prototypeTextVersion, text: originalText.fields.prototypeTextDesign,
          selection: originalText.fields.prototypeIdeaSource, lineage: originalText.fields.prototypeTextLineage });
        const hashes = await aidtPrototypeTextHashes(basis);
        if (basis.textVersion !== binding.textVersion || hashes.textSha256 !== binding.textSha256 || hashes.lineageSha256 !== binding.lineageSha256) throw new Error("AIDT_PROTOTYPE_TEXT_VERSION_MISMATCH");
        const frozenSources = await loadAidtBoundPrototypeTextSources({ projectId: input.projectId, designId: entityId,
          sessionToken: input.sessionToken, signal: input.signal }, binding);
        confirmed = { confirmation: basis, hashes, sources: frozenSources };
      }
    } else {
      warnings.push("本轮旧原型未记录确切文字设计绑定；保留旧问题及只读交接，不补造文字设计，也不采用当前确认稿。");
    }
  }
  if (entityId && confirmed) {
    const basis = confirmed.confirmation;
    const textSources = confirmed.sources.lineage.ideas.flatMap(idea => idea.references);
    const exactSources = [...new Map([...sources, { stageId: 5, revision: basis.stageRevision }, ...textSources]
      .map(source => [`${source.stageId}:${source.revision}`, { stageId: source.stageId, revision: source.revision }])).values()];
    const text = [
      "教学原型制作 · 学生已确认的文字设计",
      `项目 ${input.projectId}；原型 ${entityId}；文字设计 第5步 V${basis.stageRevision}；文字版本 ${basis.textVersion}`,
      `确认原文 SHA256：${confirmed.hashes.textSha256}；冻结来源 SHA256：${confirmed.hashes.lineageSha256}`,
      useFrozenRound ? "以下文字固定来自本轮旧原型所绑定的历史修订，与冻结问题一起使用；不采用当前第5步文字。" : "以下文字来自确切已保存修订。缺少的研究资料不能由模型补造；学生仍需审阅实际输出。",
      basis.text,
      ...confirmed.sources.items.map(item => `点子 ${item.title}（${item.ideaId}）：${item.views.map(view => `第${view.reference.stageId}步 V${view.reference.revision} / ${view.reference.entityId}`).join("；")}\n缺口：${item.missing.join("；") || "无已记录缺口"}`),
      snapshot ? `本轮冻结验证问题：${snapshot.question}\n先前看法：${snapshot.beforeTestBelief}\n范围：${snapshot.verificationLimits}` : `本轮验证问题：${field(prototype, "verificationQuestion")}\n范围：${field(prototype, "verificationLimits")}`,
      "制作后请学生查看确切原型版本并明确绑定本份文字设计；提示文字与版本摘要不能冒充供应商来源回执。",
    ].join("\n\n");
    if (text.length > DESIGN_TEXT_MAX_CHARS) throw new Error("AIDT_DESIGN_CONTEXT_TOO_LONG");
    assertCurrent(input);
    return { offer: { id: JSON.stringify([input.projectId, input.stageId, entityId, basis.stageRevision, basis.textVersion, round?.revision, snapshot?.prototypeVersionId]), label: `${useFrozenRound ? "本轮冻结" : "已确认"}文字设计 · 第5步 V${basis.stageRevision}`, text },
      sourceImages: confirmed.sources.items.flatMap(item => item.views.flatMap(view => view.reference.role === "idea" && view.image ? [{ ideaId: item.ideaId, title: item.title, stage4Revision: view.reference.revision, brainstormId: confirmed.sources.lineage.brainstormId ?? "", reference: view.image }] : [])),
      warnings: ["制作后需查看实际版本并由学生明确绑定文字依据；这不表示供应商独立验证了来源。",
        ...(useFrozenRound && !confirmed.sources.lineage.brainstormId ? ["旧绑定未记录独立 Ideation 列表；只读保留此历史文字，不据此启动新制作。"] : [])], sources: exactSources,
      ...(!useFrozenRound || confirmed.sources.lineage.brainstormId
        ? { textBasis: { designId: entityId, stageRevision: basis.stageRevision, textVersion: basis.textVersion, textSha256: confirmed.hashes.textSha256 } } : {}) };
  }
  const references = new Map(prototype?.sourceStageRevisions.map(source => [source.stageId, source.revision]) ?? []);
  const prototypeDraft = prototype?.content.draft;
  const selection = prototypeDraft ? readAidtPrototypeInputSelection(prototypeDraft) : null;
  if (!useFrozenRound && prototypeDraft && (input.prototypeEntityId || usesAidtPrototypeInputSelection(prototypeDraft)) && (
    !selection || (!input.prototypeEntityId && references.get(4) !== selection.revision) || aidtPrototypePreparationError(prototypeDraft)
  )) throw new Error("AIDT_DESIGN_INPUTS_UNCONFIRMED");
  async function supporting(stageId: 3 | 4, pinnedRevision?: number) {
    const revision = pinnedRevision ?? ( stageId === 4 && selection ? selection.revision : references.get(stageId));
    if (useFrozenRound && revision === undefined) { warnings.push(`缺少本轮第${stageId}步历史来源；未使用最新稿替代。`); return null; }
    try {
      const result = await saved(input, stageId, revision);
      if (result) {
        sources.push({ stageId, revision: result.revision });
        if (revision === undefined) warnings.push(`第${stageId}步为本次读取的已保存参考，尚未绑定为第5步正式来源。`);
      } else warnings.push(`第${stageId}步尚无可读取的已保存成果。`);
      return result;
    } catch (error) { assertCurrent(input); rethrowDeniedRead(error); warnings.push(`第${stageId}步来源读取失败，未按空白或其他版本补齐。`); return null; }
  }
  const legacyDefinition = selection ? null : await supporting(3);
  const ideation = await supporting(4);
  const hmwSource = selection ? readAidtPrototypeHmwSource(ideation, selection.brainstormId) : null;
  const definition = hmwSource ? await supporting(3, hmwSource.revision) : legacyDefinition;
  const exactHmw = hmwSource && definition?.content.draft.fields.definitionHmwId === hmwSource.id
    && field(definition, "hmw") === hmwSource.text ? hmwSource.text : "";
  if (selection && !exactHmw && !useFrozenRound) throw new Error("AIDT_DESIGN_INPUTS_UNCONFIRMED");
  const legacyIdea = ideation?.content.draft.ideas.find(idea => idea.id === ideation.content.draft.selectedIdeaId);
  const chosen = selection ? resolveAidtPrototypeInputIdeas(selection, ideation ?? undefined) : legacyIdea ? [legacyIdea] : [];
  if (!useFrozenRound && selection && !chosen.length) throw new Error("AIDT_DESIGN_INPUTS_UNCONFIRMED");
  if (!chosen.length) warnings.push("尚缺已保存的入选描述单；请由学生选择，不能由模型代选。");
  const question = snapshot?.question ?? field(prototype, "verificationQuestion");
  const prior = snapshot?.beforeTestBelief ?? field(prototype, "beforeTestBelief");
  const basis = snapshot?.verificationBasis ?? field(prototype, "verificationBasis");
  const limits = snapshot?.verificationLimits ?? field(prototype, "verificationLimits");
  const text = [
    "教学原型制作说明 · 学生审阅后发送",
    `项目：${input.projectId}；已保存来源：${sources.map(source => `第${source.stageId}步 V${source.revision}`).join("、")}`,
    useFrozenRound ? "继续本轮原问题；以下问题来自第6步冻结卡，不以新的第5步改写。" : "仅采用已保存的确认稿；本页尚未保存的编辑未自动带入。",
    `本轮最想知道的问题：${question}`,
    `生成前的看法或预期：${prior || "尚未记录，先追问"}`,
    `看法的依据：${basis || "尚缺，不能推测为事实"}`,
    `可验证/不可验证范围：${limits || "尚待明确；静态图不能证明真实时间投入或付费"}`,
    `HMW（第3步学生记录）：${(selection ? exactHmw : field(definition, "hmw")) || "缺少已保存的来源"}`,
    `第4步入选描述单：${chosen.length ? chosen.map(idea => `${idea.title}\n${idea.description}`).join("\n\n") : "尚缺，不代选"}`,
    ...chosen.flatMap(idea => idea.imageAttachment ? [`「${idea.title}」图片引用：对话 ${idea.imageAttachment.threadId} / 附件 ${idea.imageAttachment.attachmentId}；未将附件上传到 Design。`] : []),
    `第5步学生记录的选定点子：${field(prototype, "idea") || "尚缺；与描述单的对应关系需学生核对"}`,
    `原型类型与使用情境：${field(prototype, "type") || "待讨论"}；${field(prototype, "situation") || "待讨论"}`,
    `测试者任务与如何观察：${field(prototype, "task") || "尚待学生明确"}`,
    ...(["touchpoints", "operations", "requirements"] as const).flatMap((id, index) =>
      field(prototype, id) ? [`${["接触点", "操作步骤", "制作要求"][index]}：${field(prototype, id)}`] : []),
    snapshot ? `本轮旧原型引用：${snapshot.prototypeRef}${snapshot.prototypeDesignId ? `；Design ID ${snapshot.prototypeDesignId} / 版本 ID ${snapshot.prototypeVersionId}` : "（学生文字记录）"}` : "版本将在原生Design保存后由学生明确选择并绑定，不能以提示文字冒充已生成。",
    ...warnings.map(warning => `待核对：${warning}`),
    "请围绕同一主问题协助制作静态粗原型。缺材料先追问；不得代替学生选方向、编造研究事实或宣称测试通过。生成结果仍需学生检查，版本存在不代表生成质量已验收。",
  ].join("\n\n");
  if (text.length > DESIGN_TEXT_MAX_CHARS) throw new Error("AIDT_DESIGN_CONTEXT_TOO_LONG");
  assertCurrent(input);
  return { offer: { id: JSON.stringify([input.projectId, input.stageId, entityId, sources]), label: useFrozenRound ? "本轮冻结问题与已保存制作说明" : "已保存的问题与制作说明", text }, warnings, sources };
}
