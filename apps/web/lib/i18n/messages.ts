import { zhCN } from "./messages/zh-CN";
import { en } from "./messages/en";
import type { Locale } from "./locale";
export type MessageKey = keyof typeof zhCN;
export type MessageParams = Record<string, string | number>;
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const dictionary = locale === "en" ? en : zhCN;
  const count = params?.count;
  const variant = typeof count === "number" && Number.isFinite(count)
    ? `${key}.${new Intl.PluralRules(locale).select(count)}` : key;
  const resolved = Object.hasOwn(dictionary, variant) ? variant as MessageKey : key;
  const message = dictionary[resolved] || zhCN[resolved];
  // Replace once; replacement text is never parsed as a second template.
  return message.replace(/\{(\w+)\}/g, (token, name: string) => params?.[name] === undefined ? token : String(params[name]));
}
