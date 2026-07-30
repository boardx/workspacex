import { describe, it, expect } from 'vitest';
import {
  extractMermaidBlocks,
  replaceMermaidBlock,
  wrapAsMermaidBlock,
} from '../src/markdown';

const DOC = `# Title

Some prose.

\`\`\`mermaid
flowchart TD
    A --> B
\`\`\`

More prose.

\`\`\`js
console.log('not mermaid');
\`\`\`

~~~mermaid
flowchart LR
    X --> Y
~~~
`;

describe('extractMermaidBlocks', () => {
  it('finds all mermaid blocks and ignores other fences', () => {
    const blocks = extractMermaidBlocks(DOC);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.code).toBe('flowchart TD\n    A --> B');
    expect(blocks[0]!.fence).toBe('```');
    expect(blocks[1]!.code).toBe('flowchart LR\n    X --> Y');
    expect(blocks[1]!.fence).toBe('~~~');
  });

  it('records offsets that exactly cover the block', () => {
    const blocks = extractMermaidBlocks(DOC);
    const b = blocks[0]!;
    expect(DOC.slice(b.start, b.end)).toBe('```mermaid\nflowchart TD\n    A --> B\n```');
  });

  it('handles an unclosed fence to end of document', () => {
    const md = 'text\n```mermaid\nflowchart TD\n  A --> B';
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.code).toBe('flowchart TD\n  A --> B');
    expect(blocks[0]!.end).toBe(md.length);
  });

  it('returns empty for documents without mermaid', () => {
    expect(extractMermaidBlocks('# nothing here')).toHaveLength(0);
  });
});

describe('replaceMermaidBlock', () => {
  it('replaces only the targeted block, preserving the rest', () => {
    const blocks = extractMermaidBlocks(DOC);
    const out = replaceMermaidBlock(DOC, blocks[0]!, 'flowchart TD\n    A --> C');
    expect(out).toContain('flowchart TD\n    A --> C');
    expect(out).not.toContain('A --> B');
    // second block untouched
    expect(out).toContain('X --> Y');
    expect(out).toContain('# Title');
    // still parseable, same count
    expect(extractMermaidBlocks(out)).toHaveLength(2);
  });

  it('preserves the fence style of the original block', () => {
    const blocks = extractMermaidBlocks(DOC);
    const out = replaceMermaidBlock(DOC, blocks[1]!, 'flowchart LR\n    X --> Z');
    expect(out).toContain('~~~mermaid\nflowchart LR\n    X --> Z\n~~~');
  });
});

describe('wrapAsMermaidBlock', () => {
  it('wraps code in a fence', () => {
    expect(wrapAsMermaidBlock('flowchart TD\n  A --> B')).toBe(
      '```mermaid\nflowchart TD\n  A --> B\n```',
    );
  });
});
