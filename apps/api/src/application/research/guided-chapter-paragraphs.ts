export interface QuestionParagraphBinding { questionId: string; paragraphIds: string[] }
export function chapterParagraphRegistry(body: string) {
  return body.split(/\n\s*\n/).map(text => text.trim()).filter(text => !text.startsWith("#") && text.length >= 30)
    .map((text, index) => ({ id: `P${index + 1}`, text }));
}
