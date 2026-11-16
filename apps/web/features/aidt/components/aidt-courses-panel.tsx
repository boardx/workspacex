"use client";
import * as React from "react";
import Link from "next/link";
import type { CourseValue, CourseGroupValue } from "@repo/contracts/aidt-courses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createAidtCourse, linkAidtCourseGroup, listAidtCourseGroups, listAidtCourses } from "../lib/aidt-course-client";
import type { AidtCourseActor, AidtCourseGroup } from "../lib/aidt-course-context";
import { aidtHref } from "../lib/project-aidt";

type CourseList = { items: CourseValue[]; nextCursor: string | null };
type GroupList = { course: CourseValue; items: CourseGroupValue[]; nextCursor: string | null };
type PanelProps = { actor: AidtCourseActor; canManage: boolean; permissionKey?: string | null; availableGroups: readonly AidtCourseGroup[] };
/** Scope and role changes dispose all requests, including already-authorized mutations. */
export function AidtCoursesPanel(props: PanelProps) {
  const identity = JSON.stringify([props.actor.orgId, props.actor.userId, props.actor.sessionToken, props.canManage, props.permissionKey ?? null]);
  const lifecycle = React.useRef({ identity, generation: 0 });
  if (lifecycle.current.identity !== identity) lifecycle.current = { identity, generation: lifecycle.current.generation + 1 };
  return <AidtCourseSession key={JSON.stringify([identity, lifecycle.current.generation])} {...props} />;
}
function AidtCourseSession({ actor, canManage, availableGroups }: PanelProps) {
  const [courses, setCourses] = React.useState<CourseList | null>(null);
  const [courseError, setCourseError] = React.useState(false);
  const [courseBusy, setCourseBusy] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [groups, setGroups] = React.useState<GroupList | null>(null);
  const [groupError, setGroupError] = React.useState(false);
  const [groupBusy, setGroupBusy] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const [groupRefresh, setGroupRefresh] = React.useState(0);
  const [name, setName] = React.useState("");
  const [projectId, setProjectId] = React.useState("");
  const [mutation, setMutation] = React.useState<"create" | "link" | null>(null);
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const live = React.useRef(true);
  const listRequest = React.useRef<AbortController | null>(null);
  const groupRequest = React.useRef<AbortController | null>(null);
  const mutationRequest = React.useRef<AbortController | null>(null);
  const receipt = React.useRef<{ name: string; operationId: string } | null>(null);
  const { orgId, userId, sessionToken } = actor;
  const captured = React.useCallback((controller: AbortController): AidtCourseActor => ({ orgId, userId, sessionToken, signal: controller.signal }), [orgId, userId, sessionToken]);
  React.useEffect(() => { live.current = true; return () => { live.current = false; listRequest.current?.abort(); groupRequest.current?.abort(); mutationRequest.current?.abort(); }; }, []);
  const loadCourses = React.useCallback(async (cursor?: string) => {
    listRequest.current?.abort(); const controller = new AbortController(); listRequest.current = controller;
    setCourseBusy(true); setCourseError(false);
    try {
      const result = await listAidtCourses(captured(controller), { limit: 20, cursor });
      if (live.current && listRequest.current === controller && !controller.signal.aborted) setCourses(previous => ({ ...result, items: cursor ? [...(previous?.items ?? []), ...result.items] : result.items }));
    } catch { if (live.current && listRequest.current === controller && !controller.signal.aborted) { setCourses(null); setCourseError(true); setSelected(null); setGroups(null); groupRequest.current?.abort(); } }
    finally { if (live.current && listRequest.current === controller) setCourseBusy(false); }
  }, [captured]);
  React.useEffect(() => { void loadCourses(); return () => listRequest.current?.abort(); }, [loadCourses, refresh]);
  const clearDenied = React.useCallback((error: unknown) => {
    const status = error && typeof error === "object" && "status" in error ? error.status : null;
    if (status === 401 || status === 403 || status === 404) {
      listRequest.current?.abort(); groupRequest.current?.abort();
      setCourses(null); setCourseError(true); setGroups(null); setSelected(null);
    }
  }, []);
  const loadGroups = React.useCallback(async (courseId: string, cursor?: string) => {
    groupRequest.current?.abort(); const controller = new AbortController(); groupRequest.current = controller;
    setGroupBusy(true); setGroupError(false);
    try {
      const result = await listAidtCourseGroups(captured(controller), courseId, { limit: 20, cursor });
      if (live.current && groupRequest.current === controller && !controller.signal.aborted) setGroups(previous => ({ ...result, items: cursor && previous?.course.id === courseId ? [...previous.items, ...result.items] : result.items }));
    } catch (error) { if (live.current && groupRequest.current === controller && !controller.signal.aborted) { setGroups(null); setGroupError(true); clearDenied(error); } }
    finally { if (live.current && groupRequest.current === controller) setGroupBusy(false); }
  }, [captured, clearDenied]);
  React.useEffect(() => {
    setGroups(null); setGroupError(false); setProjectId(""); setMutationError(null); setNotice(null);
    if (selected) void loadGroups(selected);
    return () => groupRequest.current?.abort();
  }, [selected, loadGroups, groupRefresh]);
  async function saveCourse(event: React.FormEvent) {
    event.preventDefault(); if (mutation) return;
    const trimmed = name.trim(); if (!trimmed) return;
    if (receipt.current?.name !== trimmed) receipt.current = { name: trimmed, operationId: crypto.randomUUID() };
    const controller = new AbortController(); mutationRequest.current = controller; setMutation("create"); setMutationError(null); setNotice(null);
    try {
      const result = await createAidtCourse(captured(controller), trimmed, receipt.current.operationId);
      if (!live.current || mutationRequest.current !== controller || controller.signal.aborted) return;
      setName(""); receipt.current = null; setSelected(result.course.id); setRefresh(n => n + 1); setNotice("课程已保存。请关联已有小组。");
    } catch (error) { if (live.current && mutationRequest.current === controller && !controller.signal.aborted) { clearDenied(error); setMutationError("课程未确认保存，请重试。重试会复用本次操作编号。"); } }
    finally { if (live.current && mutationRequest.current === controller) setMutation(null); }
  }
  async function saveLink(event: React.FormEvent) {
    event.preventDefault(); if (mutation || !selected || !projectId) return;
    const controller = new AbortController(); mutationRequest.current = controller; setMutation("link"); setMutationError(null); setNotice(null);
    try {
      await linkAidtCourseGroup(captured(controller), selected, projectId);
      if (!live.current || mutationRequest.current !== controller || controller.signal.aborted) return;
      setGroupRefresh(n => n + 1); setRefresh(n => n + 1); setNotice("小组已关联，原成员权限保持不变。");
    } catch (error) { if (live.current && mutationRequest.current === controller && !controller.signal.aborted) { clearDenied(error); setMutationError("关联未完成。请核对：你是此组负责人、小组可编辑，且尚未关联其他课程，然后重试。"); } }
    finally { if (live.current && mutationRequest.current === controller) setMutation(null); }
  }
  const visibleGroups = groups?.course.id === selected ? groups : null;
  return <section className="rounded-xl border border-border bg-card p-5" data-testid="aidt-courses">
    <header><h2 className="text-18 font-semibold">课程与小组</h2><p className="mt-1 text-12 text-muted-foreground">按课程找到学习小组。这里只显示你有权进入的小组；成员由各小组名单管理。</p></header>
    {canManage && <form onSubmit={saveCourse} className="mt-4 flex flex-wrap items-end gap-2" data-testid="aidt-course-create"><label className="min-w-48 flex-1 text-12" htmlFor="aidt-course-name">新课程名称<Input id="aidt-course-name" data-testid="aidt-course-name" value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="例如：设计思维实践" disabled={mutation !== null} /></label><Button type="submit" disabled={!name.trim() || mutation !== null} data-testid="aidt-course-create-save">{mutation === "create" ? "正在保存…" : "建立课程"}</Button></form>}
    {courseError ? <div role="alert" className="mt-4 text-13" data-testid="aidt-courses-error">课程加载失败，不能确定课程名单。<Button variant="ghost" onClick={() => setRefresh(n => n + 1)}>重新加载课程</Button></div> : !courses ? <p role="status" className="mt-4 text-13">正在加载课程…</p> : courses.items.length === 0 ? <p className="mt-4 text-13 text-muted-foreground" data-testid="aidt-courses-empty">{canManage ? "还没有课程。建立后可关联已有小组。" : "还没有可查看的课程；已加入的小组仍可从下方进入。"}</p> : <div className="mt-4 flex flex-wrap gap-2" aria-label="选择课程">{courses.items.map(course => <Button key={course.id} variant={selected === course.id ? "primary" : "outline"} disabled={mutation !== null} aria-pressed={selected === course.id} data-testid={`aidt-course-${course.id}`} onClick={() => setSelected(course.id)}>{course.name}</Button>)}{courses.nextCursor && <Button variant="ghost" disabled={courseBusy} onClick={() => void loadCourses(courses.nextCursor!)}>更多课程</Button>}</div>}
    {selected && <div className="mt-5 border-t border-border pt-4" data-testid="aidt-course-selected">
      {groupError ? <div role="alert" data-testid="aidt-course-groups-error">此课程的小组无法读取。<Button variant="ghost" onClick={() => setGroupRefresh(n => n + 1)}>重新加载小组</Button></div> : !visibleGroups ? <p role="status">正在读取课程小组…</p> : <><h3 className="text-14 font-medium">{visibleGroups.course.name}</h3>{visibleGroups.items.length === 0 ? <p className="mt-2 text-13 text-muted-foreground" data-testid="aidt-course-groups-empty">此课程暂无你已加入的小组。</p> : <div className="mt-3 grid gap-3 sm:grid-cols-2">{visibleGroups.items.map(group => <Link key={group.project.id} href={aidtHref(group.project.id)} className="rounded-lg border border-border p-4 focus-visible:ring-2 focus-visible:ring-ring" data-testid={`aidt-course-project-${group.project.id}`}><p className="text-14 font-medium">{group.project.name}</p><p className="mt-2 text-12 text-muted-foreground">成员 · {group.members.map(member => member.displayName).join("、")}</p><p className="mt-2 text-12 text-muted-foreground">{group.project.readOnlyReason ? "只读 · 进入小组" : "进入本组六步 →"}</p></Link>)}</div>}{visibleGroups.nextCursor && <Button className="mt-3" variant="outline" disabled={groupBusy} onClick={() => void loadGroups(selected, visibleGroups.nextCursor!)}>更多小组</Button>}
        {canManage && <form onSubmit={saveLink} className="mt-4 flex flex-wrap items-end gap-2" data-testid="aidt-course-link"><label htmlFor="aidt-course-project" className="flex min-w-48 flex-1 flex-col gap-1 text-12">关联已有小组<select id="aidt-course-project" data-testid="aidt-course-link-project" value={projectId} onChange={event => setProjectId(event.target.value)} disabled={mutation !== null} className="h-9 rounded-md border border-input bg-background px-3 text-13"><option value="">选择你负责的可编辑小组</option>{availableGroups.filter(group => group.canLink && group.project.status === "active" && group.project.readOnlyReason === null).map(group => <option key={group.project.id} value={group.project.id}>{group.project.name}</option>)}</select></label><Button type="submit" disabled={!projectId || mutation !== null} data-testid="aidt-course-link-save">{mutation === "link" ? "正在关联…" : "关联小组"}</Button><p className="basis-full text-12 text-muted-foreground">关联由服务核对负责人权限。每个小组只能属于一门课程；不会添加成员或授予权限。</p></form>}</>}
    </div>}
    {mutationError && <p role="alert" className="mt-3 text-13" data-testid="aidt-course-mutation-error">{mutationError}</p>}
    {notice && <p role="status" className="mt-3 text-13" data-testid="aidt-course-notice">{notice}</p>}
  </section>;
}
