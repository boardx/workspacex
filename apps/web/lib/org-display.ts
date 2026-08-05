/**
 * 组织名称的**展示文案单一事实源**（#596）。
 *
 * ## 为什么这是一个模块而不是三处 `?? orgId`
 * 修这个 bug 之前，界面上有三处写着 `identity?.org.name ?? orgId`，外加组织切换器里
 * `id === 当前组织 ? name : id` —— 拿不到名字时一律**回落成裸组织 ID**
 * （`org-2e5de17f74b8731f` / `org-local-<uuid>`）。人类在 devapp 上看到的就是它。
 *
 * ⚠ 裸 ID 是**「看起来像数据的错误」，比空态更糟**：用户没有任何线索判断这是加载中、
 * 是坏了、还是他真的把组织命名成了这串十六进制。所以「名字还没到」必须显示成
 * **一句话**，而不是一个恰好也是字符串的内部标识符。
 *
 * ⚠ 组织 ID 本身仍然可以显示（后台页面就在名称下面单独列 `组织 ID xxx`）——
 * 被禁止的是**拿 ID 冒充名称**。
 */

/** 名称尚在解析中（`GET /identity/me?orgId=` 还没回来）。 */
export const ORG_NAME_PENDING_LABEL = "组织名称加载中…";
/** 名称解析失败（该组织的 `/identity/me` 报错）。不重试是刻意的：错误要看得见。 */
export const ORG_NAME_UNAVAILABLE_LABEL = "组织名称暂不可用";

export type OrgNameStatus = "loading" | "ready" | "unavailable";

export interface OrganizationSummary {
  readonly id: string;
  /** 服务端返回的真实 `organizations.name`；未解析到时为 `null`。**永远不会**是 id。 */
  readonly name: string | null;
  readonly nameStatus: OrgNameStatus;
}

/** 任何要把组织显示给人看的地方都走这里。 */
export function organizationLabel(org: OrganizationSummary): string {
  if (org.nameStatus === "ready" && org.name !== null) return org.name;
  return org.nameStatus === "unavailable" ? ORG_NAME_UNAVAILABLE_LABEL : ORG_NAME_PENDING_LABEL;
}

/**
 * 只知道「当前组织的名字或者没有」的调用点（后台页面头部）用这个。
 * `name` 为 null/undefined = 身份还没就绪 ⇒ 加载态文案，**不是** id。
 */
export function currentOrganizationLabel(name: string | null | undefined): string {
  return name != null && name !== "" ? name : ORG_NAME_PENDING_LABEL;
}
