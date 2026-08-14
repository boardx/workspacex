/**
 * 审计事件类型的中文标签（#1182，活动流用）。
 *
 * ## 这是展示层，不是第二份事实源
 *
 * `ProvenanceEventType` 的**取值**只有契约一处（`packages/contracts/src/provenance.ts`）。
 * 这里给的是「给人看的那句话」，与取值本身是两件东西——同 `AGENT_STATUS_LABEL` 的先例。
 *
 * ⚠ **但它必须对枚举穷尽**，而且穷尽这件事要机械守着，理由很具体：
 *   漏一个类型，那一行就渲染成空白，而**空白在审计流里读作「这条没事发生」**。
 *   契约加了新类型而这里没跟上，是个静默的错——所以 `Record<ProvenanceEventType, string>`
 *   的类型约束（编译期）+ `provenance-labels.test.ts` 的逐值断言（运行期）各守一道。
 *   类型约束单独不够：`as` 一下就绕过去了，而 CI 只跑 tsc 不跑人眼。
 */
import type { ProvenanceEventType } from "./live-provenance";

export const PROVENANCE_EVENT_LABEL: Record<ProvenanceEventType, string> = {
  /* artifact 束：血缘 */
  ingested: "摄取了材料",
  transformed: "转换了材料（OCR / ASR / 摘要 / 向量化）",
  generated: "用 AI 生成了内容",
  "human-edited": "人工编辑了草稿",
  pinned: "定版了一个版本",
  bound: "把材料绑定到项目环节",
  unbound: "解绑了材料与项目环节",
  superseded: "用新版本替代了旧版本",
  "evidence-withdrawn": "撤回了上游证据",
  downloaded: "下载了原件",

  /* identity 束：治理 */
  "capability-added": "新增了一项组织能力",
  "capability-updated": "修改了一项组织能力的配置",
  "capability-disabled": "停用了一项组织能力",
  "role-changed": "变更了角色",
  "team-changed": "变更了团队归属",
  "admin-project-access": "以审计目的读取了项目内容（已留痕）",
  "local-export": "把本地组织的内容导出到正式组织",
  "profile-renamed": "改了自己的显示名",
  "avatar-changed": "换了头像",
  "password-changed": "改了密码",
  "team-created": "新建了团队",
  "team-renamed": "重命名了团队",
  "team-deleted": "删除了团队",

  /* project / chat / 治理补齐（ADR-101） */
  "project-created": "新建了项目",
  "project-archived": "归档了项目",
  "project-unarchived": "取消归档了项目",
  "agenda-segment-state-changed": "推进了议程环节的状态",
  "thread-created": "新建了对话",
  "thread-renamed": "重命名了对话",
  "thread-deleted": "删除了对话",
  "integrity-check-failed": "完整性校验未通过",
  "contact-revealed": "查看了联系人信息",
  "approval-requested": "发起了一次审批",
  "approval-decided": "裁决了一次审批",
  "deletion-requested": "提出了删除请求",
  "asset-published": "发布了一个资产",
  "review-accepted": "评审通过",
  "review-rejected": "评审驳回",
  "legal-hold-applied": "施加了法务保全",
  "legal-hold-released": "解除了法务保全",

  /* 安全 */
  "unauthorized-attempt": "越权尝试被拦截",
};
