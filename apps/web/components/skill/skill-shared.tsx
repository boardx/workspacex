"use client";
import * as React from "react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SKILL_VIEWS, type SkillView } from "@/lib/mock/skill";

/** 屏标题 —— 统一节奏（对齐已确认原型的间距与字号档位）*/
export function ScreenHead({
  title, uc, children,
}: {
  title: string;
  uc: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        <Badge tone="outline">{uc}</Badge>
      </div>
      {children && <p className="text-12 text-muted-foreground">{children}</p>}
    </div>
  );
}

/**
 * 视角投影门 —— 某视角不该看到本屏时，渲染一个**可理解**的投影说明（不是空白）。
 *
 * ⚠ 这与七态里的 `denied` **不同**：那是「服务端拒绝了这次请求」的状态；
 *   这里是「切到这个预览视角时，界面本就不该出现」的投影。testid 用 `skill-role-denied`
 *   以免与保留名 `denied` 混淆。真实权限一律在服务端。
 */
export function RoleGate({
  view, allow, what, children,
}: {
  view: SkillView;
  allow: SkillView[];
  what: string;
  children: React.ReactNode;
}) {
  if (allow.includes(view)) return <>{children}</>;
  const label = SKILL_VIEWS.find((v) => v.id === view)?.label ?? view;
  return (
    <div
      data-testid="skill-role-denied"
      role="note"
      className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted py-12 text-center"
    >
      <Lock aria-hidden className="h-6 w-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-13 font-medium">当前视角「{label}」看不到{what}</p>
        <p className="text-11 text-muted-foreground">
          这是视角投影（预览手段），不是权限实现。真实权限在服务端 NestJS Guard + PostgreSQL RLS；
          接口对越权者不返回该资源的存在性。
        </p>
      </div>
    </div>
  );
}

/** 补画标记 —— 标注「原型确认缺失/新增设计，需补画原型」的元素，sign-off 重点。*/
export function NewScreenTag({ children }: { children: React.ReactNode }) {
  return (
    <Badge tone="warning" className="align-middle" data-testid="skill-newscreen-tag">
      补画 · {children}
    </Badge>
  );
}

/** 议程环节命名待裁决的行内标注（Q-3）。*/
export function SegmentNamingNote() {
  return (
    <span className="text-9 text-muted-foreground" data-testid="skill-segment-naming-note">
      「议程环节」命名待裁决 → Q-3
    </span>
  );
}
