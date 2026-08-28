/**
 * Extraction and in-place replacement of convertible fenced code blocks in
 * Markdown (```mermaid and ```persona). Pure string functions — no mermaid
 * or DOM dependency.
 */

export interface MermaidBlock {
  /** Block source without the fence lines. */
  code: string;
  /** Fence language: 'mermaid' or 'persona'. */
  lang: string;
  /** Offset of the opening fence line start in the original document. */
  start: number;
  /** Offset just past the closing fence line (or end of document if unclosed). */
  end: number;
  /** The fence marker used, e.g. "```" or "~~~~". */
  fence: string;
  /** Leading indentation of the opening fence line. */
  indent: string;
  /**
   * Whether a matching closing fence line was found before end of document.
   * `false` means the document ended (or streaming has not yet produced) the
   * closing fence line — the block's `code` is a partial, in-progress capture,
   * not the author's final content. Callers that validate/parse `code` as a
   * finished document (e.g. the canvas/persona template grammar) must treat
   * `closed: false` as "still arriving", not "malformed" — see issue #2298.
   */
  closed: boolean;
}

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*(mermaid|persona|canvas|usecase)[ \t]*$/;

/** Find all mermaid fenced blocks in a markdown document. */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  const lines = markdown.split('\n');
  let offset = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = FENCE_RE.exec(line);
    if (!m) {
      offset += line.length + 1;
      i++;
      continue;
    }
    const indent = m[1]!;
    const fence = m[2]!;
    const lang = m[3]!;
    const start = offset;
    const closeRe = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`);
    const codeLines: string[] = [];
    let j = i + 1;
    let innerOffset = offset + line.length + 1;
    let end = markdown.length;
    let closed = false;
    while (j < lines.length) {
      const candidate = lines[j]!;
      if (closeRe.test(candidate)) {
        end = innerOffset + candidate.length;
        closed = true;
        break;
      }
      codeLines.push(candidate);
      innerOffset += candidate.length + 1;
      j++;
    }
    if (!closed) end = markdown.length;
    blocks.push({ code: codeLines.join('\n'), lang, start, end, fence, indent, closed });
    offset = end + 1;
    i = j + 1;
  }
  return blocks;
}

/**
 * Replace the content of one mermaid block (by index) with new mermaid code,
 * preserving the fence style and surrounding document. Returns the new markdown.
 */
export function replaceMermaidBlock(
  markdown: string,
  block: MermaidBlock,
  newCode: string,
): string {
  const lang = block.lang ?? 'mermaid';
  const replacement = `${block.indent}${block.fence}${lang}\n${newCode.replace(/\n$/, '')}\n${block.indent}${block.fence}`;
  return markdown.slice(0, block.start) + replacement + markdown.slice(block.end);
}

/** Wrap code in a fresh fenced block (for documents with no existing block). */
export function wrapAsMermaidBlock(code: string, lang = 'mermaid'): string {
  return '```' + lang + '\n' + code.replace(/\n$/, '') + '\n```';
}
