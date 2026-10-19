import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
type Node = { type: string; value?: string; identifier?: string; url?: string; depth?: number; position?: { start: { offset?: number }; end: { offset?: number } }; children?: Node[] };
/** Visible canonical facts, independent of Markdown's formatting delimiters. No content generation. */
export function reportFileContentRequirements(markdown: string) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Node;
  const paragraphs: string[] = [], urls = new Set<string>();
  let title: string | null = null;
  const footnoteIds = new Set<string>();
  const text = (node: Node): string => node.type === 'footnoteReference' ? ''
    : node.type === 'html' && /^<br\s*\/?>$/i.test(node.value ?? '') ? '\n'
    : node.value ?? node.children?.map(text).join('') ?? '';
  function visit(node: Node) {
    if (node.type === 'footnoteReference' && node.identifier) footnoteIds.add(node.identifier);
    if (title === null && node.type === 'heading' && node.depth === 1) title = text(node);
    if (node.url && /^https?:\/\//i.test(node.url)) urls.add(node.url);
    if (['paragraph', 'tableCell', 'code'].includes(node.type)) paragraphs.push(text(node));
    if (node.type === 'definition') { if (node.url) urls.add(node.url); return; }
    node.children?.forEach(visit);
  }
  visit(tree);
  return { title, paragraphs, urls: [...urls], footnoteIds: [...footnoteIds], visibleText: text(tree) };
}

/** Remove only canonical footnote presentation from extracted text, retaining all
 * other raw formatting and literal code. PDF line wraps may split a marker. */
export function reportFileExtractedText(markdown: string, footnoteIds: readonly string[]): string {
  const allowed = new Set(footnoteIds);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Node;
  const edits: { start: number; end: number; text: string }[] = [];
  function visit(node: Node) {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      if (node.type === 'footnoteReference' && allowed.has(node.identifier ?? '')) {
        edits.push({ start, end, text: '' }); return;
      }
      if (node.type === 'text') {
        const raw = markdown.slice(start, end);
        const text = raw.replace(/\[\^([^\]]+)\]/g, (marker, id: string) =>
          allowed.has(id.replace(/\s/g, '')) ? '' : marker);
        if (text !== raw) edits.push({ start, end, text });
      }
    }
    node.children?.forEach(visit);
  }
  visit(tree);
  let result = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
