"use client";
import * as React from "react";
import Link from "next/link";
import { Radio, Pause, Play, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * 底部环境态条 —— 实测原型底部常驻的一条状态带：
 *   「会议转录中 28:14 · 周宁：…」「Ava 正在重排致命假设优先级 2/4」「Ava ＋3 · skill：假设拆解」
 *
 * 它承载「AI 四种在场方式」里的**后台 worker**那一种：不打断当前工作，
 * 但让长时任务始终可见可控（暂停 / 查看进度）。
 */
export function AmbientBar() {
  // 暂停是**真状态**：AI 停在这里不会绕过你继续（与任务屏 R3 「需批准」同一条纪律）
  const [paused, setPaused] = React.useState(false);
  return (
    <footer
      data-testid="shell-ambient"
      aria-label="后台任务与会议状态"
      className="flex h-9 shrink-0 items-center gap-3 border-t border-border bg-panel px-3 text-11"
    >
      <span data-testid="ambient-recording" className="inline-flex items-center gap-1.5 text-destructive">
        <Radio aria-hidden className="h-3 w-3" />
        会议转录中
        <span className="font-mono text-muted-foreground">28:14</span>
      </span>

      <span className="truncate text-muted-foreground">周宁：客户董事会给的窗口是十八个月…</span>

      <div className="ml-auto flex items-center gap-2">
        <Badge tone={paused ? "neutral" : "ai"} data-testid="ambient-agent-run">
          Ava {paused ? "已暂停" : "正在重排致命假设优先级"} · 2/4
        </Badge>
        <Button asChild size="xs" variant="ghost">
          {/* 长任务的执行细节在任务屏的「运行中心」，不占这一条 */}
          <Link href="/tasks" data-testid="ambient-view-progress">
            查看进度 <ChevronRight aria-hidden className="h-3 w-3" />
          </Link>
        </Button>
        <Button
          size="xs"
          variant={paused ? "primary" : "ghost"}
          onClick={() => setPaused((v) => !v)}
          aria-pressed={paused}
          data-testid="ambient-pause"
        >
          {paused
            ? <><Play aria-hidden className="h-3 w-3" /> 继续</>
            : <><Pause aria-hidden className="h-3 w-3" /> 暂停</>}
        </Button>
      </div>
    </footer>
  );
}
