"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  MOCK_DIGITAL_EXPERTS,
} from "@/lib/mock/digital-expert-personas";

export interface ExpertPickerItem {
  readonly expertId: string;
  readonly displayName: string;
  readonly role: string;
  readonly category: string;
  readonly bio: string;
}

export function ExpertPickerDialog({
  open,
  selectedExpertIds,
  onOpenChange,
  onConfirm,
  experts = MOCK_DIGITAL_EXPERTS,
  description = "从专家目录中多选，本次选择会追加到当前访谈。",
}: {
  open: boolean;
  selectedExpertIds: readonly string[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (expertIds: readonly string[]) => void;
  experts?: readonly ExpertPickerItem[];
  description?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string | null>(null);
  const [pendingIds, setPendingIds] = React.useState<readonly string[]>(selectedExpertIds);

  React.useEffect(() => {
    if (!open) return;
    setPendingIds(selectedExpertIds);
    setQuery("");
    setCategory(null);
  }, [open, selectedExpertIds]);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const filteredExperts = experts.filter((expert) => {
    if (category && expert.category !== category) return false;
    if (!normalizedQuery) return true;
    return `${expert.displayName} ${expert.role} ${expert.bio}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
  });
  const categories = Array.from(new Set(experts.map((expert) => expert.category)));
  const selected = new Set(pendingIds);
  const original = new Set(selectedExpertIds);
  const addedCount = pendingIds.filter((expertId) => !original.has(expertId)).length;

  function toggle(expertId: string, checked: boolean) {
    if (original.has(expertId)) return;
    setPendingIds((current) => checked
      ? Array.from(new Set([...current, expertId]))
      : current.filter((id) => id !== expertId));
  }

  function close() {
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background-foreground/35 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="itv-expert-picker-dialog"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(88vh,760px)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <header className="flex items-start justify-between gap-4 border-b border-border p-6">
            <div>
              <Dialog.Title className="text-2xl font-semibold">添加访谈专家</Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-muted-foreground">{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label="关闭专家选择"><X className="size-4" aria-hidden /></Button></Dialog.Close>
          </header>

          <div className="grid min-h-0 flex-1 grid-rows-[auto_auto_1fr] gap-4 p-6">
            <label className="relative block">
              <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="搜索访谈专家" data-testid="itv-expert-picker-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索专家姓名、角色或简介" className="h-10 pl-9" />
            </label>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <CategoryButton active={category === null} onClick={() => setCategory(null)}>全部</CategoryButton>
              {categories.map((value) => <CategoryButton key={value} active={category === value} onClick={() => setCategory(value)}>{value}</CategoryButton>)}
            </div>
            <div className="min-h-0 overflow-y-auto rounded-xl border border-border">
              {filteredExperts.length ? <ul className="divide-y divide-border">{filteredExperts.map((expert) => {
                const isOriginal = original.has(expert.expertId);
                const isChecked = selected.has(expert.expertId);
                return <li key={expert.expertId} className="flex items-start gap-3 p-4 transition-colors hover:bg-muted/40">
                  <Checkbox
                    aria-label={`选择专家 ${expert.displayName}`}
                    checked={isChecked}
                    disabled={isOriginal}
                    onChange={(event) => toggle(expert.expertId, event.currentTarget.checked)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><strong>{expert.displayName}</strong><span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{expert.category}</span>{isOriginal && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" aria-hidden />已添加</span>}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{expert.role}</p>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{expert.bio}</p>
                  </div>
                </li>;
              })}</ul> : <div className="grid min-h-48 place-items-center p-8 text-sm text-muted-foreground">没有匹配的专家，请调整搜索或类型。</div>}
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
            <p className="text-xs text-muted-foreground">当前 {selectedExpertIds.length} 位，本次新增 {addedCount} 位</p>
            <div className="flex gap-3"><Button type="button" variant="outline" onClick={close}>取消</Button><Button data-testid="itv-expert-picker-confirm" type="button" variant="primary" disabled={!addedCount} onClick={() => { onConfirm(pendingIds); close(); }}>添加所选专家</Button></div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CategoryButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={active ? "shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground" : "shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"}>{children}</button>;
}
