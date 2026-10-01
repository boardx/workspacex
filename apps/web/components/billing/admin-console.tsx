"use client";
import * as React from "react";
import { useState } from "react";
import { CircleCheck, ShieldAlert, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationItem,
  PaginationList,
  PaginationNext,
  PaginationPrevious,
  PaginationStatus,
} from "@/components/ui/pagination";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorState, LoadingSkeleton } from "@/components/work-stack/states";
import { cn } from "@/lib/utils";
import {
  LEDGER_SOURCE_LABEL,
  LEDGER_TYPE_LABEL,
  ORG_LEDGER,
  PERSONAL_LEDGER,
  formatCredits,
  type CreditLedgerEntry,
  type PreviewState,
} from "@/lib/mock/billing";

const PAGE_SIZE = 5;

const SUBJECT_OPTIONS: readonly SelectOption[] = [
  { value: "user-u1208", label: "用户 林晚秋（u1208）" },
  { value: "org-o301", label: "组织 深潜工作室（o301）" },
  { value: "org-o417", label: "组织 晨雾设计（o417）" },
];

interface WalletView {
  balance: number;
  totalAcquired: number;
  purchaseTotal: number;
  bonusGrantTotal: number;
}

function subjectWallet(subject: string): WalletView {
  if (subject.startsWith("org-")) {
    return { balance: 86400, totalAcquired: 152000, purchaseTotal: 132000, bonusGrantTotal: 20000 };
  }
  return { balance: 12480, totalAcquired: 25600, purchaseTotal: 21800, bonusGrantTotal: 3800 };
}

function subjectLedger(subject: string): CreditLedgerEntry[] {
  return subject.startsWith("org-") ? [...ORG_LEDGER] : [...PERSONAL_LEDGER];
}

function LedgerTypeBadge({ entry }: { entry: CreditLedgerEntry }) {
  const tone = entry.type === "grant" ? "ai" : entry.type === "bonus" ? "success" : "neutral";
  return <Badge tone={tone}>{LEDGER_TYPE_LABEL[entry.type]}</Badge>;
}

function LedgerTable({
  entries,
  state,
  page,
  onPageChange,
}: {
  entries: readonly CreditLedgerEntry[];
  state: PreviewState;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const visible = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (state === "loading") return <LoadingSkeleton testid="billing-ledger-loading" />;
  if (state === "depfail")
    return (
      <ErrorState
        testid="billing-ledger-error"
        message="流水查询失败，请稍后重试。"
        onRetry={() => undefined}
      />
    );

  return (
    <div data-testid="billing-ledger-table" className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow variant="header">
            <TableHead>类型</TableHead>
            <TableHead className="text-right">数量</TableHead>
            <TableHead className="text-right">余额</TableHead>
            <TableHead>来源 / 说明</TableHead>
            <TableHead>操作者</TableHead>
            <TableHead>时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 ? (
            <TableEmpty colSpan={6} data-testid="billing-ledger-empty">
              该主体还没有额度流水。人工发放或充值到账后会出现在这里。
            </TableEmpty>
          ) : (
            visible.map((entry) => (
              <TableRow key={entry.id} variant="body" data-testid={`billing-ledger-row-${entry.id}`}>
                <TableCell>
                  <LedgerTypeBadge entry={entry} />
                </TableCell>
                <TableCell className="text-right font-mono font-medium text-success">
                  +{formatCredits(entry.credits)}
                </TableCell>
                <TableCell className="text-right font-mono">{formatCredits(entry.balanceAfter)}</TableCell>
                <TableCell className="max-w-64">
                  <p className="truncate">{entry.reason ? `${entry.description}：${entry.reason}` : entry.description}</p>
                  <p className="text-11 text-muted-foreground">{LEDGER_SOURCE_LABEL[entry.source]}</p>
                </TableCell>
                <TableCell className="text-muted-foreground">{entry.operatorName ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-11 text-muted-foreground">
                  {entry.createdAt}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination aria-label="流水列表分页">
        <PaginationStatus>
          共 {entries.length} 条 · 第 {page} / {pageCount} 页
        </PaginationStatus>
        <PaginationList>
          <PaginationPrevious disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
          {Array.from({ length: pageCount }).map((_, i) => (
            <PaginationItem key={i} active={page === i + 1} onClick={() => onPageChange(i + 1)}>
              {i + 1}
            </PaginationItem>
          ))}
          <PaginationNext disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} />
        </PaginationList>
      </Pagination>
    </div>
  );
}

/**
 * 计费管理端（平台管理员视角，需求 04 R8）：
 * 钱包余额卡（余额 / 累计获得）→ 流水列表（类型 / 数量 / 时间 / 来源，分页）→
 * 手工发额度表单（主体 + 额度 + 原因必填，硬规则 ⑦ 二次确认）。
 */
export function AdminConsole({
  state,
  grantStage,
}: {
  state: PreviewState;
  grantStage: "idle" | "confirm" | "done";
}) {
  const [page, setPage] = useState(1);
  const [subject, setSubject] = useState<string>("user-u1208");
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>(() => subjectLedger("user-u1208"));
  const [wallet, setWallet] = useState<WalletView>(() => subjectWallet("user-u1208"));

  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [formErrors, setFormErrors] = useState<{ amount?: string; reason?: string }>({});
  const [grantOpen, setGrantOpen] = useState(grantStage === "confirm");
  const [saved, setSaved] = useState(grantStage === "done");

  // 七态投影（硬规则 ⑤）：invalid 展示表单校验失败；success 展示发放完成回显
  React.useEffect(() => {
    setGrantOpen(grantStage === "confirm");
    if (grantStage === "confirm") {
      // 预览用：确认弹窗预填 mock 值，供签核看清影响范围（生产值来自表单）
      setAmount("500");
      setReason("回调延迟补偿（订单 WSX20260928113042）");
    }
  }, [grantStage]);

  React.useEffect(() => {
    if (state === "invalid") {
      setAmount("");
      setReason("");
      setFormErrors({ amount: "额度必须是大于 0 的整数", reason: "发放原因必填，会写入流水留痕" });
    }
    if (state === "success") setSaved(true);
  }, [state]);

  const handleSubjectChange = (value: string) => {
    setSubject(value);
    setPage(1);
    setLedger(subjectLedger(value));
    setWallet(subjectWallet(value));
  };

  const validate = (): boolean => {
    const errors: { amount?: string; reason?: string } = {};
    const parsed = Number(amount);
    if (amount.trim() === "" || Number.isNaN(parsed) || parsed <= 0) {
      errors.amount = "额度必须是大于 0 的整数";
    }
    if (reason.trim() === "") {
      errors.reason = "发放原因必填，会写入流水留痕";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    setGrantOpen(true);
  };

  const handleConfirm = () => {
    const parsed = Number(amount);
    const newEntry: CreditLedgerEntry = {
      id: `led-new-${Date.now()}`,
      type: "grant",
      direction: "in",
      credits: parsed,
      balanceAfter: wallet.balance + parsed,
      source: "admin_manual_grant",
      description: "人工发放",
      operatorName: "平台管理员 · 你",
      reason: reason.trim(),
      createdAt: "2026-10-01 14:05:00",
    };
    setLedger((prev) => [newEntry, ...prev]);
    setWallet((prev) => ({
      balance: prev.balance + parsed,
      totalAcquired: prev.totalAcquired + parsed,
      purchaseTotal: prev.purchaseTotal,
      bonusGrantTotal: prev.bonusGrantTotal + parsed,
    }));
    setGrantOpen(false);
    setSaved(true);
    setAmount("");
    setReason("");
    setFormErrors({});
  };

  if (state === "denied") {
    return (
      <div data-testid="billing-admin-denied" className="flex h-full flex-col items-center justify-center gap-3 py-24">
        <ShieldAlert aria-hidden className="h-6 w-6 text-warning" />
        <p className="text-14 font-medium text-background-foreground">计费管理仅平台管理员可用</p>
        <p className="text-12 text-muted-foreground">当前角色没有权限查看此页。</p>
      </div>
    );
  }

  const ledgerEntries = state === "empty" ? [] : ledger;

  return (
    <div data-testid="billing-admin-host" className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-20 font-bold tracking-tight text-background-foreground">计费管理</h1>
          <p className="mt-1 text-12 text-muted-foreground">查询任意用户 / 组织钱包与流水，手工发放额度。</p>
        </div>
        <div className="w-56">
          <Select
            data-testid="billing-admin-subject"
            options={SUBJECT_OPTIONS}
            value={subject}
            onValueChange={handleSubjectChange}
            placeholder="选择用户或组织"
          />
        </div>
      </div>

      {/* 钱包余额卡（余额 + 累计获得） */}
      {state === "loading" ? (
        <LoadingSkeleton testid="billing-wallet-loading" />
      ) : (
        <div
          data-testid="billing-wallet-card"
          className="grid grid-cols-2 gap-3 rounded-card border border-border bg-card p-4 md:grid-cols-4"
        >
          <div>
            <p className="flex items-center gap-1.5 text-11 text-muted-foreground">
              <Wallet aria-hidden className="h-3.5 w-3.5" />
              当前余额
            </p>
            <p data-testid="billing-wallet-balance" className="mt-1 font-mono text-24 font-semibold text-background-foreground">
              {formatCredits(wallet.balance)}
            </p>
          </div>
          <div>
            <p className="text-11 text-muted-foreground">累计获得</p>
            <p className="mt-1 font-mono text-24 font-semibold text-background-foreground">
              {formatCredits(wallet.totalAcquired)}
            </p>
          </div>
          <div>
            <p className="text-11 text-muted-foreground">其中充值</p>
            <p className="mt-1 font-mono text-16 font-medium text-background-foreground">
              {formatCredits(wallet.purchaseTotal)}
            </p>
          </div>
          <div>
            <p className="text-11 text-muted-foreground">赠送 / 发放</p>
            <p className="mt-1 font-mono text-16 font-medium text-background-foreground">
              {formatCredits(wallet.bonusGrantTotal)}
            </p>
          </div>
        </div>
      )}

      {/* 流水列表（类型 / 数量 / 时间 / 来源，分页） */}
      <div className="rounded-card border border-border bg-card p-4">
        <h2 className="mb-3 text-14 font-medium text-background-foreground">流水明细</h2>
        <LedgerTable entries={ledgerEntries} state={state} page={page} onPageChange={setPage} />
      </div>

      {/* 手工发额度（平台管理员专属；原因必填 + 二次确认，硬规则 ⑦ / 需求 04 R7.1） */}
      <div className="rounded-card border border-border bg-card p-4">
        <h2 className="text-14 font-medium text-background-foreground">手工发放额度</h2>
        <p className="mt-1 text-12 text-muted-foreground">
          每次发放写入一笔「发放」流水，记录操作者与原因；仅平台管理员可操作。
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-[220px,1fr,1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="billing-grant-subject">目标主体</Label>
            <Select
              data-testid="billing-grant-subject"
              options={SUBJECT_OPTIONS}
              value={subject}
              onValueChange={handleSubjectChange}
              placeholder="选择用户或组织"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="billing-grant-amount">额度数量</Label>
            <Input
              id="billing-grant-amount"
              data-testid="billing-grant-amount"
              type="number"
              min={1}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="如 500"
              aria-describedby={formErrors.amount ? "billing-grant-amount-error" : undefined}
              className={cn(formErrors.amount && "border-destructive")}
            />
            {formErrors.amount && (
              <p id="billing-grant-amount-error" role="alert" data-testid="billing-err-grant-amount" className="text-11 text-destructive">
                {formErrors.amount}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="billing-grant-reason">发放原因（必填）</Label>
            <Input
              id="billing-grant-reason"
              data-testid="billing-grant-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="如：回调延迟补偿（订单号）"
              aria-describedby={formErrors.reason ? "billing-grant-reason-error" : undefined}
              className={cn(formErrors.reason && "border-destructive")}
            />
            {formErrors.reason && (
              <p id="billing-grant-reason-error" role="alert" data-testid="billing-err-grant-reason" className="text-11 text-destructive">
                {formErrors.reason}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" data-testid="billing-grant-submit" onClick={handleSubmit}>
            确认发放
          </Button>
          {saved && (
            <p data-testid="billing-grant-saved" className="flex items-center gap-1.5 text-13 text-success">
              <CircleCheck aria-hidden className="h-4 w-4" />
              已发放，流水与余额已更新
            </p>
          )}
        </div>
      </div>

      {/* 二次确认（硬规则 ⑦：资金动作显式确认 + 影响范围说明） */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent data-testid="billing-grant-confirm-dialog" closeTestId="billing-grant-confirm-close" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认发放额度？</DialogTitle>
            <DialogDescription>发放立即入账并写入流水，无法撤销。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 rounded-card border border-border bg-muted p-3 text-12">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">主体</span>
              <span className="text-background-foreground">{SUBJECT_OPTIONS.find((o) => o.value === subject)?.label}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">发放额度</span>
              <span className="font-mono font-medium text-background-foreground">+{amount || "—"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">原因</span>
              <span className="text-right text-background-foreground">{reason || "—"}</span>
            </div>
            <div className="flex justify-between gap-2 border-t border-border pt-2">
              <span className="text-muted-foreground">发放后余额</span>
              <span className="font-mono font-medium text-background-foreground">
                {formatCredits(wallet.balance + (Number(amount) || 0))}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" data-testid="billing-grant-confirm-cancel" onClick={() => setGrantOpen(false)}>
              再想想
            </Button>
            <Button variant="primary" data-testid="billing-grant-confirm-ok" onClick={handleConfirm}>
              确认发放
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
