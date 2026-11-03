import { chatEntryEn, chatEntryZhCN } from "./chat-entry";
import { chatErrorsEn, chatErrorsZhCN } from "./chat-errors";
import { chatComposerEn, chatComposerZhCN } from "./chat-composer";
import { chatPickerEn, chatPickerZhCN } from "./chat-picker";

import { chatAttachmentsEn, chatAttachmentsZhCN } from "./chat-attachments";

import { chatRealtimeEn, chatRealtimeZhCN } from "./chat-realtime";

import { chatSkillsEn, chatSkillsZhCN } from "./chat-skills";

import { chatMessageFailuresEn, chatMessageFailuresZhCN } from "./chat-message-failures";

export const chatZhCN = { ...chatEntryZhCN, ...chatErrorsZhCN, ...chatComposerZhCN, ...chatPickerZhCN, ...chatAttachmentsZhCN, ...chatRealtimeZhCN, ...chatSkillsZhCN, ...chatMessageFailuresZhCN } as const;
export const chatEn: Record<keyof typeof chatZhCN, string> = { ...chatEntryEn, ...chatErrorsEn, ...chatComposerEn, ...chatPickerEn, ...chatAttachmentsEn, ...chatRealtimeEn, ...chatSkillsEn, ...chatMessageFailuresEn };
