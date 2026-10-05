import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {STICKY_COLOR_PRESETS} from '@repo/whiteboard-core';
import {BoardBottomDock} from '@/components/whiteboard/board-bottom-dock';
afterEach(cleanup);
it.each([false,true])('keeps the sticky paper explicitly sized with an unchanged accessible hit target (selected=%s)',selected=>{
 const change=vi.fn();
 render(<BoardBottomDock activeTool="select" creationTool={selected?{kind:'sticky',variant:'square'}:null} readOnly={false} onToolChange={vi.fn()} onCreationToolChange={change} onQuickCreate={vi.fn()} onBulkSticky={vi.fn()} onImageRequest={vi.fn()}/>);
 const button=screen.getByTestId('board-add-sticky'),paper=button.querySelector('[data-sticky-variant="square"]');
 // A plain inline span ignores width/height and previously became a thin border.
 // Browser screenshots validate actual pixels; this guards the CSS sizing contract.
 expect(paper).toHaveClass('block','shrink-0','shadow-sm');
 expect(paper).toHaveStyle({backgroundColor:STICKY_COLOR_PRESETS.yellow,width:'24px',height:'24px'});
 expect(button).toHaveClass('shrink-0');
 expect(button).toHaveStyle({minHeight:'56px',minWidth:'56px'});
 expect(button).toHaveAccessibleName('便利贴，快捷键 N');
 expect(button).toHaveAttribute('aria-pressed',String(selected));
 fireEvent.click(button);expect(change).toHaveBeenCalledWith({kind:'sticky',variant:'square'});
 if(selected)expect(screen.getByTestId('board-tool-picker')).toBeVisible();
});

it('uses only the sticky paper as the native drag image, with labels available to assistive technology',()=>{
 render(<BoardBottomDock activeTool="select" creationTool={null} readOnly={false} onToolChange={vi.fn()} onCreationToolChange={vi.fn()} onQuickCreate={vi.fn()} onBulkSticky={vi.fn()} onImageRequest={vi.fn()}/>);
 const button=screen.getByTestId('board-add-sticky'), setDragImage=vi.fn();
 fireEvent.dragStart(button,{dataTransfer:{setData:vi.fn(),setDragImage,types:[]}});
 expect(setDragImage).toHaveBeenCalledWith(button.querySelector('[data-board-drag-preview]'),0,0);
 expect(button.querySelector('[data-board-drag-preview]')?.querySelector('.submenu')).toBeNull();
 expect(button.querySelector('.sr-only')).toHaveTextContent('便利贴');
 expect(screen.getByTestId('board-add-sticky-submenu')).toHaveClass('top-1/2');
});
