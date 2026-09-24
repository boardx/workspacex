'use client';
import { useState } from 'react';
import type { ArrangeOperation, BulkFormat } from '@repo/whiteboard-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const alignActions: Array<{ operation: ArrangeOperation; label: string; testId: string }> = [
  { operation: 'align-left', label: '左对齐', testId: 'board-align-left' },
  { operation: 'align-center', label: '水平居中', testId: 'board-align-center' },
  { operation: 'align-right', label: '右对齐', testId: 'board-align-right' },
  { operation: 'align-top', label: '顶对齐', testId: 'board-align-top' },
  { operation: 'align-middle', label: '垂直居中', testId: 'board-align-middle' },
  { operation: 'align-bottom', label: '底对齐', testId: 'board-align-bottom' },
];
const distributeActions: Array<{ operation: ArrangeOperation; label: string; testId: string }> = [
  { operation: 'distribute-horizontal', label: '水平等距', testId: 'board-distribute-horizontal' },
  { operation: 'distribute-vertical', label: '垂直等距', testId: 'board-distribute-vertical' },
];
const fills = [
  { label: '黄色', value: 'hsl(var(--warning-tint))', className: 'bg-warning-tint' },
  { label: '绿色', value: 'hsl(var(--success-tint))', className: 'bg-success-tint' },
  { label: '紫色', value: 'hsl(var(--ai-tint))', className: 'bg-ai-tint' },
] as const;

export function BulkArrangeToolbar({ selectedCount, readOnlyReason, onArrange, onFormat }: {
  selectedCount: number;
  readOnlyReason?: string;
  onArrange: (operation: ArrangeOperation, label: string) => void;
  onFormat: (format: BulkFormat, label: string) => void;
}) {
  const [width, setWidth] = useState('180'), [height, setHeight] = useState('140');
  const outOfRange = selectedCount > 500;
  const alignDisabled = Boolean(readOnlyReason) || selectedCount < 2 || outOfRange;
  const distributeDisabled = Boolean(readOnlyReason) || selectedCount < 3 || outOfRange;
  const explanation = readOnlyReason ?? (outOfRange ? '一次最多批量处理 500 个对象。' : selectedCount < 2 ? '选择至少 2 个对象以批量排列或格式化。' : selectedCount < 3 ? '已可对齐和格式化；等距分布需要至少 3 个对象。' : `将对 ${selectedCount} 个对象执行一次原子批量操作。`);
  const descriptionId = 'board-bulk-controls-description';
  const buttonProps = { 'aria-describedby': descriptionId, title: explanation };
  return <div data-testid="board-bulk-toolbar" role="toolbar" aria-label="排列与格式" className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1">
    <span className="mr-1 text-11 font-medium">排列</span>
    {alignActions.map(action => <Button {...buttonProps} key={action.operation} size="xs" data-testid={action.testId} disabled={alignDisabled} onClick={() => onArrange(action.operation, action.label)}>{action.label}</Button>)}
    {distributeActions.map(action => <Button {...buttonProps} key={action.operation} size="xs" data-testid={action.testId} disabled={distributeDisabled} onClick={() => onArrange(action.operation, action.label)}>{action.label}</Button>)}
    <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
    <label className="flex items-center gap-1 text-11">宽<Input aria-label="统一宽度" className="h-7 w-20" type="number" min={1} max={100000} disabled={Boolean(readOnlyReason)} value={width} onChange={event => setWidth(event.target.value)} /></label>
    <Button {...buttonProps} size="xs" data-testid="board-format-width" disabled={alignDisabled} onClick={() => onFormat({ width: Number(width) }, '统一宽度')}>应用</Button>
    <label className="flex items-center gap-1 text-11">高<Input aria-label="统一高度" className="h-7 w-20" type="number" min={1} max={100000} disabled={Boolean(readOnlyReason)} value={height} onChange={event => setHeight(event.target.value)} /></label>
    <Button {...buttonProps} size="xs" data-testid="board-format-height" disabled={alignDisabled} onClick={() => onFormat({ height: Number(height) }, '统一高度')}>应用</Button>
    <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
    <span className="text-11">填充</span>
    {fills.map(fill => <Button {...buttonProps} key={fill.label} size="icon" variant="outline" aria-label={`统一填充为${fill.label}`} disabled={alignDisabled} onClick={() => onFormat({ fill: fill.value }, `统一${fill.label}填充`)}><span className={`h-4 w-4 rounded-full border border-border ${fill.className}`} aria-hidden="true" /></Button>)}
    {(['left', 'center', 'right'] as const).map(value => <Button {...buttonProps} key={value} size="xs" aria-label={`文字${value === 'left' ? '左对齐' : value === 'center' ? '居中' : '右对齐'}`} disabled={alignDisabled} onClick={() => onFormat({ textAlign: value }, '统一文字对齐')}>{value === 'left' ? '文左' : value === 'center' ? '文中' : '文右'}</Button>)}
    {[14, 18, 24].map(value => <Button {...buttonProps} key={value} size="xs" aria-label={`统一字号 ${value}`} disabled={alignDisabled} onClick={() => onFormat({ fontSize: value }, `统一字号 ${value}`)}>{value}</Button>)}
    <span id={descriptionId} className="ml-auto text-11 text-muted-foreground">{explanation}</span>
  </div>;
}
