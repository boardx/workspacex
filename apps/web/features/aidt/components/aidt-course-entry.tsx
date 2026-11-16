"use client";
import Link from "next/link";
import type { AidtCourseGroup } from "../lib/aidt-course-context";
import { aidtHref } from "../lib/project-aidt";

/** Project membership is real. Course enrollment is not inferred or created here. */
export function AidtCourseEntry({ groups }: { groups: readonly AidtCourseGroup[] }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="我加入的学习小组" data-testid="aidt-course-group-list">
    {groups.map(({ project, members }) => <Link key={project.id} href={aidtHref(project.id)} data-testid={`aidt-project-${project.id}`} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-card-foreground transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring">
      <h2 className="text-16 font-medium">{project.name}</h2>
      <p className="text-12 text-muted-foreground" data-testid={`aidt-group-members-${project.id}`}>成员 · {members.map(member => member.displayName).join("、")}</p>
      <p className="mt-auto text-12 text-muted-foreground">{project.readOnlyReason === "org-disabled" ? "组织已停用 · 只读" : project.status === "archived" || project.readOnlyReason === "archived" ? "已归档 · 只读" : "进入本组六步 →"}</p>
    </Link>)}
  </div>;
}
