import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=(path:string)=>readFileSync(`${root}${path}`,'utf8');

describe('live Board reflow and motion contracts',()=>{
  it('scopes platform zoom and reduced motion to the live Board marker',()=>{
    const page=read('app/studio/board/[boardId]/page.tsx');
    const css=read('app/globals.css');
    expect(page).toContain('data-live-board-page');
    expect(css).toContain('html[data-live-board-mounted="true"] body');
    expect(css).toContain('html:has([data-live-board-page]) body');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('transition-duration: 0.001ms !important');
    const parsed=postcss.parse(css);
    parsed.walkRules(rule=>expect(rule.selector.includes('data-live-board-mounted')&&rule.selector.includes(':has(')).toBe(false));
    const withoutHas=parsed.clone();
    withoutHas.walkAtRules('supports',rule=>{if(rule.params.includes('selector(:has('))rule.remove();});
    const unsupportedCss=withoutHas.toString();
    expect(unsupportedCss).not.toContain(':has(');
    expect(unsupportedCss).toMatch(/html\[data-live-board-mounted="true"\][^{]*\{\s*touch-action:\s*auto/);
    expect(unsupportedCss).toMatch(/html\[data-live-board-mounted="true"\] \*[^{]*\{[^}]*transition-duration:\s*0\.001ms/s);
  });

  it('bounds every live Board overlay and keeps dense controls inside local scrolling regions',()=>{
    const editor=read('components/whiteboard/collaborative-editor.tsx');
    const live=read('components/whiteboard/live-board.tsx');
    const discussion=read('components/whiteboard/discussion-panel.tsx');
    const workshop=read('components/whiteboard/workshop-panel.tsx');
    const transfer=read('components/whiteboard/board-transfer-controls.tsx');
    expect(live).toContain('data-testid="board-transfer-bar"');
    expect(live).toContain('overflow-x-auto');
    expect(editor).toContain('data-testid="board-document-header"');
    expect(editor).toContain('data-testid="board-object-inspector"');
    expect(editor).toContain('!auxiliaryPanelOpen');
    expect(editor).toContain('touch-auto');
    expect(editor).not.toContain('touch-none');
    expect(editor).toContain('max-h-[calc(100%-1.5rem)]');
    expect(discussion).toContain('w-full max-w-80 overflow-y-auto');
    expect(workshop).toContain('data-testid="board-workshop-panel"');
    expect(transfer).toContain('max-h-[calc(100dvh-2rem)]');
  });
});
