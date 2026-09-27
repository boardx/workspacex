import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {STICKY_COLOR_PRESETS} from '@repo/whiteboard-core';
import {BoardBottomDock} from '@/components/whiteboard/board-bottom-dock';
afterEach(cleanup);
it.each([false,true])('keeps the sticky paper explicitly sized with an unchanged accessible hit target (selected=%s)',selected=>{
 const change=vi.fn();
 render(<BoardBottomDock activeTool="select" creationTool={selected?{kind:'sticky',variant:'square'}:null} readOnly={false} onToolChange={vi.fn()} onCreationToolChange={change} onQuickCreate={vi.fn()} onBulkSticky={vi.fn()} onImageRequest={vi.fn()}/>);
 const button=screen.getByTestId('board-add-sticky'),paper=button.querySelector('[aria-hidden="true"]');
 // A plain inline span ignores width/height and previously became a thin border.
 // Browser screenshots validate actual pixels; this guards the CSS sizing contract.
 expect(paper).toHaveClass('block','h-6','w-6','shrink-0','shadow-sm');
 expect(paper).toHaveStyle({backgroundColor:STICKY_COLOR_PRESETS.yellow});
 expect(button).toHaveClass('min-h-12','min-w-12','shrink-0');
 expect(button).toHaveAccessibleName('便利贴，快捷键 N');
 expect(button).toHaveAttribute('aria-pressed',String(selected));
 fireEvent.click(button);expect(change).toHaveBeenCalledWith({kind:'sticky',variant:'square'});
 if(selected)expect(screen.getByTestId('board-tool-picker')).toBeVisible();
});
