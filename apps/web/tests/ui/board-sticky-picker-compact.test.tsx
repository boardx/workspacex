import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BoardBottomDock} from '@/components/whiteboard/board-bottom-dock';
afterEach(cleanup);
it('bounds the sticky popup independently of dock width without shrinking touch controls or losing bulk creation',()=>{
 const bulk=vi.fn();
 render(<BoardBottomDock activeTool="select" creationTool={{kind:'sticky',variant:'square'}} readOnly={false} onToolChange={vi.fn()} onCreationToolChange={vi.fn()} onQuickCreate={vi.fn()} onBulkSticky={bulk} onImageRequest={vi.fn()}/>);
 fireEvent.click(screen.getByTestId('board-add-sticky'));
 expect(screen.getByTestId('board-tool-picker').style.width).toBe('420px');
 expect(screen.getByTestId('board-tool-picker').style.maxWidth).toBe('calc(100vw - 2rem)');
 const picker=screen.getByTestId('board-sticky-picker');expect(picker).toHaveClass('w-full','min-w-0','space-y-1');
 const colors=picker.querySelectorAll('[data-testid^="board-sticky-default-"]');expect(colors).toHaveLength(8);
 for(const color of colors)expect(color).toHaveClass('h-11','w-11');
 for(const variant of ['square','rectangle','circle'])expect(screen.getByTestId(`board-sticky-${variant}`)).toHaveClass('min-h-11','min-w-11');
 fireEvent.click(screen.getByTestId('board-bulk-open'));expect(bulk).toHaveBeenCalledOnce();
});
