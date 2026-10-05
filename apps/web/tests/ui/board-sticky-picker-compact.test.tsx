import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BoardBottomDock} from '@/components/whiteboard/board-bottom-dock';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it.each([1440,390])('bounds the sticky popup independently of dock width without shrinking touch controls or losing bulk creation at %i pixels',width=>{
 vi.stubGlobal('innerWidth',width);
 const bulk=vi.fn();
 render(<BoardBottomDock activeTool="select" creationTool={{kind:'sticky',variant:'square'}} readOnly={false} onToolChange={vi.fn()} onCreationToolChange={vi.fn()} onQuickCreate={vi.fn()} onBulkSticky={bulk} onImageRequest={vi.fn()}/>);
 fireEvent.click(screen.getByTestId('board-add-sticky'));
 expect(screen.getByTestId('board-tool-picker').style.width).toBe(`${Math.min(420,width-32)}px`);
 const popup=screen.getByTestId('board-tool-picker');
 expect(parseFloat(popup.style.width)).toBeLessThanOrEqual(window.innerWidth-32);
 expect(parseFloat(popup.style.left)).toBeGreaterThanOrEqual(16);
 expect(parseFloat(popup.style.left)+parseFloat(popup.style.width)).toBeLessThanOrEqual(window.innerWidth-16);
 fireEvent(window,new Event('resize'));
 expect(popup.style.position).toBe('fixed');
 expect(parseFloat(popup.style.bottom)).toBeGreaterThanOrEqual(8);
 const picker=screen.getByTestId('board-sticky-picker');expect(picker).toHaveClass('w-full','min-w-0','space-y-1');
 const colors=picker.querySelectorAll('[data-testid^="board-sticky-default-"]');expect(colors).toHaveLength(8);
 for(const color of colors)expect(color).toHaveClass('h-11','w-11');
 for(const variant of ['square','rectangle','circle'])expect(screen.getByTestId(`board-sticky-${variant}`)).toHaveClass('min-h-11','min-w-11');
 fireEvent.click(screen.getByTestId('board-bulk-open'));expect(bulk).toHaveBeenCalledOnce();
});

it.each([1440,390])('uses a compact connector menu anchored to its actual trigger at %i',width=>{
 vi.stubGlobal('innerWidth',width);vi.stubGlobal('innerHeight',900);
 render(<BoardBottomDock connectorEnabled activeTool="select" creationTool={{kind:'connector',connectorType:'straight'}} readOnly={false} onToolChange={vi.fn()} onCreationToolChange={vi.fn()} onQuickCreate={vi.fn()} onBulkSticky={vi.fn()} onImageRequest={vi.fn()}/>);
 const trigger=screen.getByTestId('board-add-connector'),dock=screen.getByTestId('board-creation-dock');
 vi.spyOn(trigger,'getBoundingClientRect').mockReturnValue({left:width-76,right:width-20,top:825,bottom:881,width:56,height:56,x:width-76,y:825,toJSON:()=>({})});
 vi.spyOn(dock,'getBoundingClientRect').mockReturnValue({left:16,right:width-16,top:820,bottom:888,width:width-32,height:68,x:16,y:820,toJSON:()=>({})});
 fireEvent.click(trigger);
 const popup=screen.getByTestId('board-tool-picker');
 expect(popup).toHaveStyle({position:'fixed',width:'208px',left:`${width-224}px`,bottom:'88px'});
 expect(popup.querySelectorAll('[data-testid^="board-connector-"]')).toHaveLength(5);
});
