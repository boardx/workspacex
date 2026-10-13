import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
type Node = { type: string; value?: string; url?: string; depth?: number; children?: Node[] };
/** Visible canonical facts, independent of Markdown's formatting delimiters. No content generation. */
export function reportFileContentRequirements(markdown: string) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Node;
  const paragraphs: string[] = [], urls = new Set<string>();
  let title: string | null = null;
  const text = (node: Node): string => node.type === 'footnoteReference' ? '' : node.value ?? node.children?.map(text).join('') ?? '';
  function visit(node: Node) {
    if (title === null && node.type === 'heading' && node.depth === 1) title = text(node);
    if (node.url && /^https?:\/\//i.test(node.url)) urls.add(node.url);
    if (['paragraph', 'tableCell', 'code'].includes(node.type)) paragraphs.push(text(node));
    if (node.type === 'definition') { if (node.url) urls.add(node.url); return; }
    node.children?.forEach(visit);
  }
  visit(tree);
  return { title, paragraphs, urls: [...urls] };
}
