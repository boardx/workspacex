import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BoardBottomDock} from '@/components/whiteboard/board-bottom-dock';
afterEach(cleanup);
function mount(readOnly=false){
 const onToolChange=vi.fn(),onCreationToolChange=vi.fn();
 render(<BoardBottomDock activeTool="select" creationTool={null} readOnly={readOnly} onToolChange={onToolChange} onCreationToolChange={onCreationToolChange} onQuickCreate={vi.fn()} onBulkSticky={vi.fn()} onImageRequest={vi.fn()}/>);
 return {onToolChange,onCreationToolChange};
}
it('marks every visible creation submenu without marking direct canvas commands',()=>{
 mount();
 for(const tool of ['sticky','text','shape','draw']){
  const indicator=screen.getByTestId(`board-add-${tool}`).querySelector('svg.submenu');
  expect(indicator,`${tool} has a real submenu indicator`).not.toBeNull();
  expect(indicator).toHaveAttribute('aria-hidden','true');
 }
 for(const id of ['board-tool-select','board-tool-hand','board-add-image'])expect(screen.getByTestId(id).querySelector('svg.submenu')).toBeNull();
 expect(screen.queryByTestId('board-add-frame')).toBeNull();
 expect(screen.queryByTestId('board-add-connector')).toBeNull();
});
it('keeps Draw activation single and unchanged while clearing object creation',()=>{
 const callbacks=mount();fireEvent.click(screen.getByTestId('board-add-draw'));
 expect(callbacks.onToolChange).toHaveBeenCalledTimes(1);expect(callbacks.onToolChange).toHaveBeenCalledWith('draw-pen');
 expect(callbacks.onCreationToolChange).toHaveBeenCalledTimes(1);expect(callbacks.onCreationToolChange).toHaveBeenCalledWith(null);
});
it('does not enable drawing mutations in readonly mode',()=>{
 const callbacks=mount(true),draw=screen.getByTestId('board-add-draw');
 expect(draw).toBeDisabled();fireEvent.click(draw);
 expect(callbacks.onToolChange).not.toHaveBeenCalled();expect(callbacks.onCreationToolChange).not.toHaveBeenCalled();
});
