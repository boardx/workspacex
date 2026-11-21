"use client";
import * as React from "react";
import { project as projectContract } from "@repo/contracts";
import Link from "next/link";
import type { AidtCourseGroup } from "../lib/aidt-course-context";
import { aidtHref } from "../lib/project-aidt";

/** Project membership is real. Course enrollment is not inferred or created here. */
export function AidtCourseEntry({ groups, courseTags }: { groups: readonly AidtCourseGroup[]; courseTags: readonly string[] }) {
  const [filter, setFilter] = React.useState("");
  const visible = groups.filter(({ project }) => {
    const labels = projectContract.readAidtCourseTags(project.tags);
    return !filter || (filter === "untagged" ? labels.length === 0 : labels.includes(filter.slice(4)));
  });
  return <section className="space-y-4">
    <label className="inline-flex items-center gap-2 text-13 font-medium">按课程筛选
      <select value={filter} onChange={event => setFilter(event.target.value)} className="rounded-control border border-border bg-card px-3 py-2">
        <option value="">全部课程</option><option value="untagged">未设置课程</option>
        {courseTags.map(label => <option key={label} value={`tag:${label}`}>{label}</option>)}
      </select>
    </label>
    {!visible.length && <p role="status" className="text-13 text-muted-foreground">此课程下暂无小组。</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="我加入的学习小组" data-testid="aidt-course-group-list">
    {visible.map(({ project, members }) => <Link key={project.id} href={aidtHref(project.id)} data-testid={`aidt-project-${project.id}`} className="flex min-h-44 flex-col gap-4 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm transition-all hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <h2 className="text-20 font-semibold tracking-tight">{project.name}</h2>
      {projectContract.readAidtCourseTags(project.tags).map(label => <span key={label} className="self-start rounded-full bg-muted px-2 py-1 text-12">{label}</span>)}
      <p className="text-12 text-muted-foreground" data-testid={`aidt-group-members-${project.id}`}>成员 · {members.map(member => member.displayName).join("、")}</p>
      <p className="mt-auto flex items-center justify-between text-13 text-muted-foreground">{project.readOnlyReason === "org-disabled" ? "组织已停用 · 只读" : project.status === "archived" || project.readOnlyReason === "archived" ? "已归档 · 只读" : "进入小组"}<span aria-hidden>↗</span></p>
    </Link>)}
  </div></section>;
}
