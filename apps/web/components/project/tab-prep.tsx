"use client";
import * as React from "react";
import { Plus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionTitle, StatChip, ObserverNotice } from "./parts";
import {
  AGENDA, BLUEPRINT_CATALOG, PROJECT_ROLE_LABEL,
  ROLE_CAN_WRITE, ROLE_STAGE_CONTROL, observerHidden, type ProjectRole,
} from "@/lib/mock/project";
import { ApiError } from "@/lib/api-client";
import {
  createAgendaSegment, AGENDA_SEGMENT_STATE_LABEL,
  type ProjectListItem, type ListAgendaSegmentsOut,
} from "@/lib/live-projects";
import {
  saveProjectTopic, saveProjectGrouping, GROUP_STATUS_LABEL,
  type ProjectTopicOut, type ProjectGroupingOut, type Group,
} from "@/lib/live-project-prep";
import { listOrgMembers, type ListOrgMembersOut } from "@/lib/live-org-admin";
import { useSession } from "@/components/session/session-provider";

type OrgMemberRow = ListOrgMembersOut["members"][number];

/**
 * 项目筹备（原型 isWsScope / isWsAgenda）—— 复用 tpl 域（套用蓝本、议程环节）。
 * 净新在项目侧的是：定题与分组（四组：场景/组长/组员/访谈对象）+ 议程环节的三角色分工表。
 * ⚠ 「议程环节」命名**已裁决** → D-03a `agenda_segment`（Q-3① 改名对齐）；
 *   UI 显示中文「环节」，testid 统一为 `agenda-segment-*`。
 * ⚠ 观察者显著更少：分组名单（组长/组员/访谈对象）是内部编排，整块消失；只保留定题与议程只读。
 *
 * ⚠ #853：「议程环节 · 真实数据」一块。此前 `createAgendaSegment` 有 controller
 *   （#627）但 `apps/web` 零调用方——用户造不出议程环节，`bindTemplateToSegment`（#493）
 *   因此永远没有可绑的目标；`listAgendaSegments` 同一次签核，也从未挂过 controller
 *   （#853 一并补上）。下方「议程 · 每个环节三种角色各做什么」那张表**仍是 mock**——
 *   三角色分工在契约里没有出处（同 `tab-overview.tsx` F172 对当前环节卡的处理），
 *   本次不动它。
 *
 * ⚠ F950（2026-08-16 delta）：定题与分组从 mock（`PROJECT_HEADER.question`/
 *   `PREP_GROUPS`）换成真实 `getProjectTopic`/`getProjectGrouping`/`saveAndSyncTopic`/
 *   `updateGrouping`——F24/F25 签的契约第一次真正落库。组长/组员的姓名解析复用既有的
 *   `listOrgMembers`（org-admin 束，任何组织成员可读），不新造一个身份端点。
 *   访谈对象（`InterviewSubject`）本次不接，契约有出处但仍零 controller，留给后续 feature。
 */
export function TabPrep({
  view, readOnly = false, projectId, liveProject = null,
  liveSegments = null, liveSegmentsLoading = false, liveSegmentsError = null,
  onSegmentCreated,
  liveTopic = null, liveTopicLoading = false, liveTopicError = null, onTopicSaved,
  liveGrouping = null, liveGroupingLoading = false, liveGroupingError = null, onGroupingSaved,
}: {
  view: ProjectRole;
  readOnly?: boolean;
  /** 真实工作坊 id（超类型模型下与 `workshopId` 同值域）。 */
  projectId: string;
  /** `null` = 未登录 / 还没查到 kind，不代表「不是工作坊」——创建区据此保守隐藏。 */
  liveProject?: ProjectListItem | null;
  liveSegments?: ListAgendaSegmentsOut | null;
  liveSegmentsLoading?: boolean;
  liveSegmentsError?: string | null;
  /** 新建成功后调用：让父组件重新打一次真实 `listAgendaSegments`。 */
  onSegmentCreated?: () => void;
  liveTopic?: ProjectTopicOut | null;
  liveTopicLoading?: boolean;
  liveTopicError?: string | null;
  /** 保存成功后调用：让父组件重新打一次真实 `getProjectTopic`。 */
  onTopicSaved?: () => void;
  liveGrouping?: ProjectGroupingOut | null;
  liveGroupingLoading?: boolean;
  liveGroupingError?: string | null;
  /** 保存成功后调用：让父组件重新打一次真实 `getProjectGrouping`。 */
  onGroupingSaved?: () => void;
}) {
  const canWrite = ROLE_CAN_WRITE[view] && !readOnly;
  const isObserver = observerHidden(view);
  const roleKeys: ProjectRole[] = ["facilitator", "groupLead", "member"];
  // agendaSegment.create / 定题 / 分组编排三者都**只属引导师**——复用既有的「全场控制」
  // 投影（同 `project-workbench.tsx` 对 `ROLE_STAGE_CONTROL` 的用法），不为定题/分组
  // 各自新造一份角色判据：后端 `canSaveTopic`/`canUpdateGrouping` 恰好也都是
  // facilitator-only，前端与后端判据一致，不会出现「前端显示可编辑，后端拒绝」的落差。
  const canCreateSegment = ROLE_STAGE_CONTROL[view] && !readOnly;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-prep">
      {/* 定题 —— 真实数据（F950） */}
      <section>
        <SectionTitle meta="蓝本决定环节骨架，改动只影响这一场">定题与分组</SectionTitle>
        <TopicBlock
          projectId={projectId}
          topic={liveTopic}
          loading={liveTopicLoading}
          error={liveTopicError}
          canWrite={canCreateSegment}
          onSaved={onTopicSaved}
        />
      </section>

      {/* 四组：场景 / 组长 / 组员 / 访谈对象 —— 观察者不可见（内部编排） */}
      {isObserver ? (
        <ObserverNotice
          testId="project-prep-observer-notice"
          what="分组名单（组长 / 组员 / 访谈对象）与筹备编排属于内部协作视图，不在观察者只读范围内。你能看到的是定题与下方议程骨架。"
        />
      ) : (
        <GroupingBlock
          projectId={projectId}
          grouping={liveGrouping}
          loading={liveGroupingLoading}
          error={liveGroupingError}
          canWrite={canCreateSegment}
          onSaved={onGroupingSaved}
        />
      )}

      {/* 议程环节 · 真实数据（#853）—— 新建入口 + 真实列表，刷新后仍在 */}
      {liveProject?.kind === "workshop" && (
        <RealAgendaSection
          projectId={projectId}
          segments={liveSegments}
          loading={liveSegmentsLoading}
          error={liveSegmentsError}
          canCreate={canCreateSegment}
          onCreated={onSegmentCreated}
        />
      )}

      {/* 议程环节 · 三角色分工表（只读骨架，四视角都可见） */}
      <section>
        <SectionTitle meta="编排一次，三套视图与待办自动生成">议程 · 每个环节三种角色各做什么</SectionTitle>
        <Card>
          <div className="grid grid-cols-[auto_repeat(3,1fr)] gap-x-3 gap-y-0 p-1 text-11" data-testid="project-prep-agenda">
            <div className="border-b border-border px-2.5 py-2 text-10 font-medium uppercase tracking-wide text-muted-foreground">环节</div>
            {roleKeys.map((r) => (
              <div key={r} className="border-b border-border px-2.5 py-2 text-10 font-medium uppercase tracking-wide text-muted-foreground">{PROJECT_ROLE_LABEL[r]}</div>
            ))}
            {AGENDA.map((seg) => (
              <RowGroup key={seg.no} seg={seg} roleKeys={roleKeys} />
            ))}
          </div>
        </Card>
        <p className="mt-2 px-1 text-10 text-muted-foreground">
          每一格都会变成对应角色的一条待办，同步到「待办」看板里；组长切换环节状态后，三种视角的首屏立刻跟着换。
        </p>
        {canWrite && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" data-testid="project-prep-edit-agenda">去议程里细调</Button>
            <Button size="sm" variant="ghost" className="transition-colors" data-testid="project-prep-save-template">另存为组织模板</Button>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * F950 —— 定题区块。读 `getProjectTopic`（空态 = 未定题，不是失败），引导师可编辑
 * 标题与背景，保存走 `saveAndSyncTopic`。整体替换语义不适用于这里（定题只有两个
 * 字段），但并发冲突（`VERSION_CHANGED`）与 F185 `TagsEditor` 同一条纪律：提交中禁用、
 * 失败就地显示、**不本地乐观拼接**——保存成功后交给父组件重新打一次真实 GET。
 */
function TopicBlock({
  projectId, topic, loading, error, canWrite, onSaved,
}: {
  projectId: string;
  topic: ProjectTopicOut | null;
  loading: boolean;
  error: string | null;
  canWrite: boolean;
  onSaved?: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [background, setBackground] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const startEdit = () => {
    setTitle(topic?.title ?? "");
    setBackground(topic?.background ?? "");
    setSubmitError(null);
    setEditing(true);
  };

  async function submit() {
    if (topic === null) return;
    const trimmed = title.trim();
    if (trimmed === "") {
      setSubmitError("主题不能为空");
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await saveProjectTopic({
        projectId, title: trimmed, background, expectedTopicRevision: topic.revision,
      });
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setSubmitError(describeTopicError(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading && topic === null) {
    return (
      <Card><div className="p-4 text-11 text-muted-foreground" data-testid="project-prep-topic-loading">加载中…</div></Card>
    );
  }
  if (error !== null) {
    return (
      <Card><div className="p-4 text-11 text-destructive" data-testid="project-prep-topic-error">读取失败：{error}</div></Card>
    );
  }

  return (
    <Card><div className="flex flex-col gap-2 p-4" data-testid="project-prep-topic">
      {!editing ? (
        <>
          {topic !== null && topic.title !== "" ? (
            <h3 className="text-14 font-medium leading-snug" data-testid="project-prep-topic-title">{topic.title}</h3>
          ) : (
            <p className="text-13 text-muted-foreground" data-testid="project-prep-topic-empty">还没有定题——{canWrite ? "点「编辑」定主题与背景。" : "等引导师定题。"}</p>
          )}
          {topic !== null && topic.background !== "" && (
            <p className="text-11 text-muted-foreground" data-testid="project-prep-topic-background">{topic.background}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <StatChip tone="success">已套用蓝本 {BLUEPRINT_CATALOG[0]?.name}</StatChip>
            <StatChip>{BLUEPRINT_CATALOG[0]?.meta}</StatChip>
            <span className="text-10 text-muted-foreground">工作坊模板骨架 · 环节字段名已定为 agenda_segment（D-03a）</span>
            {canWrite && topic !== null && (
              <Button size="xs" variant="outline" onClick={startEdit} data-testid="project-prep-topic-edit">编辑</Button>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-10">
            <span className="text-muted-foreground">主题·一句话</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="project-prep-topic-title-input" />
          </label>
          <label className="flex flex-col gap-1 text-10">
            <span className="text-muted-foreground">背景·为什么现在开这场</span>
            <Input value={background} onChange={(e) => setBackground(e.target.value)} data-testid="project-prep-topic-background-input" />
          </label>
          {submitError !== null && (
            <p role="alert" className="text-10 text-destructive" data-testid="project-prep-topic-submit-error">{submitError}</p>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit()} data-testid="project-prep-topic-save">
              {busy ? "保存中…" : "保存并同步到全场"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)} data-testid="project-prep-topic-cancel">取消</Button>
          </div>
        </div>
      )}
    </div></Card>
  );
}

function describeTopicError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.reasonCode === "VERSION_CHANGED") return "有人改过了这里的内容，请重新加载后再编辑";
    if (e.reasonCode === "ROLE_INSUFFICIENT" || e.reasonCode === "NO_PROJECT_ROLE") return "你没有编辑定题的权限";
    return e.reasonCode ?? `操作失败（HTTP ${e.status}）`;
  }
  if (e instanceof Error) return e.message;
  return "未知错误";
}

/**
 * F950 —— 分组区块。读 `getProjectGrouping`（空数组 = 真实空态）。组长/组员的
 * `userId` 需要解析成显示名——复用既有的 `listOrgMembers`（org-admin 束），不新造
 * 一个身份端点；只在本区块挂载时拉一次，不是全局 store。
 */
function GroupingBlock({
  projectId, grouping, loading, error, canWrite, onSaved,
}: {
  projectId: string;
  grouping: ProjectGroupingOut | null;
  loading: boolean;
  error: string | null;
  canWrite: boolean;
  onSaved?: () => void;
}) {
  const { session } = useSession();
  const orgId = session?.currentOrgId ?? null;
  const [members, setMembers] = React.useState<OrgMemberRow[] | null>(null);

  React.useEffect(() => {
    // ⚠ 依赖 `orgId`（字符串）而不是整个 `session` 对象——`useSession()` 在某些调用方
    //   (含测试里的 mock) 每次渲染都可能返回一个新的对象引用，依赖整个对象会让这个
    //   effect 每次渲染都重新触发：拉取 → setMembers → 重渲染 → 又拉取，无限循环。
    if (orgId === null) return;
    let live = true;
    listOrgMembers(orgId)
      .then((out) => { if (live) setMembers(out.members); })
      .catch(() => { if (live) setMembers(null); });
    return () => { live = false; };
  }, [orgId]);

  const nameOf = React.useCallback(
    (userId: string) => members?.find((m) => m.userId === userId)?.displayName ?? userId,
    [members],
  );

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Group[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const startEdit = () => {
    setDraft(grouping?.groups.map((g) => ({ ...g, memberUserIds: [...g.memberUserIds] })) ?? []);
    setSubmitError(null);
    setEditing(true);
  };

  const addGroup = () => {
    setDraft((prev) => [
      ...prev,
      {
        groupId: `g-${Date.now()}-${prev.length}`,
        name: `第 ${prev.length + 1} 组`,
        scenario: "", leaderUserId: null, status: "needs-intervention", memberUserIds: [],
      },
    ]);
  };
  const removeGroup = (groupId: string) => setDraft((prev) => prev.filter((g) => g.groupId !== groupId));
  const patchGroup = (groupId: string, patch: Partial<Group>) =>
    setDraft((prev) => prev.map((g) => (g.groupId === groupId ? { ...g, ...patch } : g)));

  async function submit() {
    if (grouping === null) return;
    const missingLeader = draft.find((g) => g.leaderUserId === null);
    if (missingLeader !== undefined) {
      setSubmitError(`「${missingLeader.name}」还没有组长`);
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await saveProjectGrouping({
        projectId, groupCount: draft.length, groups: draft, expectedRevision: grouping.revision,
      });
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setSubmitError(describeGroupingError(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading && grouping === null) {
    return (
      <section>
        <SectionTitle meta="每组：场景 · 组长 · 组员 · 访谈对象">分组与组长</SectionTitle>
        <Card><div className="p-4 text-11 text-muted-foreground" data-testid="project-prep-groups-loading">加载中…</div></Card>
      </section>
    );
  }
  if (error !== null) {
    return (
      <section>
        <SectionTitle meta="每组：场景 · 组长 · 组员 · 访谈对象">分组与组长</SectionTitle>
        <Card><div className="p-4 text-11 text-destructive" data-testid="project-prep-groups-error">读取失败：{error}</div></Card>
      </section>
    );
  }

  const groups = editing ? draft : grouping?.groups ?? [];

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <SectionTitle className="mb-0" meta="每组：场景 · 组长 · 组员 · 访谈对象">分组与组长</SectionTitle>
        {canWrite && !editing && (
          <Button size="xs" variant="outline" onClick={startEdit} data-testid="project-prep-groups-edit">编辑</Button>
        )}
      </div>

      {groups.length === 0 && !editing && (
        <p className="text-11 text-muted-foreground" data-testid="project-prep-groups-empty">
          还没有分组——{canWrite ? "点「编辑」建第一组。" : "等引导师分组。"}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" data-testid="project-prep-groups">
        {groups.map((g) => (
          <Card key={g.groupId} data-testid={`project-prep-group-${g.groupId}`}>
            <div className="flex flex-col gap-1.5 p-3.5 text-11">
              {!editing ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-12 font-medium">{g.name}</span>
                    <StatChip>{g.scenario}</StatChip>
                    <StatChip tone={g.status === "recording-ready" ? "success" : g.status === "needs-intervention" ? "danger" : "warning"}>
                      {GROUP_STATUS_LABEL[g.status as keyof typeof GROUP_STATUS_LABEL]}
                    </StatChip>
                  </div>
                  <Row k="组长" v={g.leaderUserId !== null ? nameOf(g.leaderUserId) : "未指派"} />
                  <Row k="组员" v={g.memberUserIds.length > 0 ? g.memberUserIds.map(nameOf).join("、") : "无"} />
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      value={g.name}
                      onChange={(e) => patchGroup(g.groupId, { name: e.target.value })}
                      className="h-7 flex-1 text-11"
                      data-testid={`project-prep-group-${g.groupId}-name`}
                    />
                    <button
                      type="button"
                      aria-label="删除这组"
                      onClick={() => removeGroup(g.groupId)}
                      data-testid={`project-prep-group-${g.groupId}-remove`}
                      className="rounded-full p-1 text-muted-foreground transition-colors duration-200 hover:bg-muted"
                    >
                      <X aria-hidden className="h-3 w-3" />
                    </button>
                  </div>
                  <Input
                    value={g.scenario}
                    onChange={(e) => patchGroup(g.groupId, { scenario: e.target.value })}
                    placeholder="场景·本组要推演什么"
                    className="h-7 text-11"
                    data-testid={`project-prep-group-${g.groupId}-scenario`}
                  />
                  <select
                    value={g.status}
                    onChange={(e) => patchGroup(g.groupId, { status: e.target.value as Group["status"] })}
                    className="h-7 rounded-md border border-border bg-card px-2 text-11"
                    data-testid={`project-prep-group-${g.groupId}-status`}
                  >
                    {Object.entries(GROUP_STATUS_LABEL).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                  <label className="flex flex-col gap-1">
                    <span className="text-10 text-muted-foreground">组长</span>
                    <select
                      value={g.leaderUserId ?? ""}
                      onChange={(e) => patchGroup(g.groupId, { leaderUserId: e.target.value === "" ? null : e.target.value })}
                      className="h-7 rounded-md border border-border bg-card px-2 text-11"
                      data-testid={`project-prep-group-${g.groupId}-leader`}
                    >
                      <option value="">未指派</option>
                      {(members ?? []).map((m) => (
                        <option key={m.userId} value={m.userId}>{m.displayName}</option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="flex flex-col gap-1">
                    <legend className="text-10 text-muted-foreground">组员</legend>
                    {(members ?? []).filter((m) => m.userId !== g.leaderUserId).map((m) => (
                      <label key={m.userId} className="flex items-center gap-1.5 text-10">
                        <input
                          type="checkbox"
                          checked={g.memberUserIds.includes(m.userId)}
                          onChange={(e) => patchGroup(g.groupId, {
                            memberUserIds: e.target.checked
                              ? [...g.memberUserIds, m.userId]
                              : g.memberUserIds.filter((id) => id !== m.userId),
                          })}
                          data-testid={`project-prep-group-${g.groupId}-member-${m.userId}`}
                        />
                        {m.displayName}
                      </label>
                    ))}
                  </fieldset>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>

      {editing && (
        <div className="mt-2 flex flex-col gap-2">
          <Button size="sm" variant="outline" className="self-start" onClick={addGroup} data-testid="project-prep-groups-add">
            <Plus aria-hidden className="h-3.5 w-3.5" /> 加一组
          </Button>
          {submitError !== null && (
            <p role="alert" className="text-10 text-destructive" data-testid="project-prep-groups-submit-error">{submitError}</p>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit()} data-testid="project-prep-groups-save">
              {busy ? "保存中…" : "保存分组"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)} data-testid="project-prep-groups-cancel">取消</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function describeGroupingError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.reasonCode === "VERSION_CHANGED") return "有人改过了分组，请重新加载后再编辑";
    if (e.reasonCode === "GROUP_LEADER_REQUIRED") return "每组必须有一位组长";
    if (e.reasonCode === "ROLE_INSUFFICIENT" || e.reasonCode === "NO_PROJECT_ROLE") return "你没有编辑分组的权限";
    return e.reasonCode ?? `操作失败（HTTP ${e.status}）`;
  }
  if (e instanceof Error) return e.message;
  return "未知错误";
}

/**
 * #853 —— 真实议程环节区块。列表来自 `listAgendaSegments`，新建走 `createAgendaSegment`。
 * ⚠ 新建出来的环节初始态恒 `pending`（服务端逐字），不会立刻变成「当前环节」——
 *   下方列表如实按 `state` 显示，不把刚建的那条画成「进行中」。
 */
function RealAgendaSection({
  projectId, segments, loading, error, canCreate, onCreated,
}: {
  projectId: string;
  segments: ListAgendaSegmentsOut | null;
  loading: boolean;
  error: string | null;
  canCreate: boolean;
  onCreated?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [duration, setDuration] = React.useState("30");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [lastCreated, setLastCreated] = React.useState<string | null>(null);

  const nextOrdinal = segments === null || segments.length === 0
    ? 0
    : Math.max(...segments.map((s) => s.ordinal)) + 1;

  async function submit() {
    const trimmedTitle = title.trim();
    const durationMinutes = Number(duration);
    if (trimmedTitle.length === 0 || !Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      setSubmitError("标题不能为空，时长必须是正整数（分钟）");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createAgendaSegment({
        workshopId: projectId,
        agendaSegmentDefinitionId: null,
        ordinal: nextOrdinal,
        title: trimmedTitle,
        duration: durationMinutes,
      });
      setTitle("");
      setDuration("30");
      setOpen(false);
      setLastCreated(`已建「${created.title}」· 第 ${created.ordinal} 位 · id ${created.id}`);
      // ⚠ 不在这里把 `created` append 进本地列表——交给调用方重新打一次真实
      //   `listAgendaSegments`，同 `template-apply-dialog.tsx` 对 `onApplied` 的注释：
      //   本地追加看起来与真的一模一样，而「它到底进没进库」正是这个入口要证明的事。
      onCreated?.();
    } catch (e) {
      setSubmitError(describeCreateError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <SectionTitle meta="真实往返：建了会落库，刷新页面后还在">议程环节 · 真实数据</SectionTitle>
      <Card>
        <div className="flex flex-col gap-2 p-3.5" data-testid="project-prep-real-agenda">
          {loading && (
            <p className="text-11 text-muted-foreground" data-testid="project-prep-real-agenda-loading">加载中…</p>
          )}
          {error !== null && (
            <p className="text-11 text-destructive" data-testid="project-prep-real-agenda-error">读取失败：{error}</p>
          )}
          {error === null && !loading && segments !== null && segments.length === 0 && (
            <p className="text-11 text-muted-foreground" data-testid="project-prep-real-agenda-empty">
              这个工作坊还没有任何议程环节——{canCreate ? "点下面「新建议程环节」建第一个。" : "等引导师建第一个。"}
            </p>
          )}
          {segments !== null && segments.length > 0 && (
            <ul className="flex flex-col gap-1.5" data-testid="project-prep-real-agenda-list">
              {segments.map((s) => (
                <li
                  key={s.id}
                  data-testid={`project-prep-real-agenda-${s.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-panel px-2.5 py-1.5 text-11"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-10 text-muted-foreground">{s.ordinal}</span>
                    <span className="min-w-0 truncate font-medium">{s.title}</span>
                    <span className="shrink-0 text-10 text-muted-foreground">{s.duration} 分钟</span>
                  </div>
                  <StatChip tone={s.state === "active" ? "ai" : s.state === "closed" || s.state === "skipped" ? "neutral" : "success"}>
                    {AGENDA_SEGMENT_STATE_LABEL[s.state]}
                  </StatChip>
                </li>
              ))}
            </ul>
          )}

          {lastCreated !== null && (
            <p className="rounded-md border border-success/30 bg-success/5 px-2.5 py-1.5 text-10 text-success" data-testid="project-prep-real-agenda-created">
              {lastCreated}
            </p>
          )}

          {canCreate && (
            <div className="mt-1 flex flex-col gap-2">
              {!open ? (
                <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)} data-testid="project-prep-create-agenda-open">
                  <Plus aria-hidden className="h-3.5 w-3.5" /> 新建议程环节
                </Button>
              ) : (
                <div className="flex flex-col gap-2 rounded-md border border-border bg-panel p-2.5" data-testid="project-prep-create-agenda-form">
                  <label className="flex flex-col gap-1 text-10">
                    <span className="text-muted-foreground">环节标题</span>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="例如：开场破冰"
                      data-testid="project-prep-create-agenda-title"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-10">
                    <span className="text-muted-foreground">时长（分钟）</span>
                    <Input
                      type="number"
                      min={1}
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      data-testid="project-prep-create-agenda-duration"
                    />
                  </label>
                  <span className="text-10 text-muted-foreground">
                    第 {nextOrdinal} 位 · 新建出来是「待开始」，不会自动变成当前环节。
                  </span>
                  {submitError !== null && (
                    <p role="alert" className="text-10 text-destructive" data-testid="project-prep-create-agenda-error">
                      {submitError}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={submitting}
                      onClick={() => void submit()}
                      data-testid="project-prep-create-agenda-submit"
                    >
                      {submitting ? "正在建…" : "建这个环节"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={submitting}
                      onClick={() => { setOpen(false); setSubmitError(null); }}
                      data-testid="project-prep-create-agenda-cancel"
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}

/**
 * 后端真实信封原样回显——同 `template-apply-dialog.tsx` 的 `describeError` 纪律：
 * 只把契约 `createAgendaSegment.err` 里真有的码翻成人话，其余原样带 reasonCode，
 * 不在前端造一份错误语义的副本。
 */
function describeCreateError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.reasonCode === "PROJECT_ARCHIVED") {
      return "这个工作坊已归档，不能再新建议程环节（服务端 PROJECT_ARCHIVED）";
    }
    if (error.reasonCode === "PROJECT_ROLE_INSUFFICIENT" || error.reasonCode === "NO_PROJECT_ROLE") {
      return "你在这个工作坊里没有新建议程环节的权限";
    }
    return `${error.reasonCode ?? "无 reasonCode"}（HTTP ${error.status}）`;
  }
  if (error instanceof Error) return error.message;
  return "未知错误";
}

function RowGroup({ seg, roleKeys }: { seg: typeof AGENDA[number]; roleKeys: ProjectRole[] }) {
  return (
    <>
      <div className={`px-2.5 py-2.5 ${seg.current ? "bg-panel" : ""}`} data-testid={`agenda-segment-${seg.no}`}>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-10 text-muted-foreground">{seg.no}</span>
          <span className="font-medium">{seg.title}</span>
          {seg.current && <StatChip tone="ai">当前</StatChip>}
        </div>
        <div className="mt-0.5 text-10 text-muted-foreground">{seg.meta}</div>
      </div>
      {roleKeys.map((r) => (
        <div key={r} className={`px-2.5 py-2.5 text-muted-foreground ${seg.current ? "bg-panel" : ""}`}>
          {seg.roles[r as keyof typeof seg.roles]}
        </div>
      ))}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 flex-1 text-card-foreground">{v}</span>
    </div>
  );
}
