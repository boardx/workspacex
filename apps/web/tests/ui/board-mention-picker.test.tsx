import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BoardMentionPicker } from '../../components/whiteboard/board-mention-picker';
const members = [{userId:'private-a',displayName:'张三'}, {userId:'private-b',displayName:'李四'}];
function Harness() { const [selected,onChange]=useState<string[]>([]); return <BoardMentionPicker members={members} selected={selected} onChange={onChange} disabled={false} loading={false} error={false} onRetry={()=>{}}/>; }
describe('board mention picker',()=>{
  it('selects by real name with keyboard, removes chips, never asks for IDs',()=>{
    render(<Harness/>);const input=screen.getByRole('combobox',{name:'提及成员'});
    fireEvent.focus(input);fireEvent.keyDown(input,{key:'ArrowDown'});fireEvent.keyDown(input,{key:'Enter'});
    expect(screen.getByRole('button',{name:'移除提及 李四'})).toBeTruthy();
    expect(screen.queryByText('private-b')).toBeNull();
    fireEvent.change(input,{target:{value:'张'}});fireEvent.keyDown(input,{key:'Enter'});
    expect(screen.getByRole('button',{name:'移除提及 张三'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'移除提及 李四'}));
    expect(screen.queryByRole('button',{name:'移除提及 李四'})).toBeNull();
    fireEvent.keyDown(input,{key:'Escape'});expect(input.getAttribute('aria-expanded')).toBe('false');
  });
  it('does not create an arbitrary mention from raw text or unmatched Enter',()=>{
    const change=vi.fn();render(<BoardMentionPicker members={members} selected={[]} onChange={change} disabled={false} loading={false} error={false} onRetry={()=>{}}/>);
    const input=screen.getByRole('combobox');fireEvent.change(input,{target:{value:'not-authorized-id'}});fireEvent.keyDown(input,{key:'Enter'});
    expect(change).not.toHaveBeenCalled();expect(screen.getByText('没有匹配的白板成员')).toBeTruthy();
  });
  it('fails closed on directory errors but exposes retry',()=>{
    const retry=vi.fn();render(<BoardMentionPicker members={members} selected={[]} onChange={vi.fn()} disabled={false} loading={false} error onRetry={retry}/>);
    expect((screen.getByRole('combobox') as HTMLInputElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'重试'}));expect(retry).toHaveBeenCalledOnce();
  });
  it('cannot choose members while read only',()=>{
    render(<BoardMentionPicker members={members} selected={[]} onChange={vi.fn()} disabled loading={false} error={false} onRetry={()=>{}}/>);
    expect((screen.getByRole('combobox') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('option')).toBeNull();
  });
});
