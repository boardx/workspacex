import { translate, type MessageKey, type MessageParams } from './messages';
import { zhCN } from './messages/zh-CN';
import type { useI18n } from './provider';

type Translator = ReturnType<typeof useI18n>['t'];
/** Canonical local blueprint labels/notices preserve existing state and comparisons. */
export function canonicalBlueprintCopy(key: MessageKey, params?: MessageParams): string {
  return translate('zh-CN', key, params);
}
const exact = new Map<string, MessageKey>();
const patterns: { key: MessageKey; regex: RegExp; names: string[] }[] = [];
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const key of Object.keys(zhCN) as MessageKey[]) {
  const value = zhCN[key];
  exact.set(value, key);
  if (!key.startsWith('blueprintFlow')) continue;
  const names: string[] = [];
  let cursor = 0, pattern = '^';
  for (const match of value.matchAll(/\{(value\d+)\}/g)) {
    const name = match[1];
    if (name === undefined) continue;
    pattern += escapeRegex(value.slice(cursor, match.index)) + '([\\s\\S]*?)';
    names.push(name);
    cursor = (match.index ?? 0) + match[0].length;
  }
  if (names.length) patterns.push({ key, regex: new RegExp(pattern + escapeRegex(value.slice(cursor)) + '$'), names });
}
/** Only for explicitly owned UI labels/notices. Never pass user/model/object text. */
export function localizeBlueprintCopy(t: Translator, value: string | null | undefined): string;
export function localizeBlueprintCopy<T>(t: Translator, value: T): T;
export function localizeBlueprintCopy(t: Translator, value: unknown): unknown {
  if (value == null) return '';
  if (typeof value !== 'string') return value;
  const key = exact.get(value);
  if (key !== undefined) return t(key);
  for (const entry of patterns) {
    const match = entry.regex.exec(value);
    if (match) return t(entry.key, Object.fromEntries(entry.names.map((name, i) => {
      const captured = match[i + 1] ?? '';
      return [name, captured];
    })));
  }
  return value;
}
