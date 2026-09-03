/**
 * org-admin 能力域（组织与成员管理）UI 先行原型的 mock 数据
 *
 * 覆盖 UC-1.3（生成与撤销邀请链接）、UC-1.4（角色可见性判定）、UC-1.6（组织成员邀请与激活）。
 * UC-1.2（分组链接免注册进场）**已由 `components/entry/{join-form,group-workbench}` 画完**，
 * 不在此重画——见 `ui-preview/org-admin/README.md` 第五节。
 *
 * ⚠ 纯数据模块，**不带 `"use client"`**：同时被服务端页面与客户端子组件 import。
 * ⚠ 策略数值（邀请码位数 / 口令长度 / 重发冷却）一律从契约 `AUTH_POLICY` 读，**不写死**。
 *    CLAUDE.md：前端写死 14 / 12 会被 `single-source-of-truth.test.ts` 拦。
 *    密度参照 UC-1.3 R8「9/12 已确认」「48 位成员」等实测口径，不是三行假数据。
 *    没有任何真实手机号，手机号一律掩码（D-01：不完整展示）。
 */
import { AUTH_POLICY } from "@repo/contracts/auth";
import { PROJECT_ROLE_LABEL, ORG_ROLE_LABEL } from "@/lib/identity";
import type { ProjectRole, OrgRole } from "@/lib/identity";

export { AUTH_POLICY };
export { PROJECT_ROLE_LABEL, ORG_ROLE_LABEL };

/* ─────────────────────────── 屏切换 ─────────────────────────── */

export const ORG_ADMIN_SCREENS = [
  "invites", // UC-1.3 管理面 · 参与者与邀请
  "roster", //  UC-1.3 现场面 · 分组与签到
  "roles", //   UC-1.4 四视角切换器 + 角色说明条
  "grant", //   UC-1.4 临时提权授予 + 留痕
  "boundary", //UC-1.4 管理员边界 + 项目负责人侧「谁读过我的项目」
  "members", // UC-1.6 成员邀请与激活生命周期 + 团队增删改
  "activate", //UC-1.6 激活落地页（免登上下文）
] as const;
export type OrgAdminScreen = (typeof ORG_ADMIN_SCREENS)[number];

/**
 * 组织级屏（PROTOTYPE-FIDELITY-AUDIT-2.md 问题 1 复核，2026-08-11）—— **单一事实源**。
 *
 * `members`（UC-1.6 成员与配额）/ `activate`（UC-1.6 激活落地页）/ `boundary`（UC-1.4
 * 管理员边界）三屏是组织级：内容与「项目角色」（引导师/组长/组员/观察者）语义无关，
 * 原型这一区通篇没有任何项目角色命中。`org-admin-app.tsx` 的「视角」预览行、
 * `members-screen.tsx` 的权限门禁都从这张表判定是否该出现/该用哪层角色，
 * 不要在两处分别写字面量列表——那正是本仓踩过五次的「同一事实两处声明」。
 */
export const ORG_ADMIN_ORG_LEVEL_SCREENS = new Set<OrgAdminScreen>(["members", "activate", "boundary"]);

export const ORG_ADMIN_SCREEN_LABEL: Record<OrgAdminScreen, string> = {
  invites: "参与者与邀请",
  roster: "分组与签到",
  roles: "四视角判定",
  grant: "临时提权",
  boundary: "管理员边界",
  members: "成员与配额",
  activate: "激活落地页",
};

export const ORG_ADMIN_SCREEN_UC: Record<OrgAdminScreen, string> = {
  invites: "UC-1.3 载体一",
  roster: "UC-1.3 载体二",
  roles: "UC-1.4 载体一",
  grant: "UC-1.4 载体二",
  boundary: "UC-1.4 载体三",
  members: "UC-1.6",
  activate: "UC-1.6 R3-6a",
};

export function resolveOrgAdminScreen(raw: string | string[] | undefined): OrgAdminScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (ORG_ADMIN_SCREENS as readonly string[]).includes(v as string)
    ? (v as OrgAdminScreen)
    : "invites";
}

/* ─────────────── UC-1.3 · 身份四选 + 有效期三档（原型逐字） ─────────────── */

/**
 * 进场身份四选（UC-1.3 R7）——[已裁决 O-03]「协同引导师」= 引导师的展示别名，
 * 落库 `facilitator`，**不新增第五种项目角色**。界面文案须写明这一点。
 */
export const ENTRY_IDENTITIES: {
  key: ProjectRole;
  label: string;
  note?: string;
}[] = [
  { key: "member", label: "组员" },
  { key: "groupLead", label: "组长" },
  { key: "observer", label: "观察者（只读）" },
  {
    key: "facilitator",
    label: "协同引导师",
    note: "＝ 以引导师身份加入（O-03：不是低一档权限，落库即 facilitator）",
  },
];

/** 有效期三档（UC-1.3 R7 [原型]） */
export const LINK_EXPIRY = [
  { key: "24h", label: "24 小时" },
  { key: "7d", label: "7 天" },
  { key: "once", label: "一次性" },
] as const;
export type LinkExpiry = (typeof LINK_EXPIRY)[number]["key"];

/* ─────────────── UC-1.3 载体一 · 参与者与邀请 ─────────────── */

export type ParticipantStatus = "confirmed" | "invited";

export interface ParticipantRow {
  id: string;
  name: string;
  role: ProjectRole;
  /** 组号；观察者无组 */
  group: string | null;
  status: ParticipantStatus;
  /** 邀请已发未确认时的天数 */
  sentDays?: number;
}

/** 12 人名单，9 已确认（对齐 R8「9 / 12 已确认」）。含四选身份齐全。 */
export const PARTICIPANTS: ParticipantRow[] = [
  { id: "p-gl2", name: "高琳", role: "groupLead", group: "第 2 组", status: "confirmed" },
  { id: "p-wt", name: "吴桐", role: "member", group: "第 2 组", status: "confirmed" },
  { id: "p-zn", name: "周宁", role: "observer", group: null, status: "confirmed" },
  { id: "p-lw", name: "李维", role: "groupLead", group: "第 3 组", status: "confirmed" },
  { id: "p-zh", name: "郑好", role: "member", group: "第 3 组", status: "confirmed" },
  { id: "p-sd", name: "孙迪", role: "groupLead", group: "第 4 组", status: "confirmed" },
  { id: "p-lk", name: "林可", role: "facilitator", group: null, status: "confirmed" },
  { id: "p-cy", name: "程越", role: "member", group: "第 1 组", status: "confirmed" },
  { id: "p-hs", name: "何舒", role: "member", group: "第 1 组", status: "confirmed" },
  { id: "p-cm", name: "陈默", role: "member", group: "第 2 组", status: "invited", sentDays: 2 },
  { id: "p-yq", name: "叶青", role: "observer", group: null, status: "invited", sentDays: 1 },
  { id: "p-ff", name: "范帆", role: "member", group: "第 4 组", status: "invited", sentDays: 3 },
];

export const PARTICIPANT_CONFIRMED = PARTICIPANTS.filter((p) => p.status === "confirmed").length;
export const PARTICIPANT_TOTAL = PARTICIPANTS.length;

/** 主链接与邀请码（UC-1.3 R8 逐字）——码是展示样本，位数口径由 AUTH_POLICY.inviteCodeLength 决定 */
export const MAIN_LINK = "wsx.app/w/kickoff-8f21?r=member";
export const INVITE_CODE = "KCK-8F21-EU24";

/* ── 分组链接（O-06：统一带一次性令牌，记录使用者） ── */

export type GroupLinkStatus = "valid" | "revoked" | "expired" | "used";
export const GROUP_LINK_STATUS_LABEL: Record<GroupLinkStatus, string> = {
  valid: "有效",
  revoked: "已撤销",
  expired: "已过期",
  used: "一次性 · 已使用",
};

export interface GroupLink {
  groupNo: number;
  groupName: string;
  /** O-06：链接携带项目 + 组号 + 角色 + 令牌四元 */
  url: string;
  expiry: LinkExpiry;
  status: GroupLinkStatus;
  /** 一次性令牌被使用后的使用者记录（used_by），R7/V4；一次性未用或非一次性为 null */
  usedBy?: { name: string; at: string } | null;
}

export const GROUP_LINKS: GroupLink[] = [
  { groupNo: 1, groupName: "第 1 组 · 业主首次评估储能投资", url: "wsx.app/w/kickoff-8f21/g/1?t=9f21-a7", expiry: "24h", status: "valid", usedBy: null },
  { groupNo: 2, groupName: "第 2 组 · 采购委员会比选供应商", url: "wsx.app/w/kickoff-8f21/g/2?t=9f21-b3", expiry: "24h", status: "valid", usedBy: null },
  { groupNo: 3, groupName: "第 3 组 · 并网审批与施工协调", url: "wsx.app/w/kickoff-8f21/g/3?t=9f21-c9", expiry: "once", status: "used", usedBy: { name: "郑好", at: "今天 09:12" } },
  { groupNo: 4, groupName: "第 4 组 · 运营期收益归因与售后", url: "wsx.app/w/kickoff-8f21/g/4?t=9f21-d1", expiry: "24h", status: "revoked", usedBy: null },
];

/* ─────────────── UC-1.3 载体二 · 分组与签到（现场面） ─────────────── */

export type AttendState = "lead" | "present" | "absent";
export const ATTEND_LABEL: Record<AttendState, string> = {
  lead: "组长",
  present: "已到",
  absent: "未到",
};

export interface RosterMember {
  name: string;
  state: AttendState;
}
export interface RosterGroup {
  groupNo: number;
  title: string;
  present: number;
  total: number;
  members: RosterMember[];
}

export const ROSTER: RosterGroup[] = [
  {
    groupNo: 1, title: "第 1 组 · 业主首次评估储能投资", present: 3, total: 3,
    members: [{ name: "周宁", state: "lead" }, { name: "吴桐", state: "present" }, { name: "李维", state: "present" }],
  },
  {
    groupNo: 2, title: "第 2 组 · 采购委员会比选供应商", present: 1, total: 2,
    members: [{ name: "高琳", state: "lead" }, { name: "陈默", state: "absent" }],
  },
  {
    groupNo: 3, title: "第 3 组 · 并网审批与施工协调", present: 2, total: 3,
    members: [{ name: "李维", state: "lead" }, { name: "郑好", state: "present" }, { name: "孙迪", state: "absent" }],
  },
  {
    groupNo: 4, title: "第 4 组 · 运营期收益归因与售后", present: 3, total: 3,
    members: [{ name: "孙迪", state: "lead" }, { name: "郑好", state: "present" }, { name: "吴桐", state: "present" }],
  },
];
export const ROSTER_PRESENT = ROSTER.reduce((n, g) => n + g.present, 0);
export const ROSTER_TOTAL = ROSTER.reduce((n, g) => n + g.total, 0);

/* ─────────────── UC-1.4 · 四视角（原型逐字权限说明 + 独有按钮） ─────────────── */

export interface RoleView {
  role: ProjectRole;
  /** 状态标（可发言 / 只读） */
  statusTag: string;
  /** 权限说明原文（R5/R8 逐字，界面上直接可见） */
  statement: string;
  /** 该视角独有的可执行动作端点（观察者为空集） */
  buttons: string[];
}

export const ROLE_VIEWS: RoleView[] = [
  {
    role: "facilitator", statusTag: "可发言",
    statement: "同一个界面，你有全部权限：四组对话、原始转写、切环节与介入。",
    buttons: ["切环节", "介入任意组", "看原始转写", "全场广播"],
  },
  {
    role: "groupLead", statusTag: "可发言",
    statement: "你能看第 2 组的全部对话与组员私聊，能提交本组产出；别组内容与全场控制不可见。",
    buttons: ["向引导师举手", "提交本组产出"],
  },
  {
    role: "member", statusTag: "可发言",
    statement: "你能看第 2 组的共享内容与自己的对话；别组内容、组员私聊与全场控制不可见。",
    buttons: ["举手"],
  },
  {
    role: "observer", statusTag: "只读",
    statement: "只读：已发布产出与脱敏聚合可见；原始转写、私聊与任何操作按钮都关掉了。",
    buttons: [], // ⚠ 按钮集为空——AC3 可验收断言，不是「还没设计」
  },
];

export function roleViewOf(role: ProjectRole): RoleView {
  return ROLE_VIEWS.find((v) => v.role === role) ?? ROLE_VIEWS[0]!;
}

/** 概览页三行角色态（原型，按角色投影） */
export const OVERVIEW_ROLE_LINES = [
  { who: "引导师(你)", line: "第 4 组落后，建议去看看", action: "去主持", role: "facilitator" as ProjectRole },
  { who: "4 位组长", line: "补齐必填分区并提交本组产出", action: "组长视角", role: "groupLead" as ProjectRole },
  { who: "12 位组员", line: "每人至少 1 张便签，投票 10/12 已投", action: "组员视角", role: "member" as ProjectRole },
];

/** 顶部角色说明条的两层身份样例（R5：组织角色 × 项目角色，UC-0.3 R8） */
export const ROLE_BAR = {
  orgRole: "consultant" as OrgRole,
  projectRole: "groupLead" as ProjectRole,
  group: "第 2 组",
};

/* ─────────────── UC-1.4 载体二 · 临时提权 + 留痕 ─────────────── */

export interface GrantRecord {
  time: string;
  grantee: string;
  /** 追加在既有项目角色之上的临时读权 */
  grant: string;
  /** 失效条件：流程节点（不是时间点） */
  expiresOn: string;
  state: "active" | "expired";
}

export const GRANT_RECORDS: GrantRecord[] = [
  {
    time: "09:41:07", grantee: "客户方 王毅",
    grant: "「观察者」＋ 第 2 组原始内容临时读权",
    expiresOn: "环节 3 结束自动失效", state: "active",
  },
  {
    time: "昨天 15:22", grantee: "顾问 吴桐",
    grant: "第 4 组原始转写临时读权",
    expiresOn: "环节 5 结束自动失效（已失效）", state: "expired",
  },
];

/** 授予入口的候选（选人 → 选资源 → 选失效环节） */
export const GRANT_PEOPLE = ["客户方 王毅", "客户方 赵敏", "顾问 吴桐", "观察者 周宁"];
export const GRANT_RESOURCES = ["第 2 组原始内容", "第 3 组原始转写", "第 4 组组员私聊", "全场原始转写"];
export const GRANT_SEGMENTS = ["环节 3 · 假设风暴", "环节 4 · 旅程图", "环节 5 · 收敛", "环节 6 · 产出评审", "环节 7 · 收尾"];

/* ─────────────── UC-1.4 载体三 · 管理员边界（D-18） ─────────────── */

/** 个人层：管理员只见计数，内容不可见（I-8 / D-18 ①） */
export const PERSONAL_LAYER_COUNTS = [
  { name: "林可", count: 34 },
  { name: "高琳", count: 12 },
  { name: "吴桐", count: 7 },
  { name: "周宁", count: 21 },
];

export const ADMIN_PROJECT_ACCESS = {
  thisMonth: 3, // 本月访问过 3 个项目（项目层可读但留痕）
};

/** 项目负责人侧「谁读过我的项目」（D-18 ②「对项目负责人可见」，原型未画，本次补） */
export interface AdminAccessLog {
  time: string;
  admin: string;
  project: string;
  purpose: string;
}
export const WHO_READ_MY_PROJECT: AdminAccessLog[] = [
  { time: "今天 10:03", admin: "管理员 高琳", project: "欧洲市场进入 Kickoff", purpose: "审计目的 · 抽查机密材料脱敏" },
  { time: "昨天 16:40", admin: "管理员 高琳", project: "欧洲市场进入 Kickoff", purpose: "审计目的 · 复核受访者同意书" },
  { time: "3 天前 09:15", admin: "管理员 郑昊", project: "并网审批调研", purpose: "审计目的 · 配额争议核查" },
];

/* ─────────────── UC-1.6 · 组织成员邀请与激活 ─────────────── */

export const TEAMS = ["能源组", "平台组", "供应链组"] as const;
export type Team = (typeof TEAMS)[number];

export const ORG_ROLES_INVITABLE: OrgRole[] = ["admin", "lead", "consultant"];

export type MemberStatus = "active" | "pending" | "send-failed" | "revoked" | "expired";
export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  active: "已激活",
  pending: "待接受邀请",
  "send-failed": "发送失败",
  revoked: "已撤销",
  expired: "已过期",
};

export interface OrgMemberRow {
  id: string;
  name: string;
  role: OrgRole;
  team: Team;
  /** 本月配额使用（M tokens）—— 非本用例负责列，但要显示以还原真实密度 */
  usedM: number;
  limitM: number;
  status: MemberStatus;
  /** 待接受时的已发送天数 */
  sentDays?: number;
  /**
   * 客户方外部标记（PROTOTYPE-FIDELITY-AUDIT-2.md 问题 1 复核，2026-08-11）。
   *
   * 原型里「客户方」是一种看得见的身份（如「客户方 · 只读协作」），agent 早先把它
   * 压平成纯 `consultant`（顾问），外部标记信息在界面上消失了。sign-off 需裁三选一：
   * ①「客户方」升级为第五种组织角色 ②「顾问 + 外部标记」③纯项目侧观察者（不落组织层）。
   * 在人类裁决前按更保守、影响面更小的②处理：**不改 `OrgRole` 契约**（那是数据库/API
   * 的事），只在这个纯前端展示字段上加一个可选布尔位，界面加一个「客户方」标签。
   * 若日后裁决是①，再把这个字段升级为契约枚举值，此处的 `true` 就是迁移种子。
   */
  external?: boolean;
}

/** 8 行样例（组织实际 48 人，顶部计数体现），覆盖五种邀请状态 */
export const ORG_MEMBERS: OrgMemberRow[] = [
  { id: "m-lk", name: "林可", role: "lead", team: "能源组", usedM: 2.9, limitM: 4.0, status: "active" },
  { id: "m-wt", name: "吴桐", role: "consultant", team: "能源组", usedM: 3.9, limitM: 4.0, status: "active" },
  { id: "m-gl", name: "高琳", role: "admin", team: "平台组", usedM: 1.8, limitM: 4.0, status: "active" },
  // 周宁：原型标注为「客户方 · 只读协作」——顾问 + 外部标记，见 OrgMemberRow.external 注释
  { id: "m-zn", name: "周宁", role: "consultant", team: "平台组", usedM: 2.2, limitM: 4.0, status: "active", external: true },
  { id: "m-cm", name: "陈默", role: "consultant", team: "供应链组", usedM: 0, limitM: 2.0, status: "pending", sentDays: 2 },
  { id: "m-yq", name: "叶青", role: "consultant", team: "供应链组", usedM: 0, limitM: 2.0, status: "send-failed" },
  { id: "m-zh", name: "郑昊", role: "lead", team: "供应链组", usedM: 0, limitM: 3.0, status: "expired", sentDays: 9 },
  { id: "m-ff", name: "范帆", role: "consultant", team: "平台组", usedM: 0, limitM: 2.0, status: "revoked" },
];

export const ORG_MEMBER_TOTAL = 48; // 名册总数（R8「48 位成员」）
export const ORG_MEMBER_ACTIVE = 41; // 活跃成员（R8「活跃成员 41/48」，待激活不计入）

/** 配额总览（R8 逐字）——本用例只在「配额用尽硬阻断」时消费未分配额度 */
export const QUOTA_OVERVIEW = {
  allocatedM: 5400,
  allocatedPct: 87,
  unallocatedM: 800, // 未分配额度；O-29 ⑤：用尽即硬阻断新邀请
};

/**
 * 邀请管理员的双人复核待批队列（O-28 ⑥）——发起人不可自批。
 * 组织内仅一名管理员时转「待平台运营方协助」而非退化为单人可批。
 */
export interface AdminApprovalPending {
  id: string;
  email: string;
  requestedBy: string;
  at: string;
}
export const ADMIN_APPROVAL_QUEUE: AdminApprovalPending[] = [
  { id: "ap-1", email: "z•••@yuanyang.cn", requestedBy: "管理员 高琳", at: "今天 11:20" },
];

/** 激活落地页上下文（R3-6a）——链接携带组织+角色，以服务端为准（篡改无效） */
export const ACTIVATION_CONTEXT = {
  orgName: "远洋新能源",
  role: "consultant" as OrgRole,
  maskedEmail: "c•••@partner-scm.cn",
  linkValidDays: 7, // O-28 ④：组织成员激活链接 7 天（⚠ 该值尚未收敛进 AUTH_POLICY，见 README §2）
};

// issue #2615 裁决②（组织中去掉团队的概念）之后，`TeamRow`/`TEAM_ROWS`（团队增删改
// 列表，O-29 ④）已随 `components/org-admin/members-screen.tsx` 的团队区块一并撤除——
// 它们只服务于那个已删除的区块，没有其它消费方，见该文件头注。
