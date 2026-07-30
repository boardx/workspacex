import { cn } from "@/lib/utils";

/**
 * 只读开关（预览用）—— 服务端安全，无事件处理器，纯视觉呈现开/关。
 * 真实的可交互 Toggle 需要客户端状态；本原型的报告模板开关、「禁止用于训练」开关只需
 * 让人类看到当前档位，故用只读呈现。用 role="img" + aria-label 表达状态，不冒充可交互控件。
 */
export function StaticSwitch({
  on,
  label,
  testId,
}: {
  on: boolean;
  label: string;
  testId?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`${label}：${on ? "开" : "关"}`}
      data-testid={testId}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-all duration-200",
        on ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full bg-card shadow-sm transition-all duration-200",
          on ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </span>
  );
}
