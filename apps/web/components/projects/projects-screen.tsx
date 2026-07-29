"use client";
import * as React from "react";
import { Search, Plus, Quote } from "lucide-react";
import { StateShell, StatePreviewSwitcher } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectCard } from "./project-card";
import {
  MOCK_PROJECTS,
  MOCK_HISTORICAL,
  PROJECT_FILTERS,
  filterProjects,
  type ProjectFilterKey,
} from "@/lib/mock/projects";

/**
 * 项目列表主体（UC-2.2 R8 · 原型第三节）——**客户端组件**：
 * 筛选切换与 StateShell 的 onCreate/retry 都是事件处理器，
 * 服务端组件不能把函数当 props 传给客户端组件，故整块下沉到这里。
 * 页面壳保持服务端组件（读 searchParams），只把 state 传进来。
 */
export function ProjectsScreen({ state }: { state: UiState }) {
  const [filter, setFilter] = React.useState<ProjectFilterKey>("all");
  const [query, setQuery] = React.useState("");

  const byFilter = filterProjects(MOCK_PROJECTS, filter);
  const visible = query.trim()
    ? byFilter.filter((p) => p.name.includes(query.trim()))
    : byFilter;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6" data-testid="projects-screen">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-24 font-semibold tracking-tight">项目</h1>
        <p className="text-13 text-muted-foreground">
          一个项目就是一场协作：议程、分组、画布、录音、产出与决策都挂在它下面。
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1" data-testid="projects-filters" role="tablist">
            {PROJECT_FILTERS.map((f) => {
              const count = filterProjects(MOCK_PROJECTS, f.key).length;
              const active = f.key === filter;
              return (
                <Button
                  key={f.key}
                  role="tab"
                  aria-selected={active}
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setFilter(f.key)}
                  data-testid={`projects-filter-${f.key}`}
                >
                  {f.label}
                  <span className="ml-1 text-11 tabular-nums text-muted-foreground">{count}</span>
                </Button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索项目"
                aria-label="搜索项目"
                data-testid="projects-search"
                className="h-8 w-44 pl-7"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              disabled
              title="新建项目要先选蓝本（UC-2.2「套用蓝本新建项目」），蓝本设计器尚未建 —— 见 ui-preview/README.md 的未建清单"
              data-testid="projects-new"
            >
              <Plus aria-hidden className="h-3.5 w-3.5" />
              新建项目
            </Button>
          </div>
        </div>

        <StatePreviewSwitcher current={state} />
      </div>

      <StateShell
        state={state}
        skeletonRows={4}
        emptyHint="还没有项目。用一个已发布的蓝本新建一场协作试试。"
        onCreate={() => window.alert("演示：新建项目向导（选蓝本 → 选档位 → 预览将初始化什么）")}
        errors={{ blueprint: "请先选择一个已发布的蓝本", duration: "请选择一个时长档位（半天 / 一天 / 两天 / 三天）" }}
        depFailure={{
          what: "蓝本服务（登录管理 / 蓝本发布）暂时不可用，无法列出可套用的蓝本",
          retry: () => window.location.reload(),
        }}
        denial={{ layer: "organization", reason: "你的组织角色是观察者，看不到项目编排区" }}
        successMessage="新项目已建成，已按蓝本预填议程、分组与输出物槽位"
      >
        {visible.length === 0 ? (
          <div
            data-testid="projects-filter-empty"
            className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
          >
            {filter === "archived"
              ? "已归档的项目不在活动列表里。归档只影响能不能新建，不影响已建项目。"
              : "该筛选下暂无项目。"}
          </div>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="projects-list">
            {visible.map((p) => (
              <li key={p.id}>
                <ProjectCard project={p} />
              </li>
            ))}
          </ul>
        )}

        <HistoricalSection />
      </StateShell>
    </div>
  );
}

function HistoricalSection() {
  return (
    <section className="mt-4 flex flex-col gap-2" data-testid="projects-historical">
      <div className="flex items-center gap-1.5">
        <Quote aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        <h2 className="text-13 font-semibold">历史项目仍被引用</h2>
      </div>
      <p className="text-11 text-muted-foreground">
        项目结束不等于知识退场：这些项目的决策仍在被新项目引用或横向借用。
      </p>
      <ul className="flex flex-col gap-1.5">
        {MOCK_HISTORICAL.map((h) => (
          <li
            key={h.id}
            data-testid={`projects-historical-${h.id}`}
            className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-card px-3 py-2 transition-colors duration-200 hover:bg-muted"
          >
            <span className="truncate text-12 font-medium">{h.name}</span>
            <span className="shrink-0 text-11 text-muted-foreground">{h.meta}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
