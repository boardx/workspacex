import { artifactVersionsEn, artifactVersionsZhCN } from "./artifact-versions";
import { capabilityEditionEn, capabilityEditionZhCN } from "./capability-edition";
import { chatKnowledgeEn, chatKnowledgeZhCN } from "./chat-knowledge";
import { chatRosterEn, chatRosterZhCN } from "./chat-roster";
import { feedbackOverlayEn, feedbackOverlayZhCN } from "./feedback-overlay";
import { chatInspectorEn, chatInspectorZhCN } from "./chat-inspector";
import { chatLandingEn, chatLandingZhCN } from "./chat-landing";
import { chatEscalationEn, chatEscalationZhCN } from "./chat-escalation";
import { chatRunsEn, chatRunsZhCN } from "./chat-runs";
import { chatToolsEn, chatToolsZhCN } from "./chat-tools";
import { chatTraceEn, chatTraceZhCN } from "./chat-trace";
import { chatRestoredApprovalEn, chatRestoredApprovalZhCN } from "./chat-restored-approval";
import { chatInterruptsEn, chatInterruptsZhCN } from "./chat-interrupts";
import { chatEntryEn, chatEntryZhCN } from "./chat-entry";
import { chatErrorsEn, chatErrorsZhCN } from "./chat-errors";
import { chatComposerEn, chatComposerZhCN } from "./chat-composer";
import { chatPickerEn, chatPickerZhCN } from "./chat-picker";

import { chatAttachmentsEn, chatAttachmentsZhCN } from "./chat-attachments";

import { chatRealtimeEn, chatRealtimeZhCN } from "./chat-realtime";

import { chatSkillsEn, chatSkillsZhCN } from "./chat-skills";

import { chatMessageFailuresEn, chatMessageFailuresZhCN } from "./chat-message-failures";

import { chatInteractionsEn, chatInteractionsZhCN } from "./chat-interactions";
import { chatPermissionsEn, chatPermissionsZhCN } from "./chat-permissions";

export const chatZhCN = {
  ...artifactVersionsZhCN,
  ...capabilityEditionZhCN,
  ...chatKnowledgeZhCN,
  ...chatRosterZhCN,
  ...feedbackOverlayZhCN,
  ...chatInspectorZhCN,
  ...chatEntryZhCN,
  ...chatErrorsZhCN,
  ...chatComposerZhCN,
  ...chatPickerZhCN,
  ...chatAttachmentsZhCN,
  ...chatRealtimeZhCN,
  ...chatSkillsZhCN,
  ...chatMessageFailuresZhCN,
  ...chatInteractionsZhCN,
  ...chatPermissionsZhCN,
  ...chatInterruptsZhCN,
  ...chatRestoredApprovalZhCN,
  ...chatTraceZhCN,
  ...chatToolsZhCN,
  ...chatRunsZhCN,
  ...chatEscalationZhCN,
  ...chatLandingZhCN,
} as const;
export const chatEn: Record<keyof typeof chatZhCN, string> = {
  ...artifactVersionsEn,
  ...capabilityEditionEn,
  ...chatKnowledgeEn,
  ...chatRosterEn,
  ...feedbackOverlayEn,
  ...chatInspectorEn,
  ...chatEntryEn,
  ...chatErrorsEn,
  ...chatComposerEn,
  ...chatPickerEn,
  ...chatAttachmentsEn,
  ...chatRealtimeEn,
  ...chatSkillsEn,
  ...chatMessageFailuresEn,
  ...chatInteractionsEn,
  ...chatPermissionsEn,
  ...chatInterruptsEn,
  ...chatRestoredApprovalEn,
  ...chatTraceEn,
  ...chatToolsEn,
  ...chatRunsEn,
  ...chatEscalationEn,
  ...chatLandingEn,
};
