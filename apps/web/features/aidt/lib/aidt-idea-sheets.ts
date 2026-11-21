import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import { readAidtIdeaHmwSource } from "./aidt-idea-handoff";
import { aidtIdeaClassificationFor } from "./aidt-idea-classification";
import { aidtIdeaReadiness, aidtCompleteIdeas } from "./aidt-idea-readiness";
import { aidtResearchMaterialLabel, isAidtResearchImage, parseAidtResearchMaterial, researchMaterialKey } from "./aidt-research-material-reference";

export function aidtIdeaSheets(draft: AidtUiStageDraft, resolvedImages: Readonly<Record<string, string>>, ids?: readonly string[], projectId?: string) {
  const materialFor = (id: string) => { const reference = parseAidtResearchMaterial(draft.fields[researchMaterialKey("idea", id)]); return reference && (!projectId || reference.projectId === projectId) && isAidtResearchImage(reference) ? reference : null; };
  const hmw = readAidtIdeaHmwSource(draft);
  const selected = draft.ideas.filter(idea => !ids || ids.includes(idea.id));
  if (!aidtIdeaReadiness(selected, idea => !!materialFor(idea.id)).ready) throw new Error("AIDT_IDEA_SHEETS_INCOMPLETE");
  return aidtCompleteIdeas(selected, idea => !!materialFor(idea.id)).map((idea, index) => {
    const material = materialFor(idea.id);
    const imageSrc = material || idea.imageAttachment ? resolvedImages[idea.id] : idea.image;
    if (!imageSrc) throw new Error("AIDT_IDEA_IMAGE_UNAVAILABLE");
    const classification = aidtIdeaClassificationFor(draft, idea.id);
    return { id: idea.id, number: index + 1, title: idea.title, description: idea.description, imageSrc,
      hmw: hmw ? `HMW · 第 3 步 V${hmw.revision}：${hmw.text}` : null,
      proposed: draft.selectedIdeaId === idea.id,
      categories: `学生分类（${classification.confirmed ? "本组已确认" : "尚未确认"}）：${classification.labels.join("、") || "暂未分类"}`,
      categoryReason: `学生分类理由：${classification.reason.trim() || "尚未填写"}`,
      source: material ? `原始图片来源：${aidtResearchMaterialLabel(material)}（原件可读不代表研究已核实）` : idea.imageAttachment ? `图片来源：对话 ${idea.imageAttachment.threadId} · 附件 ${idea.imageAttachment.attachmentId} · ${idea.imageAttachment.name}（来源可读不等于研究已核实）` : `本页参考图：${idea.imageName || "未命名"}（未上传，不是小组已保存附件）` };
  });
}
export type AidtIdeaSheet = ReturnType<typeof aidtIdeaSheets>[number];

/** Same reviewed model as the in-app preview; textContent prevents HTML execution. */
export function buildAidtIdeaSheetsDocument(sheets: readonly AidtIdeaSheet[]): HTMLElement {
  const article = document.createElement("article");
  article.setAttribute("data-aidt-idea-sheets", "true");
  const heading = document.createElement("h2"); heading.textContent = "小组点子描述单 · 学生审阅稿"; article.append(heading);
  const note = document.createElement("p"); note.textContent = "根据学生审阅内容打印；不等于共享保存、投票结果或已验证方案。请在打印对话框中另存为 PDF。"; article.append(note);
  for (const [index, sheet] of sheets.entries()) {
    const section = document.createElement("section"); section.dataset.ideaId = sheet.id; section.style.breakInside = "avoid"; if (index) section.style.breakBefore = "page";
    const title = document.createElement("h3"); title.textContent = `${sheet.number}. ${sheet.title}${sheet.proposed ? "（拟选择，非投票）" : ""}`; section.append(title);
    const image = document.createElement("img"); image.src = sheet.imageSrc; image.alt = sheet.title; image.width = 480; image.style.maxWidth = "100%"; section.append(image);
    for (const text of [sheet.description, sheet.categories, sheet.categoryReason, sheet.hmw, sheet.source]) { if (!text) continue; const p = document.createElement("p"); p.textContent = text; section.append(p); }
    article.append(section);
  }
  return article;
}
