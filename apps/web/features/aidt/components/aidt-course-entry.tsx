"use client";
import Link from "next/link";
import type { AidtCourseGroup } from "../lib/aidt-course-context";
import { aidtHref } from "../lib/project-aidt";

/** Project membership is real. Course enrollment is not inferred or created here. */
export function AidtCourseEntry({ groups }: { groups: readonly AidtCourseGroup[] }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="我加入的学习小组" data-testid="aidt-course-group-list">
    {groups.map(({ project, members }) => <Link key={project.id} href={aidtHref(project.id)} data-testid={`aidt-project-${project.id}`} className="flex min-h-44 flex-col gap-4 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm transition-all hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <h2 className="text-20 font-semibold tracking-tight">{project.name}</h2>
      <p className="text-12 text-muted-foreground" data-testid={`aidt-group-members-${project.id}`}>成员 · {members.map(member => member.displayName).join("、")}</p>
      <p className="mt-auto flex items-center justify-between text-13 text-muted-foreground">{project.readOnlyReason === "org-disabled" ? "组织已停用 · 只读" : project.status === "archived" || project.readOnlyReason === "archived" ? "已归档 · 只读" : "进入小组"}<span aria-hidden>↗</span></p>
    </Link>)}
  </div>;
}
