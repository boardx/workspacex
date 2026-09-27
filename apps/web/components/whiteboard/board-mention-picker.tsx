"use client";
import { useId, useState } from "react";
import { WHITEBOARD_COLLABORATION_LIMITS } from "@repo/contracts/whiteboard-collaboration";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoardMentionMember } from "./board-comments";

export function BoardMentionPicker({ members, selected, onChange, disabled, loading, error, onRetry }: {
  members: readonly BoardMentionMember[]; selected: readonly string[]; onChange: (ids: string[]) => void;
  disabled: boolean; loading: boolean; error: boolean; onRetry: () => void;
}) {
  const id = useId(), [query, setQuery] = useState(""), [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const options = members.filter(member => !selected.includes(member.userId) && member.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const index = Math.min(active, Math.max(0, options.length - 1));
  const choose = (member: BoardMentionMember) => {
    if (disabled || loading || error || selected.length >= WHITEBOARD_COLLABORATION_LIMITS.mentions) return;
    onChange([...selected, member.userId]); setQuery(""); setActive(0); setOpen(true);
  };
  return <div className="space-y-2" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label htmlFor={id} className="text-13 font-medium">提及成员 <span className="font-normal text-muted-foreground">（可选）</span></label>
    {selected.length > 0 && <div className="flex flex-wrap gap-1" aria-label="已提及成员">{selected.map(userId => <Button key={userId} type="button" disabled={disabled} className="max-w-full whitespace-normal" aria-label={`移除提及 ${members.find(member => member.userId === userId)?.displayName ?? '成员信息暂不可用'}`} onClick={() => onChange(selected.filter(value => value !== userId))}>@{members.find(member => member.userId === userId)?.displayName ?? '成员信息暂不可用'} ×</Button>)}</div>}
    <Input id={id} role="combobox" aria-label="提及成员" aria-autocomplete="list" aria-expanded={open && !disabled && !loading && !error} aria-controls={`${id}-options`} aria-activedescendant={open && !disabled && !loading && !error && options[index] ? `${id}-option-${index}` : undefined} disabled={disabled || loading || error || selected.length >= WHITEBOARD_COLLABORATION_LIMITS.mentions} value={query} placeholder="搜索白板成员姓名…" onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }} onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(value => options.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0); }
      if (event.key === 'Enter') { event.preventDefault(); if (open && options[index]) choose(options[index]); else setOpen(true); }
    }}/>
    {loading ? <p role="status" className="text-13 text-muted-foreground">正在加载白板成员…</p> : error ? <div role="alert" className="text-13">成员暂时无法加载。<Button type="button" disabled={disabled} onClick={onRetry}>重试</Button></div> : open && !disabled ? <div id={`${id}-options`} role="listbox" aria-label="可提及的白板成员" className="max-h-44 overflow-y-auto rounded-xl border border-border bg-popover p-1">{options.length ? options.map((member, optionIndex) => <Button key={member.userId} id={`${id}-option-${optionIndex}`} type="button" role="option" aria-selected={optionIndex === index} className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-13 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${optionIndex === index ? 'bg-accent text-accent-foreground' : 'text-popover-foreground hover:bg-accent'}`} onMouseDown={event => event.preventDefault()} onClick={() => choose(member)}>{member.displayName}</Button>) : <p className="p-2 text-13 text-muted-foreground">没有匹配的白板成员</p>}</div> : null}
  </div>;
}
