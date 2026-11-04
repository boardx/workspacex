import { EDITION_CAPABILITIES } from "@repo/contracts/deployment";

export const capabilityEditionNameKeys = {
  "cloud-models": "capabilityEdition.capability.cloud-models",
  "local-models": "capabilityEdition.capability.local-models",
  "mcp-egress": "capabilityEdition.capability.mcp-egress",
  "subagents": "capabilityEdition.capability.subagents",
  "collaboration": "capabilityEdition.capability.collaboration",
  "outbound-notifications": "capabilityEdition.capability.outbound-notifications",
  "image-generation": "capabilityEdition.capability.image-generation",
  "error-log-ai-summary": "capabilityEdition.capability.error-log-ai-summary",
  "audit-provenance": "capabilityEdition.capability.audit-provenance",
  "export-to-organization": "capabilityEdition.capability.export-to-organization",
  "offline": "capabilityEdition.capability.offline"
} as const;

// Chinese names are a projection of the contract, never a second copy of its matrix.
const authoredNames = Object.fromEntries(Object.entries(capabilityEditionNameKeys).map(([id, key]) => [key, EDITION_CAPABILITIES.find(row => row.id === id)?.capability ?? id])) as Record<(typeof capabilityEditionNameKeys)[keyof typeof capabilityEditionNameKeys], string>;

export const capabilityEditionZhCN = {
  ...authoredNames,
  "capabilityEdition.localTitle": "这台电脑上做不到的事",
  "capabilityEdition.title": "这个版次做不到的事",
  "capabilityEdition.localUnsupported": "本地版不支持",
  "capabilityEdition.unsupported": "本版次不支持",
  "capabilityEdition.localHint": "这些要连在线正式系统才行。本地版的数据和模型都在这台电脑上，这是代价的另一半。",
  "capabilityEdition.hint": "这些在当前版次里不可用。",
  "capabilityEdition.count": "{title}（{count} 项）",
  "capabilityEdition.count.one": "{title}（{count} 项）",
} as const;

export const capabilityEditionEn: Record<keyof typeof capabilityEditionZhCN, string> = {
  "capabilityEdition.localTitle": "Unavailable on this computer",
  "capabilityEdition.title": "Unavailable in this edition",
  "capabilityEdition.localUnsupported": "Not supported in the local edition",
  "capabilityEdition.unsupported": "Not supported in this edition",
  "capabilityEdition.localHint": "These capabilities require the online system. In the local edition, data and models stay on this computer.",
  "capabilityEdition.hint": "These capabilities are unavailable in the current edition.",
  "capabilityEdition.count": "{title} ({count} capabilities)",
  "capabilityEdition.count.one": "{title} ({count} capability)",
  "capabilityEdition.capability.cloud-models": "Cloud models (stronger reasoning and longer context)",
  "capabilityEdition.capability.local-models": "Bundled local models (offline, data stays local)",
  "capabilityEdition.capability.mcp-egress": "External MCP tools",
  "capabilityEdition.capability.subagents": "Subagents and deep research",
  "capabilityEdition.capability.collaboration": "Collaboration: invitations, sharing and cross-organization search",
  "capabilityEdition.capability.outbound-notifications": "Email and outbound notifications",
  "capabilityEdition.capability.image-generation": "Image generation",
  "capabilityEdition.capability.error-log-ai-summary": "AI summaries of system errors",
  "capabilityEdition.capability.audit-provenance": "Full audit and skill provenance ledger",
  "capabilityEdition.capability.export-to-organization": "Export local work to an organization",
  "capabilityEdition.capability.offline": "Offline use"
};
