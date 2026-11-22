import { StageDraft } from "@repo/contracts/aidt-stages";
import { AidtPrototypeSourceImages } from "@repo/contracts/aidt-prototype-text";
import { PROTOTYPE_MAX_REF_IMAGES, PROTOTYPE_REF_IMAGE_MAX_BYTES, isImageMime, type DesignProject } from "@/lib/live-design-workbench";
import { loadAidtDesignHandoff, type AidtDesignHandoff, type AidtDesignHandoffInput } from "./aidt-design-handoff";
import { readAidtResearchMaterial } from "./aidt-research-materials";
import { readAidtStage, saveAidtStage } from "./live-aidt-stages";
import { readAidtPrototypeEntityDraft, readAidtPrototypeInputSelection, updateAidtPrototypeEntityDraft } from "./aidt-prototype-handoff";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";

export type SourceImageBinding = AidtPrototypeSourceImages["images"][number];
export function aidtDesignSourceImages(handoff: AidtDesignHandoff) {
  return [...new Map((handoff.sourceImages ?? []).map(image => [image.reference.sha256, image])).values()];
}
export function readAidtSourceImageBinding(draft: AidtUiStageDraft | null, handoff: AidtDesignHandoff) {
  const basis = handoff.textBasis;
  if (!draft || !basis) return null;
  try {
    const parsed = AidtPrototypeSourceImages.safeParse(JSON.parse(draft.fields.prototypeSourceImages ?? ""));
    return parsed.success && parsed.data.projectId === handoff.sourceImages?.[0]?.reference.projectId && parsed.data.designId === basis.designId && parsed.data.textStageRevision === basis.stageRevision
      && parsed.data.textVersion === basis.textVersion && parsed.data.textSha256 === basis.textSha256 ? parsed.data : null;
  } catch { return null; }
}
export function aidtNativeSourceImageMatches(binding: SourceImageBinding, project: DesignProject) {
  return project.refImages.some(image => image.id === binding.nativeImageId && image.name === binding.nativeName
    && image.size === binding.nativeSize && image.mime === binding.nativeMime);
}
export function aidtSourceImageMatches(binding: SourceImageBinding, source: NonNullable<AidtDesignHandoff["sourceImages"]>[number]) {
  const image = source.reference;
  return binding.sourceRunId === image.runId && binding.artifactId === image.artifactId && binding.versionId === image.versionId
    && binding.sha256 === image.sha256 && binding.stage4Revision === source.stage4Revision && binding.brainstormId === source.brainstormId;
}
/** Explicit import may reuse earlier verified IDs for the exact same complete source set. */
export function readRetainedAidtSourceImageBinding(draft: AidtUiStageDraft | null, handoff: AidtDesignHandoff, native: DesignProject) {
  if (!draft || !handoff.textBasis || native.id !== handoff.textBasis.designId) return null;
  try {
    const result = AidtPrototypeSourceImages.safeParse(JSON.parse(draft.fields.prototypeSourceImages ?? ""));
    const sources = aidtDesignSourceImages(handoff);
    if (!result.success || !sources.length || result.data.projectId !== handoff.sourceImages?.[0]?.reference.projectId
      || result.data.designId !== native.id || result.data.images.length !== sources.length || native.refImages.length !== sources.length
      || !sources.every(source => result.data.images.some(image => aidtSourceImageMatches(image, source) && aidtNativeSourceImageMatches(image, native)))) return null;
    return result.data;
  } catch { return null; }
}
export function assertAidtSourceImageCapacity(handoff: AidtDesignHandoff) {
  const images = aidtDesignSourceImages(handoff);
  const selectedIdeas = new Set(handoff.sourceImages?.map(item => item.ideaId) ?? []);
  if (!images.length || !selectedIdeas.size) throw new Error("冻结描述单图片缺失；请回第4步核对，未以文字替代图片带入。");
  if (images.length > PROTOTYPE_MAX_REF_IMAGES) throw new Error(`当前原生 Design 最多接收 ${PROTOTYPE_MAX_REF_IMAGES} 张不同参考图；本轮有 ${images.length} 张。请拆分原型，所有来源仍可查看。`);
  if (images.some(item => item.reference.bytes > PROTOTYPE_REF_IMAGE_MAX_BYTES || !isImageMime(item.reference.mime)))
    throw new Error("部分冻结图片超出原生 Design 支持的大小或格式，未改用其他图片。");
  return images;
}
/** Every pinned idea is a source, even when identical image bytes share a native reference. */
export function assertAidtSourceImageSelection(draft: AidtUiStageDraft | null, handoff: AidtDesignHandoff) {
  const selection = draft && readAidtPrototypeInputSelection(draft);
  const images = handoff.sourceImages ?? [];
  if (!selection?.brainstormId || selection.ideaIds.some(id => !images.some(image => image.ideaId === id))
    || images.some(image => !selection.ideaIds.includes(image.ideaId) || image.stage4Revision !== selection.revision || image.brainstormId !== selection.brainstormId))
    throw new Error("部分入选点子的冻结图片缺失或来源不一致，未以部分图片代替完整输入。");
}
/** Read source bytes through the existing authenticated immutable-material path. */
export async function readAidtSourceImageBytes(input: AidtDesignHandoffInput, source: NonNullable<AidtDesignHandoff["sourceImages"]>[number]) {
  if (input.signal?.aborted) throw new Error("AIDT_CONTEXT_CHANGED");
  return readAidtResearchMaterial(input, source.reference);
}
/** The native IDs are immutable upload acknowledgments, not filename guesses. */
export async function requireAidtNativeSourceImages(input: AidtDesignHandoffInput, handoff: AidtDesignHandoff, native: DesignProject) {
  if (!handoff.textBasis || native.id !== handoff.textBasis.designId) throw new Error("AIDT_CONTEXT_CHANGED");
  const sources = assertAidtSourceImageCapacity(handoff);
  const {stage} = await readAidtStage(input.projectId,5,input.sessionToken,input.signal);
  const draft = stage && readAidtPrototypeEntityDraft(stage.content.draft,native.id);
  assertAidtSourceImageSelection(draft ?? null, handoff);
  const binding = readAidtSourceImageBinding(draft,handoff);
  if (!binding || binding.projectId !== input.projectId || binding.images.length !== sources.length
    || !sources.every(source => binding.images.some(image => aidtSourceImageMatches(image,source) && aidtNativeSourceImageMatches(image,native))))
    throw new Error("请先明确载入并保存本轮冻结描述单图片，再制作原型。");
  for (const source of handoff.sourceImages ?? []) await readAidtSourceImageBytes(input,source);
  if (input.signal?.aborted) throw new Error("AIDT_CONTEXT_CHANGED");
}
/** Explicit user upload action stores its exact receipt with a normal stage CAS. */
export async function saveAidtSourceImageReceipts(input: AidtDesignHandoffInput, expected: AidtDesignHandoff, images: SourceImageBinding[]) {
  if (input.stageId !== 5 || input.roundRevision !== undefined) throw new Error("冻结历史仅供查看，不能写入当前图片来源回执。");
  const actual = await loadAidtDesignHandoff(input);
  if (!actual.textBasis || actual.offer.id !== expected.offer.id || actual.offer.text !== expected.offer.text
    || JSON.stringify(actual.sourceImages) !== JSON.stringify(expected.sourceImages)) throw new Error("AIDT_CONTEXT_CHANGED");
  const {stage} = await readAidtStage(input.projectId,5,input.sessionToken,input.signal);
  if (!stage) throw new Error("AIDT_CONTEXT_CHANGED");
  const value = AidtPrototypeSourceImages.parse({ schemaVersion:1,projectId:input.projectId,designId:actual.textBasis.designId,
    textStageRevision:actual.textBasis.stageRevision,textVersion:actual.textBasis.textVersion,textSha256:actual.textBasis.textSha256,images });
  const raw = JSON.stringify(value);
  if (raw.length > 6000) throw new Error("图片来源回执过长，未覆盖原保存内容。");
  const draft = updateAidtPrototypeEntityDraft(stage.content.draft,actual.textBasis.designId,old => ({...old,fields:{...old.fields,prototypeSourceImages:raw}}));
  if (draft === stage.content.draft) throw new Error("无法保存图片来源回执，未推进制作。");
  await saveAidtStage({projectId:input.projectId,stageId:5,operationId:crypto.randomUUID(),expectedRevision:stage.revision,
    sourceStageRevisions:stage.sourceStageRevisions,content:{...stage.content,draft:StageDraft.parse(draft)}},input.sessionToken,input.signal);
}
