"use client";

import * as React from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatPopoverSlot } from "@/components/chat/chat-popover-coordinator";

/**
 * 2026-09-02 —— composer 第二行的**三层结构**（人类点名要 Apple 式"隐藏细节"的简化）。
 *
 * ## 这里在解决什么真实缺陷
 *
 * 2026-08-29 重设计稿把第二行做成一排带文字的胶囊：「材料」「选择能力（自动匹配）▾」
 * 「技能 +」「任务模式」「语音」「系统默认麦克风」+ 发送，七个控件外加一行常驻灰字
 * 「请先输入任务目标」。问题不在样式，在信息层级：
 *   · **默认值被当成内容展示**——「自动匹配」「系统默认麦克风」都是"什么也没改"，却各占一颗。
 *   · **选项与状态混在一起**——「技能 +」既是入口又是状态，用户分不清点了会发生什么。
 *   · **每颗视觉重量相同**——发送键的主色反而不突出。
 *
 * ## 三层
 *
 * - **第 0 层，常驻**：左「+」（本文件 `ComposerMenu`），右麦克风图标 + 发送。全部纯图标。
 * - **第 1 层，偏离默认才露出的状态 chip**（`ComposerStateChip`）：选了具体能力 →
 *   「名字 ✕」；开了任务模式 → 「先计划」；挂了技能 → 每个挂载 chip；有材料 → 计数。
 *   默认态什么都不显示——**默认值不是信息**。
 * - **第 2 层，收进「+」菜单**（`ComposerMenuItem`）：添加材料 / 选择能力 / 挂载技能 /
 *   任务模式（勾选项）。
 *
 * ## 与既有浮层的接力关系
 *
 * 菜单本身占互斥组的一个槽位（`chat-composer-menu`）。菜单项被点击时**先关菜单、再把
 * 控制权交给对应的既有浮层**（能力列表 `chat-capability-picker`、技能候选 `chat-skill-mount`，
 * 都是同一互斥组的既有槽位；附件面板是 portal 到 body 的 Modal）——不是把三个浮层套进
 * 菜单里做二级嵌套：嵌套的 `absolute` 浮层会互相盖住，也让 outside-click 判定变成三层
 * 容器的交集。同一时刻只开一个浮层，是 `chat-popover-coordinator.tsx` 早就定下的纪律。
 *
 * ## 锚点（e2e 依赖，逐字不动）
 *
 * `chat-task-workbench-composer-menu`（「+」）、`chat-task-workbench-composer-menu-panel`
 * （菜单面板）。菜单项各自的 testid 由调用方传入（附件 `chat-attachment-input`、能力
 * `chat-task-workbench-capability-picker`、技能 `chat-skill-mount`、任务模式
 * `chat-task-workbench-composer-task-mode`）——它们此前就是这四个控件的锚点，只是从
 * 常驻一行搬进了菜单；对应 spec 改成"先点「+」再断言"，见 `e2e/chat-task-workbench-fixture.ts`
 * 的 `openComposerMenu`。
 */

const ComposerMenuCloseContext = React.createContext<(() => void) | null>(null);

export function ComposerMenu({
  disabled,
  children,
}: {
  disabled: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useChatPopoverSlot("chat-composer-menu");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), [setOpen]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  return (
    <div ref={containerRef} className="relative flex items-center">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="rounded-pill"
        data-testid="chat-task-workbench-composer-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={open ? "收起菜单" : "添加材料、选择能力、挂载技能或切换任务模式"}
        title={open ? "收起" : "材料 / 能力 / 技能 / 任务模式"}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Apple 式「+」：展开时旋转 45° 变成「×」，同一个按钮承担开与关，不另画一颗。 */}
        <Plus aria-hidden className={`h-4 w-4 transition-transform duration-fast ${open ? "rotate-45" : ""}`} />
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label="任务输入的更多操作"
          data-testid="chat-task-workbench-composer-menu-panel"
          className="absolute bottom-full left-0 z-20 mb-1.5 flex w-64 flex-col gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          <ComposerMenuCloseContext.Provider value={close}>{children}</ComposerMenuCloseContext.Provider>
        </div>
      ) : null}
    </div>
  );
}

export interface ComposerMenuItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect" | "children"> {
  readonly icon: React.ReactNode;
  readonly label: string;
  /** 右侧的次要信息：当前值（如已选能力名）或不可用的原因。 */
  readonly hint?: React.ReactNode;
  /** 传了就是勾选项（`menuitemcheckbox`），不传是普通菜单项。 */
  readonly checked?: boolean;
  /** 点击后先执行它，再关菜单——它可以把控制权交给另一个浮层（见文件头注）。 */
  readonly onSelect: () => void;
}

export const ComposerMenuItem = React.forwardRef<HTMLButtonElement, ComposerMenuItemProps>(
  function ComposerMenuItem({ icon, label, hint, checked, onSelect, className, ...rest }, ref) {
    const close = React.useContext(ComposerMenuCloseContext);
    const isCheckbox = checked !== undefined;
    return (
      <button
        ref={ref}
        type="button"
        role={isCheckbox ? "menuitemcheckbox" : "menuitem"}
        aria-checked={isCheckbox ? checked : undefined}
        className={[
          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-12 text-card-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-disabled-foreground disabled:hover:bg-transparent",
          className ?? "",
        ].join(" ")}
        onClick={() => {
          onSelect();
          close?.();
        }}
        {...rest}
      >
        <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint !== undefined && hint !== null ? (
          <span className="min-w-0 max-w-28 truncate text-10 text-muted-foreground">{hint}</span>
        ) : null}
        {isCheckbox ? (
          <Check aria-hidden className={`h-3.5 w-3.5 shrink-0 ${checked ? "text-primary" : "invisible"}`} />
        ) : null}
      </button>
    );
  },
);

/**
 * 第 1 层：只在偏离默认时出现的状态 chip。主体可点（回到对应的浮层/开关），
 * 右侧可选一颗 ✕（清除 / 回到默认）。点击区 ≥ 24×24（TW-A11Y-2）。
 */
export function ComposerStateChip({
  icon,
  label,
  title,
  onClick,
  onClear,
  clearLabel,
  disabled,
  testId,
  clearTestId,
  ...rest
}: {
  readonly icon?: React.ReactNode;
  readonly label: string;
  readonly title?: string;
  readonly onClick?: () => void;
  readonly onClear?: () => void;
  readonly clearLabel?: string;
  readonly disabled?: boolean;
  readonly testId: string;
  readonly clearTestId?: string;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "onClick" | "title">): JSX.Element {
  return (
    <span
      className="inline-flex h-6 items-center rounded-pill border border-primary/40 bg-primary/10 text-primary"
      data-testid={testId}
      {...rest}
    >
      <button
        type="button"
        className={[
          "flex h-full items-center gap-1 rounded-pill pl-2 text-10 transition-colors duration-fast hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-disabled-foreground",
          onClear ? "pr-1" : "pr-2",
        ].join(" ")}
        title={title}
        disabled={disabled}
        onClick={onClick}
      >
        {icon ? <span aria-hidden className="flex h-3 w-3 items-center justify-center">{icon}</span> : null}
        <span className="max-w-32 truncate">{label}</span>
      </button>
      {onClear ? (
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-pill transition-colors duration-fast hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-disabled-foreground"
          aria-label={clearLabel ?? "清除"}
          title={clearLabel ?? "清除"}
          disabled={disabled}
          data-testid={clearTestId}
          onClick={onClear}
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
