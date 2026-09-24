'use client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function StickyBatchPreview({ lines, onCancel, onConfirm }: { lines: string[]; onCancel: () => void; onConfirm: () => void }) {
  return <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>批量创建便利贴</DialogTitle>
        <DialogDescription>{lines.length} 张便利贴 · 每行 5 张 · 按粘贴顺序从左到右排列。确认后将开启新的本地撤销历史。</DialogDescription>
      </DialogHeader>
      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto rounded-container bg-panel-alt p-3 sm:grid-cols-3" aria-label="便利贴预览">
        {lines.slice(0, 12).map((line, index) => <div key={`${index}-${line}`} className="min-h-20 rounded-control border border-warning bg-warning-tint p-3 text-13 text-warning-tint-foreground shadow-sm"><span className="mr-1 text-11 opacity-60">{index + 1}</span>{line}</div>)}
        {lines.length > 12 && <p className="col-span-full text-center text-12 text-muted-foreground">另有 {lines.length - 12} 张，将使用同一排列规则</p>}
      </div>
      <DialogFooter><Button variant="secondary" onClick={onCancel}>取消</Button><Button onClick={onConfirm}>创建 {lines.length} 张便利贴</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
