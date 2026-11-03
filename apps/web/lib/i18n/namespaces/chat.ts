import { chatEntryEn, chatEntryZhCN } from "./chat-entry";
import { chatErrorsEn, chatErrorsZhCN } from "./chat-errors";
import { chatComposerEn, chatComposerZhCN } from "./chat-composer";
import { chatPickerEn, chatPickerZhCN } from "./chat-picker";

export const chatZhCN = { ...chatEntryZhCN, ...chatErrorsZhCN, ...chatComposerZhCN, ...chatPickerZhCN } as const;
export const chatEn: Record<keyof typeof chatZhCN, string> = { ...chatEntryEn, ...chatErrorsEn, ...chatComposerEn, ...chatPickerEn };
