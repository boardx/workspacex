import { research as C } from "@repo/contracts";
import type { ResearchRuntime } from "./guided-runtime-ports";
import { reportQuestions } from "./guided-report-evidence";
import { supplementQuery } from "./guided-supplement-query";
type Task = ResearchRuntime["tasks"][number];
const objectiveLimit = C.GuidedResearchTask.shape.objective.unwrap().maxLength!;
type Section = ResearchRuntime["outline"][number];
/** Only per-question tasks whose saved objective proves the complete current
 * question may receive its derived query. Legacy chapter tasks retain their
 * existing chapter-wide gate; no index-only or truncated-tail inference. */
export function scopedSupplementQueries(state: ResearchRuntime, section: Section, ordered: readonly Task[]): Array<{ task: Task; query: string }> {
  const questions = reportQuestions(state.outline.filter(item => item.enabled)).filter(question => question.sectionId === section.id);
  const candidates = ordered.filter(task => {
    if (task.sectionId !== section.id) return false;
    if (!task.questionId) return true;
    const question = questions.find(question => question.id === task.questionId);
    return Boolean(question && question.question.length <= objectiveLimit && task.objective === question.question);
  });
  const counts = new Map<string, number>();
  for (const task of candidates) if (task.questionId) counts.set(task.questionId, (counts.get(task.questionId) ?? 0) + 1);
  const ambiguous = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  const eligible = candidates.filter(task => !task.questionId || !ambiguous.has(task.questionId));
  const first = eligible[0];
  if (!first) return [];
  const scope = [state.brief.topic, state.brief.region].filter(Boolean).join(" ");
  const entries = [{ task: first, query: supplementQuery(scope, first.query, "primary source") }];
  for (const question of questions) {
    const text = question.question;
    if (ambiguous.has(question.id) || text.length > objectiveLimit) continue;
    const exact = eligible.filter(task => task.questionId === question.id);
    const task = exact.length === 1 ? exact[0] : exact.length === 0 ? eligible.find(task => !task.questionId) : undefined;
    if (task) entries.push({ task, query: supplementQuery(scope, text) });
  }
  entries.push({ task: first, query: supplementQuery(scope, section.title, "official report") }, { task: first, query: supplementQuery(scope, section.title, "data study") });
  const seen = new Set<string>();
  return entries.filter(entry => {
    const key = JSON.stringify([entry.task.id, entry.query]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 6);
}
