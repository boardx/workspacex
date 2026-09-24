import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
