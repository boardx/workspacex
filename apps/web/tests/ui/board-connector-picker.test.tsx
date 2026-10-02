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
 for(const type of ['straight','elbow','curve']){const button=screen.getByTestId(`board-connector-${type}`);expect(button).toBeDisabled();fireEvent.click(button);}
 expect(change).not.toHaveBeenCalled();
});
it('exposes the connector only through explicit integration gate while keeping Frame creation hidden',()=>{
 const change=vi.fn(),props={activeTool:'select' as const,creationTool:null,readOnly:false,onToolChange:vi.fn(),onCreationToolChange:change,onQuickCreate:vi.fn(),onBulkSticky:vi.fn(),onImageRequest:vi.fn()};
 const view=render(<BoardBottomDock {...props}/>);expect(screen.queryByTestId('board-add-connector')).toBeNull();
 view.rerender(<BoardBottomDock {...props} connectorEnabled/>);fireEvent.click(screen.getByTestId('board-add-connector'));expect(change).toHaveBeenCalledWith({kind:'connector',connectorType:'straight'});expect(screen.queryByTestId('board-add-frame')).toBeNull();
 view.rerender(<BoardBottomDock {...props} connectorEnabled creationTool={{kind:'connector',connectorType:'curve'}}/>);expect(screen.getByTestId('board-connector-curve')).toHaveAttribute('aria-pressed','true');expect(screen.getByTestId('board-add-connector').querySelector('[data-connector-preview="curve"]')).not.toBeNull();
});
