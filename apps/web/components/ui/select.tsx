"use client";
import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Select —— 契约束 interaction-primitives（F01/F02）弹层原语之一。
 *
 * ⚠ 本仓依赖里没有 `@radix-ui/react-select`，为不引入新依赖，这里用已在库的
 *   `@radix-ui/react-dropdown-menu` 的 RadioGroup 组合出「单选下拉」。Radix 的
 *   菜单键盘模型（↑↓ 移动高亮、type-ahead 首字母跳转、Enter 选中、Esc 关闭、
 *   focus 环）与原生 select 的键盘可达性等价，足以作为签核①的键盘导航态材料。
 *   若后续需要严格的 combobox 语义（可搜索/多选），再作为独立 design-delta 评估。
 */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps {
  readonly options: readonly SelectOption[];
  readonly value?: string;
  readonly onValueChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly "data-testid"?: string;
}

export function Select({
  options,
  value,
  onValueChange,
  placeholder = "请选择…",
  disabled,
  className,
  "data-testid": testId,
}: SelectProps) {
  const selected = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        data-testid={testId}
        className={cn(
          "inline-flex h-8 min-w-[12rem] items-center justify-between gap-2 rounded-md border border-border bg-card px-3 text-13 text-card-foreground",
          "transition-all duration-base hover:bg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-foreground",
          "data-[state=open]:ring-2 data-[state=open]:ring-ring",
          className,
        )}
      >
        <span className={cn(!selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-[12rem] overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className="pl-7">
              {o.label}
              {o.value === value ? (
                <Check aria-hidden className="ml-auto h-3.5 w-3.5 text-primary" />
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
