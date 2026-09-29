import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { AvatarIllustration } from "./avatar-illustration";
import { isAvatarKey } from "@/lib/interview-expert-avatar";

/** 头像用缩写而非图片——原型里全是缩写（AV/SC/LG/林/周），且避免外部图片依赖 */
const avatarVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full font-medium transition-colors duration-200",
  {
    variants: {
      tone: {
        human: "bg-accent text-accent-foreground",
        ai: "bg-ai-tint text-ai-tint-foreground",
        muted: "bg-muted text-muted-foreground",
      },
      size: {
        xs: "h-5 w-5 text-9",
        sm: "h-6 w-6 text-10",
        md: "h-7 w-7 text-11",
        lg: "h-9 w-9 text-13",
      },
    },
    defaultVariants: { tone: "human", size: "md" },
  },
);

export function Avatar({
  initials, className, tone, size, src, avatarKey, ...props
}: {
  initials: string;
  /**
   * #638 delta，迭代 2：真实头像图片（Blob URL 或绝对地址）。可选——不传时保持原有
   * 行为（缩写占位），向后兼容全部既有调用点。
   */
  src?: string | null;
  /**
   * AG04（契约束 agent-role `AgentAvatar`）：插画头像 key（`AvatarKey`，如 `person-7`/
   * `robot`）。`null`/未知 key/不传 → 回退首字母（A3，ui.md「头像：avatar=null 或 key
   * 不在集合 → 首字母，不报错」）。优先级高于 `src`——两者同传时插画胜出，因为两者
   * 都是「已知头像来源」，插画是 Phase 20 起唯一在写的那一种（PROP §4.3）。
   */
  avatarKey?: string | null;
} & React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof avatarVariants>) {
  const illustration = typeof avatarKey === "string" && isAvatarKey(avatarKey) ? avatarKey : null;
  return (
    <span
      role={illustration ? "img" : undefined}
      aria-hidden={illustration ? undefined : true}
      aria-label={illustration ? `头像 ${illustration}` : undefined}
      data-avatar-key={illustration ?? undefined}
      className={cn(avatarVariants({ tone, size }), "overflow-hidden p-0", className)}
      {...props}
    >
      {illustration ? (
        <AvatarIllustration avatarKey={illustration} />
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Blob URL，不是可优化的静态资源
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}
