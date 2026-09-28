import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BoardShareDialog} from '@/components/whiteboard/board-share-dialog';
import {BoardStickyPicker} from '@/components/whiteboard/board-sticky-picker';
import {BoardPresentationControls} from '@/components/whiteboard/board-presentation-controls';
import {BoardBottomDock} from '@/components/whiteboard/board-bottom-dock';
import {BoardViewportControls} from '@/components/whiteboard/board-viewport-controls';
import {STICKY_COLOR_PRESETS} from '@repo/whiteboard-core';
const api=vi.hoisted(()=>({members:vi.fn()}));
vi.mock('@/lib/live-whiteboard',()=>({listBoardMembers:api.members}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('copies the real board URL without granting permissions and only reports successful clipboard writes',async()=>{
 api.members.mockResolvedValue([{userId:'member',role:'viewer'}]);const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
 render(<BoardShareDialog boardId="board-real"/>);fireEvent.click(screen.getByTestId('board-share-open'));await waitFor(()=>expect(api.members).toHaveBeenCalledWith('board-real'));expect(await screen.findByText('已授权 1 位协作者（不含白板所有者）。')).toBeVisible();fireEvent.click(screen.getByTestId('board-share-copy'));await waitFor(()=>expect(copy).toHaveBeenCalledWith(`${window.location.origin}/studio/board/board-real`));expect(await screen.findByText('链接已复制')).toBeVisible();
});
it('does not claim successful sharing when member lookup and clipboard fail',async()=>{
 api.members.mockRejectedValue(new Error('denied'));Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockRejectedValue(new Error('blocked'))}});render(<BoardShareDialog boardId="denied"/>);fireEvent.click(screen.getByTestId('board-share-open'));await screen.findByRole('alert');fireEvent.click(screen.getByTestId('board-share-copy'));await screen.findByText('无法复制链接，请从浏览器地址栏复制。');expect(screen.queryByText('链接已复制')).toBeNull();
});
it('changes creation defaults only and retains accessible shapes and read-only protection',()=>{
 const color=vi.fn(),shape=vi.fn();const props={color:STICKY_COLOR_PRESETS.yellow,variant:'square' as const,readOnly:false,onColorChange:color,onVariantChange:shape,onBulk:vi.fn()};const view=render(<BoardStickyPicker {...props}/>);fireEvent.click(screen.getByTestId('board-sticky-default-blue'));expect(color).toHaveBeenCalledWith(STICKY_COLOR_PRESETS.blue);fireEvent.click(screen.getByTestId('board-sticky-circle'));expect(shape).toHaveBeenCalledWith('circle');view.rerender(<BoardStickyPicker {...props} readOnly/>);expect(screen.getByTestId('board-sticky-default-blue')).toBeDisabled();expect(screen.getByTestId('board-sticky-circle')).toBeDisabled();
});
it('selecting the sticky tool does not create an unintended note before canvas placement',()=>{
 const create=vi.fn(),change=vi.fn();render(<BoardBottomDock activeTool="select" creationTool={null} readOnly={false} onToolChange={vi.fn()} onCreationToolChange={change} onQuickCreate={create} onBulkSticky={vi.fn()} onImageRequest={vi.fn()}/>);fireEvent.click(screen.getByTestId('board-add-sticky'));expect(change).toHaveBeenCalledWith({kind:'sticky',variant:'square'});expect(create).not.toHaveBeenCalled();
});
it('keeps the FigJam tool order and exposes Frame as a first-class creation mode',()=>{
 const creation=vi.fn();
 render(<BoardBottomDock activeTool="select" creationTool={null} readOnly={false} onToolChange={vi.fn()} onCreationToolChange={creation} onQuickCreate={vi.fn()} onBulkSticky={vi.fn()} onImageRequest={vi.fn()}/>);
 const dock=screen.getByTestId('board-creation-dock');
 const ordered=['board-tool-select','board-tool-hand','board-add-sticky','board-add-text','board-add-shape','board-add-connector','board-add-draw','board-add-image','board-add-frame','board-add-more'];
 const positions=ordered.map(id=>Array.from(dock.querySelectorAll('button')).indexOf(screen.getByTestId(id)));
 expect(positions).toEqual([...positions].sort((a,b)=>a-b));
 fireEvent.click(screen.getByTestId('board-add-frame'));
 expect(creation).toHaveBeenLastCalledWith({kind:'panel',mode:'freeform'});
 expect(screen.queryByTestId('board-tool-picker')).toBeNull();
 expect(screen.getByTestId('board-add-frame')).toHaveAccessibleName('Frame，快捷键 F');
});
it('keeps zoom, fit, and a keyboard-accessible overview action together at the lower-right entry',()=>{
 const fit=vi.fn();
 render(<BoardViewportControls zoom={1} onZoom={vi.fn()} onFitBoard={fit} onFitSelection={vi.fn()} hasSelection={false}/>);
 const controls=screen.getByTestId('board-navigation-controls');
 expect(controls.parentElement).toHaveClass('bottom-5','right-4');
 expect(within(controls).getByTestId('board-zoom-fit-board')).toBeVisible();
 const overview=within(controls).getByTestId('board-overview-fit');
 expect(overview).toHaveAccessibleName('画布概览：显示全部内容');
 fireEvent.click(overview);
 expect(fit).toHaveBeenCalledOnce();
});
it('compact presentation controls still invoke real claim and leave callbacks',()=>{
 const claim=vi.fn(),leave=vi.fn();const state={presenterId:null,followers:[]} as never;const props={inline:true,state,actorId:'member',canPresent:true,onClaim:claim,onRelease:vi.fn(),onFollow:vi.fn(),onLeave:leave,onHandoff:vi.fn()};const view=render(<BoardPresentationControls {...props}/>);fireEvent.click(screen.getByRole('button',{name:'开始演示'}));expect(claim).toHaveBeenCalledOnce();view.rerender(<BoardPresentationControls {...props} state={{presenterId:'other',followers:['member']} as never}/>);fireEvent.click(screen.getByRole('button',{name:'自由浏览'}));expect(leave).toHaveBeenCalledOnce();
});
