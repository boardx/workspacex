"use client";
import { useI18n } from "./provider";
import type { MessageKey, MessageParams } from "./messages";
export function I18nText({ message, params }: { message: MessageKey; params?: MessageParams }) { return useI18n().t(message, params); }
