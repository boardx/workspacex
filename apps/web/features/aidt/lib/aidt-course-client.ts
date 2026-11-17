import { operations, type CoursePage } from "@repo/contracts/aidt-courses";
import { apiRequest } from "@/lib/api-client";
import { isAidtModuleEnabled } from "./aidt-module-config";
import type { AidtCourseActor } from "./aidt-course-context";

function assertCurrent(actor: AidtCourseActor) {
  if (!isAidtModuleEnabled() || actor.signal?.aborted) throw new Error("AIDT_COURSE_CONTEXT_CHANGED");
  if (!actor.userId || !actor.orgId || !actor.sessionToken) throw new Error("AIDT_COURSE_IDENTITY_REQUIRED");
}
async function request(actor: AidtCourseActor, path: string, method: "GET" | "POST" | "PUT", body?: unknown, query?: Record<string, string | number | undefined>) {
  assertCurrent(actor);
  const encodedQuery = query ? Object.fromEntries(Object.entries(query).map(([key, value]) => [key, value === undefined ? undefined : String(value)])) : undefined;
  const result = await apiRequest<unknown>(path, { method, body, query: encodedQuery, sessionToken: actor.sessionToken, signal: actor.signal });
  assertCurrent(actor);
  return result;
}
export async function listAidtCourses(actor: AidtCourseActor, page: CoursePage = { limit: 20 }) {
  const input = operations.list.in.parse(page);
  return operations.list.out.parse(await request(actor, operations.list.path, "GET", undefined, input));
}
export async function createAidtCourse(actor: AidtCourseActor, name: string, operationId: string) {
  const input = operations.create.in.parse({ name, operationId });
  return operations.create.out.parse(await request(actor, operations.create.path, "POST", input));
}
export async function listAidtCourseGroups(actor: AidtCourseActor, courseId: string, page: CoursePage = { limit: 20 }) {
  const input = operations.groups.in.parse({ ...page, courseId });
  const result = operations.groups.out.parse(await request(actor, operations.groups.path.replace(":courseId", encodeURIComponent(input.courseId)), "GET", undefined, { cursor: input.cursor, limit: input.limit }));
  if (result.course.id !== courseId) throw new Error("AIDT_COURSE_SCOPE_MISMATCH");
  return result;
}
export async function linkAidtCourseGroup(actor: AidtCourseActor, courseId: string, projectId: string) {
  const input = operations.link.in.parse({ courseId, projectId });
  const result = operations.link.out.parse(await request(actor, operations.link.path.replace(":courseId", encodeURIComponent(input.courseId)).replace(":projectId", encodeURIComponent(input.projectId)), "PUT", {}));
  if (result.courseId !== courseId || result.projectId !== projectId) throw new Error("AIDT_COURSE_SCOPE_MISMATCH");
  return result;
}
