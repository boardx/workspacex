"use client";
import * as React from "react";
import { ChevronDown, Info, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const ROLE_OPTIONS = [
  { value: "facilitator", label: "引导师（可下发、可编辑）" },
  { value: "group-lead", label: "组长（可协作、可指派）" },
  { value: "member", label: "组员（可参与、可产出）" },
  { value: "observer", label: "观察者（只读）" },
];

/** 超长列表：验证 select.tsx 在选项很多时视口内可滚动截断，不撑爆页面。 */
const LONG_OPTIONS = Array.from({ length: 40 }, (_, i) => ({
  value: `member-${i + 1}`,
  label: `成员 ${i + 1} 号 · 候选`,
}));

/**
 * 弹层原语展示区 —— 契约束 interaction-primitives（F01/F02）签核①材料的取景组件。
 * 四个原语（Dialog / Dropdown / Select / Tooltip）各自可交互，带 data-testid 供
 * 截图脚本锚定，也供后续 verification 定位。
 */
export function PrimitivesGallery() {
  const [role, setRole] = React.useState<string>("member");
  const [longPick, setLongPick] = React.useState<string>("member-1");

  return (
    <div className="flex flex-col gap-6" data-testid="section-primitives">
      <div className="flex flex-col gap-1">
        <h2 className="text-16 font-semibold">弹层原语（Dialog / Dropdown / Select / Tooltip）</h2>
        <p className="text-12 text-muted-foreground">
          契约束 <code className="font-mono text-11">interaction-primitives</code> · F01/F02。
          四个都基于已在库的 <code className="font-mono text-11">@radix-ui/*</code> + 现有 token，
          键盘可达（↑↓ / type-ahead / Enter / Esc）与焦点环由 Radix + 全局约定保证。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* ── Dialog ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" data-testid="primitive-dialog">
          <h3 className="text-13 font-semibold">Dialog（对话框）</h3>
          <p className="text-11 text-muted-foreground">点遮罩 / Esc 关闭等价；打开后焦点自动落入。</p>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm" data-testid="primitive-dialog-trigger">
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
                删除项目…
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="primitive-dialog-content">
              <DialogHeader>
                <DialogTitle>删除「欧洲储能进入策略」？</DialogTitle>
                <DialogDescription>
                  这是危险动作，会一并移除该项目下 3 个工作面、12 条证据与 47 条对话记录。
                  删除后可在 30 天内从回收站恢复，逾期不可逆。
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border border-border-subtle bg-panel p-3 text-11 text-muted-foreground">
                影响范围：2 名组员正在此项目内协作，删除后他们将立即失去访问。
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" size="sm" data-testid="primitive-dialog-cancel">取消</Button>
                </DialogClose>
                <Button variant="destructive" size="sm" data-testid="primitive-dialog-confirm">确认删除</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* ── Dropdown Menu ─────────────────────────────────── */}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" data-testid="primitive-dropdown">
          <h3 className="text-13 font-semibold">Dropdown Menu（操作菜单）</h3>
          <p className="text-11 text-muted-foreground">↑↓ 移动高亮，Enter 触发；危险项以 danger 色区分。</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="primitive-dropdown-trigger">
                <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
                更多操作
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" data-testid="primitive-dropdown-content">
              <DropdownMenuLabel>项目操作</DropdownMenuLabel>
              <DropdownMenuItem data-testid="primitive-dropdown-rename">
                <Pencil aria-hidden className="h-3.5 w-3.5" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="primitive-dropdown-share">
                <Share2 aria-hidden className="h-3.5 w-3.5" />
                生成分享链接
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive data-[highlighted]:text-destructive" data-testid="primitive-dropdown-delete">
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
                删除项目
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ── Select ────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" data-testid="primitive-select">
          <h3 className="text-13 font-semibold">Select（单选下拉）</h3>
          <p className="text-11 text-muted-foreground">
            当前值：<span className="font-medium text-background-foreground">{role}</span>。
            展开后 ↑↓ 导航、首字母跳转、Enter 选中。
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="primitive-select-role">分配角色</Label>
            <Select
              options={ROLE_OPTIONS}
              value={role}
              onValueChange={setRole}
              placeholder="选择角色…"
              data-testid="primitive-select-trigger"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="primitive-select-disabled">禁用态</Label>
            <Select
              options={ROLE_OPTIONS}
              value="member"
              placeholder="不可操作"
              disabled
              data-testid="primitive-select-disabled"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="primitive-select-long">超长列表（{LONG_OPTIONS.length} 项，视口内可滚动截断）</Label>
            <Select
              options={LONG_OPTIONS}
              value={longPick}
              onValueChange={setLongPick}
              data-testid="primitive-select-long-trigger"
            />
          </div>
        </div>

        {/* ── Tooltip ───────────────────────────────────────── */}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" data-testid="primitive-tooltip">
          <h3 className="text-13 font-semibold">Tooltip（提示气泡）</h3>
          <p className="text-11 text-muted-foreground">hover 与键盘 focus 双触发等价。</p>
          <TooltipProvider delayDuration={100}>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" data-testid="primitive-tooltip-trigger">
                    <Info aria-hidden className="h-3.5 w-3.5" />
                    什么是 Context Pack？
                  </Button>
                </TooltipTrigger>
                <TooltipContent data-testid="primitive-tooltip-content">
                  本次对话 AI 实际读取的证据集合：命中 12 条、筛除 4 条（可查看丢弃原因）。
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" disabled data-testid="primitive-tooltip-disabled-trigger">
                    <Info aria-hidden className="h-3.5 w-3.5" />
                    禁用态
                  </Button>
                </TooltipTrigger>
                <TooltipContent data-testid="primitive-tooltip-disabled-content">
                  禁用态按钮本身不接收 hover/focus 事件，气泡不会出现。
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}

const MOTION_TIERS = [
  { key: "fast", cls: "duration-fast", ms: "150ms", use: "微反馈：hover 背景、图标着色" },
  { key: "base", cls: "duration-base", ms: "200ms", use: "默认档：按钮、卡片、面板切换" },
  { key: "slow", cls: "duration-slow", ms: "300ms", use: "编排：面板展开、消息到达序列" },
];

/**
 * 动效 token 档位对照 —— 契约束 motion-microinteraction（F03/F04）签核①材料。
 * 同一张卡片套三档 transition-duration，hover 时观感差异 + 时长标注。不设计新动效，
 * 只把「已有档位」并排陈列供人类确认取值。
 */
export function MotionTokenGallery() {
  return (
    <div className="flex flex-col gap-4" data-testid="section-motion">
      <div className="flex flex-col gap-1">
        <h2 className="text-16 font-semibold">动效 token 档位对照</h2>
        <p className="text-12 text-muted-foreground">
          契约束 <code className="font-mono text-11">motion-microinteraction</code> · F03/F04。
          三档时长应用在同一组卡片上——把鼠标移上任意一张感受快慢差异。取值是唯一事实源，
          不在组件里散写。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="motion-tier-grid">
        {MOTION_TIERS.map((tier) => (
          <div
            key={tier.key}
            data-testid={`motion-tier-${tier.key}`}
            className={`group cursor-pointer rounded-lg border border-border bg-card p-4 transition-all ${tier.cls} ease-base hover:-translate-y-1 hover:border-primary hover:shadow-md`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-13 font-semibold">{tier.key}</span>
              <code className="font-mono text-12 text-primary">{tier.ms}</code>
            </div>
            <p className="mt-2 text-11 text-muted-foreground">{tier.use}</p>
            <div className={`mt-3 h-1.5 w-full origin-left rounded-full bg-muted transition-transform ${tier.cls} ease-base group-hover:scale-x-100`}>
              <div className="h-full w-1/3 rounded-full bg-primary" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
