"use client";

import { ProjectResourceSection } from "@/components/project/project-resource-section";
import { aidtHref } from "../lib/project-aidt";

export function aidtPrototypeEntityHref(projectId: string, designId: string, tool?: "outcome" | "design", ideaRevision?: string | null) {
  const query = new URLSearchParams({ entity: designId });
  if (ideaRevision) query.set("ideaRevision", ideaRevision);
  if (tool === "design") query.set("resource", designId);
  return `${aidtHref(projectId, 5, { tool })}&${query}`;
}

export function AidtPrototypeDirectory({ projectId, canWrite, ideaRevision }: { projectId: string; canWrite: boolean; ideaRevision?: string | null }) {
  return <section className="mx-auto w-full max-w-4xl space-y-4 p-4">
    <h1 className="text-20 font-semibold">制作原型</h1>
    <ProjectResourceSection kind="design" projectId={projectId} canWrite={canWrite}
      resourceHref={(_kind, id) => aidtPrototypeEntityHref(projectId, id, undefined, ideaRevision)}
      transformCreateHref={href => {
        const path = new URL(href, "https://workspace.invalid").pathname;
        const id = path.split("/").at(-1);
        return id ? aidtPrototypeEntityHref(projectId, decodeURIComponent(id), undefined, ideaRevision) : aidtHref(projectId, 5);
      }} />
  </section>;
}
