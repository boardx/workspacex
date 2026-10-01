import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ConnectorRelationship } from '@repo/whiteboard-core';
import { BoardConnectorToolbar } from '@/components/whiteboard/board-connector-toolbar';

const relationship: ConnectorRelationship = { from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type: 'curve', startStyle: 'none', endStyle: 'arrow', lineStyle: 'solid', label: 'canonical', semanticRelation: '' };
afterEach(cleanup);
function setup() {
  const onRelationshipChange = vi.fn(), props = { relationship, color: '#123456', disabled: false, onRelationshipChange, onColorChange: vi.fn() };
  const view = render(<BoardConnectorToolbar {...props} />);
  fireEvent.click(screen.getByTestId('board-connector-label-open'));
  return { ...view, props, onRelationshipChange, input: () => screen.getByTestId('board-connector-label') };
}
it('preserves a dirty multiline draft after a remote label change and refuses stale save with feedback', () => {
  const t = setup();
  fireEvent.change(t.input(), { target: { value: 'local draft\n中文' } });
  t.rerender(<BoardConnectorToolbar {...t.props} relationship={{ ...relationship, label: 'remote label' }} />);
  expect(t.input()).toHaveValue('local draft\n中文');
  fireEvent.click(screen.getByTestId('board-connector-label-save'));
  expect(t.onRelationshipChange).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeVisible();
  expect(t.input()).toHaveValue('local draft\n中文');
});
it('synchronizes an untouched label from the remote canonical value', () => {
  const t = setup();
  t.rerender(<BoardConnectorToolbar {...t.props} relationship={{ ...relationship, label: 'clean remote' }} />);
  expect(t.input()).toHaveValue('clean remote');
  expect(t.onRelationshipChange).not.toHaveBeenCalled();
});
it('does not reset an IME draft on a composing Escape', () => {
  const t = setup();
  fireEvent.compositionStart(t.input());
  fireEvent.change(t.input(), { target: { value: '尚未提交的中文候选' } });
  fireEvent.keyDown(t.input(), { key: 'Escape', isComposing: true });
  expect(t.input()).toHaveValue('尚未提交的中文候选');
  expect(t.onRelationshipChange).not.toHaveBeenCalled();
});
it('retains over-limit input and gives feedback without dispatching or truncating', () => {
  const t = setup(), long = '中'.repeat(1001);
  fireEvent.change(t.input(), { target: { value: long } });
  fireEvent.click(screen.getByTestId('board-connector-label-save'));
  expect(t.input()).toHaveValue(long);
  expect(t.onRelationshipChange).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeVisible();
});
it('disables an already open editor after access or lock changes without dispatching its draft', () => {
  const t = setup();
  fireEvent.change(t.input(), { target: { value: 'preserved' } });
  t.rerender(<BoardConnectorToolbar {...t.props} disabled />);
  expect(t.input()).toBeDisabled();
  fireEvent.click(screen.getByTestId('board-connector-label-save'));
  expect(t.onRelationshipChange).not.toHaveBeenCalled();
});
