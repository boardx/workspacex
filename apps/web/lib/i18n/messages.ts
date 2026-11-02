import { zhCN } from "./messages/zh-CN";
import { en } from "./messages/en";
import type { Locale } from "./locale";
export type MessageKey = keyof typeof zhCN;
export type MessageParams = Record<string, string | number>;
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const message = (locale === "en" ? en[key] : zhCN[key]) || zhCN[key];
  // Replace once; replacement text is never parsed as a second template.
  return message.replace(/\{(\w+)\}/g, (token, name: string) => params?.[name] === undefined ? token : String(params[name]));
}
