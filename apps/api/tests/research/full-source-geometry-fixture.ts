import { createHash } from "node:crypto";
import geometry from "../../../../docs/evidence/research-organizing-5546/original-geometry.json";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";

export function prepareGeometry(state: ResearchRuntime): ResearchRuntime {
  state.outline = Array.from({ length: 4 }, (_, index) => ({ id: `ch_${index + 1}`, title: `Controlled chapter ${index}`,
    objective: `Controlled objective ${index}`, analysisApproach: "Compare controlled excerpts", expectedOutput: "Controlled analysis",
    enabled: true, order: index, questions: [0, 1].map(q => `Controlled question ${index}/${q}`),
    subsections: [0, 1, 2].map(sub => ({ id: `sub_${index}_${sub}`, title: `Controlled subsection ${sub}`,
      questions: [0, 1].map(q => `Controlled question ${index}/${2 + sub * 2 + q}`) })) }));
  state.tasks = state.outline.map(section => ({ id: `task-${section.id}`, sectionId: section.id, title: section.title,
    objective: section.objective, query: `Controlled query ${section.id}`, status: "succeeded", attempts: 1, errorCode: null }));
  state.sources = geometrySources(state);
  state.reportPartial = false;
  return state;
}

/** Controlled text preserves original chunk geometry, never original semantics or hashes. */
export function geometrySources(state: ResearchRuntime): ResearchRuntime["sources"] {
  return geometry.sources.map(({ id, documentLength, taskIndexes }) => {
    const url = `https://example.org/controlled/${id}`;
    const text = Array.from({ length: Math.ceil(documentLength / 6000) }, (_, index) =>
      `Controlled source ${id} chunk ${index}. `.padEnd(Math.min(6000, documentLength - index * 6000), "x")).join("");
    return { id, title: `Controlled ${id}`, url, taskId: state.tasks[taskIndexes[0]!]!.id,
      taskIds: taskIndexes.map(index => state.tasks[index]!.id), content: text.slice(0, 200) || "Controlled excerpt without a fetched document.",
      retrievedAt: "2026-10-10T09:00:00.000Z", decision: "accepted" as const,
      ...(documentLength ? { document: { url, text, summary: text.slice(0, 200), contentHash: createHash("sha256").update(text).digest("hex"),
        contentKind: "text" as const, retrievedAt: "2026-10-10T09:00:00.000Z", truncated: false } } : {}) };
  });
}
