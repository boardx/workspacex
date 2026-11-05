import { LOCAL_ORG_GUARANTEES, LOCAL_RUNTIME_STARTUP_HINT, localOrgCloudDisabledReason, localExportUnvettedNote } from "@/lib/identity";

// Display projection only. Canonical promises, identifiers and endpoint rules stay in contracts.
export const localOrgZhCN = {
  "localOrg.module": "本地组织",
  "localOrg.title": "我的本地",
  "localOrg.intro": "这个组织只有你一个人，且它的数据不出本机。以下三条是产品承诺，不是可配置项——任何接口都改不动它们。",
  "localOrg.empty": "本机还没有可用的本地模型，先在本机启动推理运行时",
  "localOrg.denial": "本地组织只对它的所有者可见——组织管理员与平台运营都看不到，这比「个人层对管理员封闭」更强：数据根本不在他们的组织里。",
  "localOrg.success": "本地模型调用完成，本次未产生任何出网流量",
  "localOrg.guarantees": "三条硬隔离",
  "localOrg.commitment": "产品承诺 · 不可关闭",
  "localOrg.self": "我",
  "localOrg.membershipError": "你不是该组织的成员。",
  "localOrg.localOnlyError": "此操作仅适用于本地组织。",
  "localOrg.members": "成员",
  "localOrg.owner": "所有者",
  "localOrg.models": "可用模型",
  "localOrg.endpointRule": "· 端点不在本机的整行禁用",
  "localOrg.onDevice": "本机",
  "localOrg.runtime": "本地运行时",
  "localOrg.loading": "读取中…",
  "localOrg.disabled": "已禁用",
  "localOrg.memberCount": "· 共 {count} 人",
  "localOrg.noInvite": "本地组织恒为单人，因此没有邀请入口。需要多人协作又要求不出网的场景，请用私有部署的正式组织并把模型策略设为「只用自托管模型」——那是可配置策略，与这里的承诺不同。",
  "localOrg.loadFailed": "读不到本地组织（{error}）。这里不退回示例数据——显示假清单会让人以为模型已经配好了。",
  "localOrg.modelsEmpty": "这个组织还没有配置任何模型。产品不提供内置默认清单——先在本机启动推理运行时并把它登记为组织能力。",
  "localOrg.noEndpoint": "这条能力没有端点，无法确认它只在本机运行。",
  "localOrg.cloudDisabledReason": localOrgCloudDisabledReason("{endpoint}").replace(LOCAL_ORG_GUARANTEES[0].statement, "{guarantee}"),
  "localOrg.ready": "已就绪",
  "localOrg.notReady": "未就绪",
  "localOrg.exportTitle": "导出到正式组织",
  "localOrg.exportException": "承诺的唯一豁口",
  "localOrg.exportDemo": "演示态",
  "localOrg.exportOnDevice": "本机",
  "localOrg.exportPreviewHeading": "以下内容会离开本机",
  "localOrg.exportViewers": "进入后可读：",
  "localOrg.exportDemoNotice": "下面这三步是流程演示：列出的成果是样例数据，点「确认导出」不会真的把任何东西送去正式组织，也不会产生审计记录。真正的导出通道还没实现。现在要把本机的成果带走，请在产出上用「下载」保存到本地，再到在线系统里上传。",
  "localOrg.exportIntro": "这是本地组织里唯一一条会让数据离开本机的路径。它只能由你手动发起一次——没有自动同步，没有后台上传，没有定时推送。导出是复制：本地的原件仍然留在本机。反过来把正式组织的数据导入本地组织是不可能的，产品里没有这个操作。",
  "localOrg.exportPreview": "预览将离开本机的内容",
  "localOrg.exportConfirm": "确认导出",
  "localOrg.exportGate": "需要先预览并确认——预览有效期 {minutes} 分钟，且只能用一次。",
  "localOrg.exportNotePrefix": "目标组织里的条目会带上这条标注：",
  "localOrg.exportUnvettedNote": localExportUnvettedNote("{owner}"),
  "localOrg.exportDone": "演示完成：已选择 {count} 件",
  "localOrg.exportCopy": "本地副本仍在本机——这是复制，不是迁移。",
  "localOrg.exportTrace": "演示审计记录：本地 {local} · 目标 {target}（未产生真实记录）",
  "localOrg.guarantee.local-model-only": LOCAL_ORG_GUARANTEES.find((guarantee) => guarantee.id === "local-model-only")!.statement,
  "localOrg.guarantee.no-mcp-egress": LOCAL_ORG_GUARANTEES.find((guarantee) => guarantee.id === "no-mcp-egress")!.statement,
  "localOrg.guarantee.no-shared-storage": LOCAL_ORG_GUARANTEES.find((guarantee) => guarantee.id === "no-shared-storage")!.statement,
  "localOrg.startupHint": LOCAL_RUNTIME_STARTUP_HINT,
} as const;

export const localOrgEn = {
  "localOrg.module": "Local organization",
  "localOrg.title": "My local workspace",
  "localOrg.intro": "This organization has only you, and its data stays on this machine. These three guarantees are product commitments, not settings: no API can change them.",
  "localOrg.empty": "No local model is available yet. Start an inference runtime on this machine first.",
  "localOrg.denial": "Only the owner can see this local organization. Organization administrators and platform operators cannot see it. This goes beyond keeping personal data hidden from administrators: the data is not in their organization at all.",
  "localOrg.success": "Local model call completed with no outbound network traffic.",
  "localOrg.guarantees": "Three isolation guarantees",
  "localOrg.commitment": "Product commitments · cannot be disabled",
  "localOrg.self": "Me",
  "localOrg.membershipError": "You are not a member of this organization.",
  "localOrg.localOnlyError": "This operation is only available for local organizations.",
  "localOrg.members": "Members",
  "localOrg.owner": "Owner",
  "localOrg.models": "Available models",
  "localOrg.endpointRule": "· Entries with non-local endpoints are disabled",
  "localOrg.onDevice": "On this machine",
  "localOrg.runtime": "Local runtime",
  "localOrg.loading": "Loading…",
  "localOrg.disabled": "Disabled",
  "localOrg.memberCount": "· {count} member",
  "localOrg.noInvite": "Local organizations always have one member, so there is no invite option. For collaboration without outbound traffic, use a privately deployed organization and set its model policy to “Self-hosted models only”. That is a configurable policy, separate from these guarantees.",
  "localOrg.loadFailed": "Could not load the local organization ({error}). No sample data is substituted: a fictional list could imply that models are already configured.",
  "localOrg.modelsEmpty": "No models are configured for this organization. There is no built-in default list. Start an inference runtime on this machine and register it as an organization capability first.",
  "localOrg.noEndpoint": "This capability has no endpoint, so it cannot be confirmed to run only on this machine.",
  "localOrg.cloudDisabledReason": "Local organization commitment: {guarantee}. This entry’s endpoint ({endpoint}) is not on this machine, so the whole entry is disabled. This is not an administrator setting; no API can change it.",
  "localOrg.ready": "Ready",
  "localOrg.notReady": "Not ready",
  "localOrg.exportTitle": "Export to an organization",
  "localOrg.exportException": "The only exception to these guarantees",
  "localOrg.exportDemo": "Demo",
  "localOrg.exportOnDevice": "On this machine",
  "localOrg.exportPreviewHeading": "These items would leave this machine",
  "localOrg.exportViewers": "Readable after export by:",
  "localOrg.exportDemoNotice": "The three steps below are a workflow demo. Listed artifacts are sample data. “Confirm export” does not send anything to an organization or create audit records. The actual export channel is not implemented. To move a local artifact now, download it to this machine, then upload it to the online system.",
  "localOrg.exportIntro": "This is the local organization’s only path for data to leave this machine. Each export must be started manually by you: no automatic sync, background uploads or scheduled delivery. Export copies data; the originals stay here. Importing organization data back into a local organization is not supported.",
  "localOrg.exportPreview": "Preview items leaving this machine",
  "localOrg.exportConfirm": "Confirm export",
  "localOrg.exportGate": "Preview and confirm first. A preview is valid for {minutes} minutes and can be used only once.",
  "localOrg.exportNotePrefix": "Entries in the target organization would carry this note: ",
  "localOrg.exportUnvettedNote": "From member {owner}’s local organization; not reviewed for admission by this organization. This is a one-time export explicitly initiated by that member, not an output of this organization’s admission process.",
  "localOrg.exportDone": "Demo complete: {count} items selected",
  "localOrg.exportCopy": "Local copies stay on this machine: export copies rather than moves them.",
  "localOrg.exportTrace": "Demo audit records: local {local} · target {target} (no real records created)",
  "localOrg.guarantee.local-model-only": "Model calls use only local / self-hosted endpoints; cloud models cannot be selected here",
  "localOrg.guarantee.no-mcp-egress": "All outbound MCP calls are prohibited",
  "localOrg.guarantee.no-shared-storage": "Data stays within the local deployment, outside shared object storage and cross-organization indexes",
  "localOrg.startupHint": "The local inference runtime is not ready. Start it on this machine (default endpoint {endpoint}), then retry. The system will not switch to cloud models for you: that would violate the local organization’s product commitments.",
} as const satisfies Record<keyof typeof localOrgZhCN, string>;

type GuaranteeId = (typeof LOCAL_ORG_GUARANTEES)[number]["id"];
export function localOrgGuaranteeKey(id: GuaranteeId): `localOrg.guarantee.${GuaranteeId}` {
  return `localOrg.guarantee.${id}`;
}

type LocalOrgTranslate = (key: keyof typeof localOrgZhCN, params?: Record<string, string | number>) => string;

/** Translate only the canonical system hint. Unknown server guidance remains verbatim. */
export function localOrgStartupHint(t: LocalOrgTranslate, hint: string): string {
  if (hint !== LOCAL_RUNTIME_STARTUP_HINT) return hint;
  // Extract a display parameter from the single canonical hint; never create a runtime default.
  const endpoint = LOCAL_RUNTIME_STARTUP_HINT.match(/https?:\/\/[^\s）]+/u)?.[0];
  return endpoint ? t("localOrg.startupHint", { endpoint }) : hint;
}
