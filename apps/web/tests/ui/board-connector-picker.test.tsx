import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BoardConnectorPicker} from '@/components/whiteboard/board-connector-picker';
import {BoardBottomDock} from '@/components/whiteboard/board-bottom-dock';
afterEach(cleanup);
it('previews three genuinely distinct paths and changes only the selected controlled type',()=>{
 const change=vi.fn();render(<BoardConnectorPicker value="elbow" disabled={false} onChange={change}/>);
 const paths=['straight','elbow','curve'].map(type=>{
  const button=screen.getByTestId(`board-connector-${type}`);
  expect(button).toHaveAttribute('aria-pressed',String(type==='elbow'));
  expect(button).toHaveAccessibleName();
  return button.querySelector('path[data-connector-path]')?.getAttribute('d');
 });
 expect(paths.every(Boolean)).toBe(true);expect(new Set(paths).size).toBe(3);
 expect(paths[0]).toContain('L');expect(paths[1]?.match(/L/g)).toHaveLength(3);expect(paths[2]).toContain('C');
 fireEvent.click(screen.getByTestId('board-connector-curve'));expect(change).toHaveBeenCalledWith('curve');
});
it('does not offer mutation for readonly or locked users',()=>{
 const change=vi.fn();render(<BoardConnectorPicker value="straight" disabled onChange={change}/>);
 for(const type of ['straight','elbow','curve','free']){const button=screen.getByTestId(`board-connector-${type}`);expect(button).toBeDisabled();fireEvent.click(button);}
 expect(change).not.toHaveBeenCalled();
});
it('exposes the connector only through explicit integration gate while preserving the current hidden Frame creation entry',()=>{
 const change=vi.fn(),props={activeTool:'select' as const,creationTool:null,readOnly:false,onToolChange:vi.fn(),onCreationToolChange:change,onQuickCreate:vi.fn(),onBulkSticky:vi.fn(),onImageRequest:vi.fn()};
 const view=render(<BoardBottomDock {...props}/>);expect(screen.queryAllByTestId('board-add-connector')).toHaveLength(0);
 view.rerender(<BoardBottomDock {...props} connectorEnabled/>);expect(screen.getAllByTestId('board-add-connector')).toHaveLength(1);fireEvent.click(screen.getByTestId('board-add-connector'));expect(change).toHaveBeenCalledWith({kind:'connector',connectorType:'straight'});expect(screen.queryByTestId('board-add-frame')).toBeNull();
 view.rerender(<BoardBottomDock {...props} connectorEnabled creationTool={{kind:'connector',connectorType:'curve'}}/>);expect(screen.getByTestId('board-connector-curve')).toHaveAttribute('aria-pressed','true');expect(screen.getByTestId('board-add-connector').querySelector('[data-connector-preview="curve"]')).not.toBeNull();
});
it('keeps one gated connector after image without replacing the other dock entries',()=>{
 const props={activeTool:'select' as const,creationTool:null,readOnly:false,onToolChange:vi.fn(),onCreationToolChange:vi.fn(),onQuickCreate:vi.fn(),onBulkSticky:vi.fn(),onImageRequest:vi.fn()};
 const view=render(<BoardBottomDock {...props} connectorEnabled/>);
 const ids=['board-add-sticky','board-add-text','board-add-shape','board-add-draw','board-add-image','board-add-connector','board-add-more'];
 for(const id of ids)expect(screen.getAllByTestId(id)).toHaveLength(1);
 const entries=ids.map(id=>screen.getByTestId(id));
 for(let index=1;index<entries.length;index++)expect(entries[index-1]!.compareDocumentPosition(entries[index]!)&Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
 const connector=screen.getByTestId('board-add-connector');
 expect(connector).toHaveAttribute('aria-expanded','false');
 const chevron=screen.getByTestId('board-add-connector-submenu');
 expect(chevron).toHaveClass('lucide-chevron-up');
 expect(chevron).toHaveAttribute('data-state','closed');
 expect(chevron).not.toHaveClass('rotate-180');
 view.rerender(<BoardBottomDock {...props} connectorEnabled={false}/>);
 expect(screen.queryAllByTestId('board-add-connector')).toHaveLength(0);
 for(const id of ids.filter(id=>id!=='board-add-connector'))expect(screen.getAllByTestId(id)).toHaveLength(1);
});

it('offers a distinct accessible free-arrow tool and preserves the controlled creation mode',()=>{
 const change=vi.fn();render(<BoardConnectorPicker value="straight" disabled={false} onChange={change}/>);
 const free=screen.getByRole('button',{name:'自由箭头'});
 expect(free).toHaveAttribute('title','自由箭头');
 expect(free.querySelector('svg.lucide-waypoints')).not.toBeNull();
 fireEvent.click(free);expect(change).toHaveBeenCalledWith('free');
});
